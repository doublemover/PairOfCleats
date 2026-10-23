import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createChunkMetaIterator, enqueueChunkMetaArtifacts } from '../../../src/index/build/artifacts/writers/chunk-meta.js';
import { createArtifactPieceRegistry } from '../../../src/index/build/artifacts/piece-registry.js';
import { loadChunkMeta } from '../../../src/shared/artifact-io/loaders/chunk-meta.js';
import { encodeVarint64List } from '../../../src/shared/artifact-io/varint.js';
import { parseHash64, formatHash64 } from '../../../src/shared/token-id.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-chunk-token-packing-'));
try {
  for (const compression of [null, 'gzip']) {
    for (const tokenMode of ['full', 'sample']) {
      const outDir = path.join(root, `${compression || 'plain'}-${tokenMode}`); await fs.mkdir(outDir);
      const ids = Array.from({ length: 18000 }, (_, index) => formatHash64(index % 3 === 0 ? 0n
        : index % 3 === 1 ? BigInt(index) : 0xffffffffffffffffn));
      const selected = tokenMode === 'sample' ? ids.slice(0, 15001) : ids.slice();
      const expected = encodeVarint64List(selected.map(parseHash64)).toString('base64');
      assert.ok(Buffer.from(expected, 'base64').length > 65536, 'the real row crosses the fixed byte block');
      let idReads = 0;
      const chunk = { id: 0, file: 'src/雪.js', start: 0, end: 1, chunkUid: 'uid-0', tokens: [] };
      Object.defineProperty(chunk, 'tokenIds', { get() { idReads++; return ids; } });
      const chunkMetaIterator = createChunkMetaIterator({ chunks: [chunk], fileIdByPath: new Map(),
        resolvedTokenMode: tokenMode, tokenSampleSize: 15001, maxJsonBytes: 1024 * 1024, prepareRows: true });
      const first = [...chunkMetaIterator()][0];
      assert.equal(first.token_ids_packed, expected); assert.equal(first.token_ids_count, selected.length);
      ids[0] = '000000000000ffff';
      assert.equal([...chunkMetaIterator()][0], first, 'bounded immutable rows reuse the same already packed string');
      const registry = createArtifactPieceRegistry({ outDir }), jobs = [];
      await enqueueChunkMetaArtifacts({ outDir, chunkMetaIterator,
        chunkMetaPlan: { chunkMetaFormat: 'jsonl', chunkMetaStreaming: true, chunkMetaUseJsonl: true,
          chunkMetaUseShards: false, chunkMetaUseColumnar: false, chunkMetaBinaryColumnar: false,
          chunkMetaEstimatedJsonlBytes: expected.length, chunkMetaShardSize: 10, chunkMetaCount: 1, maxJsonBytes: 1024 * 1024 },
        compression, enqueueWrite: (_label, job) => jobs.push(job), ...registry });
      for (const job of jobs) await job();
      const manifest = { version: 2, artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, pieces: registry.listPieceEntries() };
      const rows = await loadChunkMeta(outDir, { manifest, materializeTokenIds: true });
      assert.equal(rows.length, 1); assert.equal(rows[0].token_ids_packed, expected);
      assert.deepEqual(rows[0].tokenIds, selected); assert.equal(idReads, 1);
      assert.ok(chunkMetaIterator.preparedStats.retainedBytes <= 4 * 1024 * 1024);
    }
  }
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('Chunk metadata streams exact full/sample token packing through bounded byte blocks and real JSONL consumers.');
