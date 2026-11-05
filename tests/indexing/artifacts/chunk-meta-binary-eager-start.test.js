#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createArtifactPieceRegistry } from '../../../src/index/build/artifacts/piece-registry.js';
import { createChunkMetaIterator } from '../../../src/index/build/artifacts/writers/chunk-meta.js';
import { enqueueChunkMetaArtifacts } from '../../../src/index/build/artifacts/writers/chunk-meta/writer.js';
import { applyTestEnv } from '../../helpers/test-env.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

applyTestEnv({ testing: '1' });

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'chunk-meta-binary-eager-start');

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const chunkMetaIterator = createChunkMetaIterator({
  chunks: [{
    id: 0,
    file: 'src/a.js',
    start: 0,
    end: 1,
    tokenCount: 1,
    text: 'a'
  }],
  fileIdByPath: new Map([['src/a.js', 1]]),
  resolvedTokenMode: 'normal',
  tokenSampleSize: 0,
  maxJsonBytes: 16 * 1024 * 1024
});

const queued = [];
const registry = createArtifactPieceRegistry({ outDir: tempRoot });

await enqueueChunkMetaArtifacts({
  outDir: tempRoot,
  mode: 'code',
  chunkMetaIterator,
  chunkMetaPlan: {
    chunkMetaFormat: 'json',
    chunkMetaStreaming: false,
    chunkMetaUseJsonl: false,
    chunkMetaUseShards: false,
    chunkMetaUseColumnar: false,
    chunkMetaBinaryColumnar: true,
    chunkMetaEstimatedJsonlBytes: 0,
    chunkMetaShardSize: 0,
    chunkMetaCount: 1,
    maxJsonBytes: 16 * 1024 * 1024
  },
  maxJsonBytes: 16 * 1024 * 1024,
  compression: null,
  gzipOptions: null,
  enqueueJsonArray: () => {},
  enqueueWrite: (label, job, meta = {}) => {
    queued.push({ label, job, meta });
  },
  ...registry,
  stageCheckpoints: null
});

const binaryMetaWrite = queued.find((entry) => String(entry?.label || '').includes('chunk_meta.binary-columnar.bundle'));
assert.ok(binaryMetaWrite, 'expected binary-columnar bundle write entry to be queued');
assert.equal(binaryMetaWrite.meta?.eagerStart, true, 'expected chunk_meta binary writer to eager-start');
assert.equal(binaryMetaWrite.meta?.laneHint, 'massive', 'expected chunk_meta binary writer to use massive lane hint');
const before = registry.listPieceEntries().map(piece => piece.layout.order);
await binaryMetaWrite.job();
assert.deepEqual(registry.listPieceEntries().map(piece => piece.layout.order), before);
const frames = registry.listPieceEntries().filter(piece => /chunk_meta_binary_columnar(?:_offsets|_lengths)?$/u.test(piece.name));
assert.equal(frames.length, 3);
for (const piece of frames) {
  const bytes = await fs.readFile(path.join(tempRoot, piece.path));
  assert.equal(piece.bytes, bytes.length);
  assert.equal(piece.checksum, 'sha256:' + createHash('sha256').update(bytes).digest('hex'));
}

await fs.rm(tempRoot, { recursive: true, force: true });

console.log('chunk_meta binary eager-start contract test passed');
