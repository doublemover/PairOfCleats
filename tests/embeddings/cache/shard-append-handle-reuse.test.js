#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsPromises from 'node:fs/promises';
import path from 'node:path';

import {
  createShardAppendHandlePool,
  writeCacheEntry
} from '../../../tools/build/embeddings/cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv({ testing: '1' });

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'embeddings-shard-handle-reuse');
const cacheDir = path.join(tempRoot, 'files');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(cacheDir, { recursive: true });

const cacheIndex = {
  version: 1,
  identityKey: 'identity:test',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  nextShardId: 0,
  currentShard: null,
  entries: {},
  files: {},
  shards: {}
};

const pool = createShardAppendHandlePool();
const originalOpen = fsPromises.open;
let appendOpenCalls = 0;
fsPromises.open = async (...args) => {
  const filePath = String(args[0] || '');
  const mode = String(args[1] || '');
  if (filePath.includes(`${path.sep}shards${path.sep}`) && mode === 'a') {
    appendOpenCalls += 1;
  }
  return originalOpen(...args);
};

try {
  const payloadA = {
    key: 'key-a',
    file: 'src/a.js',
    hash: 'hash-a',
    chunkSignature: 'sig-a',
    chunkHashes: ['ha'],
    cacheMeta: { identityKey: 'identity:test' },
    codeVectors: [[1, 2]],
    docVectors: [[3, 4]],
    mergedVectors: [[5, 6]]
  };
  const payloadB = {
    key: 'key-b',
    file: 'src/b.js',
    hash: 'hash-b',
    chunkSignature: 'sig-b',
    chunkHashes: ['hb'],
    cacheMeta: { identityKey: 'identity:test' },
    codeVectors: [[7, 8]],
    docVectors: [[9, 10]],
    mergedVectors: [[11, 12]]
  };

  const first = await writeCacheEntry(cacheDir, 'key-a', payloadA, {
    index: cacheIndex,
    shardHandlePool: pool
  });
  const second = await writeCacheEntry(cacheDir, 'key-b', payloadB, {
    index: cacheIndex,
    shardHandlePool: pool
  });

  assert.ok(first?.shard, 'expected first shard append result');
  assert.ok(second?.shard, 'expected second shard append result');
  assert.equal(first.shard, second.shard, 'expected appends to reuse same active shard');
} finally {
  fsPromises.open = originalOpen;
  await pool.close();
}

assert.equal(
  appendOpenCalls,
  1,
  `expected one shard append handle open during flush window (observed=${appendOpenCalls})`
);

console.log('embeddings cache shard append handle reuse test passed');
