#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { createChunkMetaIterator } from '../../../src/index/build/artifacts/writers/chunk-meta.js';
import { enqueueChunkMetaArtifacts } from '../../../src/index/build/artifacts/writers/chunk-meta/writer.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

applyTestEnv({ testing: '1' });

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'chunk-meta-sharded-write-priority');

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const chunkMetaIterator = createChunkMetaIterator({
  chunks: Array.from({ length: 4 }, (_, index) => ({
    id: index,
    file: `src/${index}.js`,
    start: index,
    end: index + 1,
    tokenCount: 1,
    text: `row-${index}`
  })),
  fileIdByPath: new Map(Array.from({ length: 4 }, (_, index) => [`src/${index}.js`, index + 1])),
  resolvedTokenMode: 'normal',
  tokenSampleSize: 0,
  maxJsonBytes: 1024
});

const queued = [];

await enqueueChunkMetaArtifacts({
  outDir: tempRoot,
  mode: 'code',
  chunkMetaIterator,
  chunkMetaPlan: {
    chunkMetaFormat: 'jsonl',
    chunkMetaStreaming: true,
    chunkMetaUseJsonl: true,
    chunkMetaUseShards: true,
    chunkMetaUseColumnar: false,
    chunkMetaBinaryColumnar: true,
    chunkMetaBinaryColumnarMaxBytes: 512 * 1024 * 1024,
    chunkMetaBinaryColumnarDisabledReason: null,
    chunkMetaEstimatedJsonlBytes: 32 * 1024 * 1024,
    chunkMetaShardSize: 2,
    chunkMetaCount: 4,
    maxJsonBytes: 1024
  },
  maxJsonBytes: 1024,
  compression: null,
  gzipOptions: null,
  enqueueJsonArray: () => {},
  enqueueWrite: (label, job, meta = {}) => {
    queued.push({ label, job, meta });
  },
  addPieceFile: () => {},
  formatArtifactLabel: (filePath) => path.relative(tempRoot, filePath).replace(/\\/g, '/'),
  stageCheckpoints: null
});

const shardWrite = queued.find((entry) => entry.label === 'chunk_meta.parts.bundle');
assert.ok(shardWrite, 'expected sharded chunk_meta write bundle to be queued');
assert.equal(shardWrite.meta?.priority, 275, 'expected sharded chunk_meta write to outrank optional binary work');
assert.equal(shardWrite.meta?.estimatedBytes, 32 * 1024 * 1024, 'expected sharded chunk_meta write to carry estimated bytes');

const binaryWrite = queued.find((entry) => entry.label === 'chunk_meta.binary-columnar.bundle');
assert.ok(binaryWrite, 'expected optional chunk_meta binary-columnar write to remain queued for moderate sharded plans');
assert.equal(binaryWrite.meta?.eagerStart, false, 'expected sharded chunk_meta plans to defer eager-start for optional binary work');
assert.equal(binaryWrite.meta?.priority, 75, 'expected sharded chunk_meta binary write to run after the required shard path');

const phases = [];
await shardWrite.job({
  setPhase: (phase) => phases.push(phase),
  label: shardWrite.label,
  estimatedBytes: shardWrite.meta?.estimatedBytes
});

assert.deepEqual(
  phases,
  ['write:chunk-meta-shards', 'publish:chunk-meta-meta'],
  'expected sharded chunk_meta write job to expose shard and meta publication phases'
);
await fs.access(path.join(tempRoot, 'chunk_meta.meta.json'));
await fs.access(path.join(tempRoot, 'chunk_meta.parts'));

await fs.rm(tempRoot, { recursive: true, force: true });

console.log('chunk_meta sharded write priority test passed');
