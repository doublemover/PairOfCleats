import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createChunkMetaIterator, resolveChunkMetaPlan, enqueueChunkMetaArtifacts } from '../../../src/index/build/artifacts/writers/chunk-meta.js';
import { createArtifactPieceRegistry } from '../../../src/index/build/artifacts/piece-registry.js';
import { writeJsonArrayFile } from '../../../src/shared/json-stream/json-writers.js';
import { loadChunkMeta } from '../../../src/shared/artifact-io/loaders/chunk-meta.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-chunk-required-layout-'));
const chunks = [0, 1].map(id => ({ id, chunkId: `chunk-${id}`, file: `src/雪-${id}.js`, start: id * 10, end: id * 10 + 5,
  preContext: `before-${id}`, postContext: `after-${id}`, tokens: ['alpha', '雪'],
  metaV2: { schemaVersion: 3, chunkUid: `uid-${id}`, file: `src/雪-${id}.js` }, stats: { lines: id + 1 } }));
const makeIterator = () => createChunkMetaIterator({ chunks, fileIdByPath: new Map(), resolvedTokenMode: 'full', tokenSampleSize: 10, maxJsonBytes: 8192 });
try {
  for (const format of ['json', 'jsonl', 'columnar']) for (const requiredBinary of [false, true]) {
    const outDir = path.join(root, `${format}-${requiredBinary}`); await fs.mkdir(outDir);
    const iterator = makeIterator();
    const plan = resolveChunkMetaPlan({ chunks, chunkMetaIterator: iterator, artifactMode: 'auto', chunkMetaFormatConfig: format,
      chunkMetaStreaming: false, chunkMetaBinaryColumnar: true, chunkMetaBinaryColumnarRequired: requiredBinary,
      chunkMetaJsonlThreshold: 1000, chunkMetaShardSize: 100, maxJsonBytes: 8192 });
    assert.equal(plan.representationPlan.primary, format);
    assert.equal(plan.chunkMetaBinaryColumnar, requiredBinary);
    const registry = createArtifactPieceRegistry({ outDir }), tasks = [];
    await enqueueChunkMetaArtifacts({ outDir, chunkMetaIterator: iterator, chunkMetaPlan: plan,
      enqueueWrite: (label, job) => tasks.push({ label, job }),
      enqueueJsonArray: (label, rows, { piece }) => tasks.push({ label, job: async () => {
        const filename = path.join(outDir, `${label}.json`);
        await writeJsonArrayFile(filename, rows, { atomic: true }); registry.addPieceFile({ ...piece, format: 'json' }, filename);
      } }), ...registry });
    for (const task of tasks) await task.job();
    assert.equal(tasks.some(task => task.label === 'chunk_meta.binary-columnar.bundle'), requiredBinary);
    const manifest = { version: 2, artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, pieces: registry.listPieceEntries() };
    for (const preferBinaryColumnar of [false, true]) {
      const loaded = await loadChunkMeta(outDir, { manifest, preferBinaryColumnar });
      assert.equal(loaded.length, chunks.length);
      for (const [index, row] of loaded.entries()) {
        assert.equal(row.file, chunks[index].file); assert.equal(row.preContext, chunks[index].preContext);
        assert.equal(row.postContext, chunks[index].postContext); assert.deepEqual(row.stats, chunks[index].stats);
        assert.equal(row.metaV2.chunkUid, chunks[index].metaV2.chunkUid);
        assert.deepEqual(row.tokens, chunks[index].tokens);
      }
    }
    if (!requiredBinary) {
      for (const filename of ['chunk_meta.binary-columnar.bin', 'chunk_meta.binary-columnar.offsets.bin',
        'chunk_meta.binary-columnar.lengths.varint', 'chunk_meta.binary-columnar.meta.json']) {
        await fs.writeFile(path.join(outDir, filename), 'unlisted old generation');
      }
      assert.equal((await loadChunkMeta(outDir, { manifest }))[0].preContext, 'before-0', 'stale binary files cannot override the recorded primary');
    } else {
      const absent = structuredClone(manifest);
      absent.pieces = absent.pieces.filter(piece => piece.name !== 'chunk_meta_binary_columnar_lengths');
      await assert.rejects(loadChunkMeta(outDir, { manifest: absent }), { code: 'ERR_MANIFEST_INCOMPLETE' });
    }
    if (format === 'jsonl') {
      const absentCold = structuredClone(manifest);
      absentCold.pieces = absentCold.pieces.filter(piece => piece.name !== 'chunk_meta_cold');
      await assert.rejects(loadChunkMeta(outDir, { manifest: absentCold }), { code: 'ERR_MANIFEST_INCOMPLETE' });
      const coldFile = path.join(outDir, 'chunk_meta_cold.jsonl'), coldBytes = await fs.readFile(coldFile);
      await fs.writeFile(coldFile, '');
      await assert.rejects(loadChunkMeta(outDir, { manifest }), { code: 'ERR_ARTIFACT_INVALID' });
      await fs.writeFile(coldFile, coldBytes);
    }
    const invalid = structuredClone(manifest);
    invalid.pieces.find(piece => piece.name === 'chunk_meta').extensions.representationPlan.primary = 'unknown';
    await assert.rejects(loadChunkMeta(outDir, { manifest: invalid }), { code: 'ERR_MANIFEST_INVALID' });
  }
  assert.throws(() => resolveChunkMetaPlan({ chunks, chunkMetaIterator: makeIterator(), artifactMode: 'auto',
    chunkMetaFormatConfig: 'jsonl', chunkMetaBinaryColumnar: true, chunkMetaBinaryColumnarRequired: true,
    chunkMetaBinaryColumnarMaxBytes: 1, chunkMetaJsonlThreshold: 1, chunkMetaShardSize: 1, maxJsonBytes: 8192 }),
  { code: 'ERR_CHUNK_META_COMPATIBILITY_LIMIT' });
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('Chunk metadata plans canonical JSON/JSONL/columnar output, explicit compatibility, complete cold fields and selected-reader authority.');
