import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createChunkMetaIterator, enqueueChunkMetaArtifacts } from '../../../src/index/build/artifacts/writers/chunk-meta.js';
import { createArtifactPieceRegistry } from '../../../src/index/build/artifacts/piece-registry.js';
import { loadChunkMeta } from '../../../src/shared/artifact-io/loaders/chunk-meta.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-chunk-sorted-lifetime-'));
try {
  for (const order of ['hot-first', 'binary-first', 'concurrent', 'binary-failure']) {
    const outDir = path.join(root, order); await fs.mkdir(outDir);
    let packingReads = 0;
    const chunks = Array.from({ length: 150 }, (_, index) => {
      const id = 149 - index;
      return { id, chunkId: `chunk-${id}`, chunkUid: `uid-${id}`, file: `src/file-${id}.js`, start: id, end: id + 1,
        preContext: 'x'.repeat(30000), metaV2: { schemaVersion: 3, chunkUid: `uid-${id}` }, tokens: ['alpha'],
        get tokenIds() { packingReads++; return ['0000000000000001']; } };
    });
    const iterator = createChunkMetaIterator({ chunks, fileIdByPath: new Map(), resolvedTokenMode: 'full', tokenSampleSize: 1,
      maxJsonBytes: 8 * 1024 * 1024, preparedRowsOptions: { maxCacheRows: 1 } });
    const registry = createArtifactPieceRegistry({ outDir }), tasks = [];
    await enqueueChunkMetaArtifacts({ outDir, chunkMetaIterator: iterator,
      chunkMetaPlan: { chunkMetaFormat: 'auto', chunkMetaStreaming: false, chunkMetaUseJsonl: true,
        chunkMetaUseShards: false, chunkMetaUseColumnar: false, chunkMetaBinaryColumnar: true,
        chunkMetaEstimatedJsonlBytes: 5 * 1024 * 1024, chunkMetaShardSize: 1000, chunkMetaCount: chunks.length,
        maxJsonBytes: 8 * 1024 * 1024 }, enqueueWrite: (label, job) => tasks.push({ label, job }), ...registry });
    const runs = (await fs.readdir(outDir)).filter(name => name.endsWith('.runs'));
    assert.ok(runs.length, 'fixture must cross the existing 4MiB spill budget');
    const beforeOutput = packingReads;
    const hot = tasks.find(task => task.label === 'chunk_meta.jsonl'), binary = tasks.find(task => task.label === 'chunk_meta.binary-columnar.bundle');
    assert.ok(hot && binary);
    if (order === 'concurrent') await Promise.all([hot.job(), binary.job()]);
    else {
      const first = order === 'binary-first' ? binary : hot, second = first === binary ? hot : binary;
      await first.job();
      assert.deepEqual((await fs.readdir(outDir)).filter(name => name.endsWith('.runs')), runs,
        'the completed first consumer cannot retire the source of its queued peer');
      const rename = fs.rename;
      if (order === 'binary-failure') fs.rename = async (from, to) => {
        if (to.endsWith('chunk_meta.binary-columnar.meta.json')) throw Object.assign(new Error('binary publish failed'), { code: 'EIO' });
        return rename(from, to);
      };
      try {
        if (order === 'binary-failure') await assert.rejects(second.job(), { code: 'EIO' });
        else await second.job();
      } finally { fs.rename = rename; }
    }
    assert.equal(packingReads, beforeOutput, 'all outputs use the admitted sorted stream even after the tiny base cache is exhausted');
    assert.deepEqual((await fs.readdir(outDir)).filter(name => name.endsWith('.runs')), []);
    if (order !== 'binary-failure') {
      const manifest = { version: 2, artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, pieces: registry.listPieceEntries() };
      const primary = await loadChunkMeta(outDir, { manifest, preferBinaryColumnar: false });
      const compatibility = await loadChunkMeta(outDir, { manifest, preferBinaryColumnar: true });
      assert.deepEqual(primary.map(row => row.id), Array.from({ length: 150 }, (_, id) => id));
      assert.deepEqual(compatibility, primary);
      assert.deepEqual(JSON.parse(await fs.readFile(path.join(outDir, 'chunk_meta.json'), 'utf8')), primary);
    }
  }
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('Primary, legacy JSON and binary chunk consumers share bounded sorted runs until the last reader settles.');
