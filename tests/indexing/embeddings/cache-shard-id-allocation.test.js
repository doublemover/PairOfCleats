#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import {
  upsertCacheIndexEntry,
  writeCacheEntry
} from '../../../tools/build/embeddings/cache.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';
import { rmDirRecursive } from '../../helpers/temp.js';


const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'embeddings-cache-shard-id-allocation');
const cacheDir = path.join(tempRoot, 'files');
const now = new Date().toISOString();
const cacheKey = 'cache-shard-id-key';

await rmDirRecursive(tempRoot, { retries: 8, delayMs: 150 });
await fsPromises.mkdir(cacheDir, { recursive: true });

const index = {
  version: 1,
  identityKey: 'identity-test-key',
  createdAt: now,
  updatedAt: now,
  nextShardId: 0,
  currentShard: null,
  entries: {},
  files: {},
  shards: {
    'shard-00007.bin': { createdAt: now, sizeBytes: 4096 }
  }
};

const payload = {
  key: cacheKey,
  file: 'src/sample.js',
  hash: 'hash-1',
  chunkSignature: 'sig-1',
  cacheMeta: {
    schemaVersion: 1,
    identityKey: 'identity-test-key',
    createdAt: now
  },
  codeVectors: [[1, 2, 3]],
  docVectors: [[1, 2, 3]],
  mergedVectors: [[1, 2, 3]]
};

const shardEntry = await writeCacheEntry(cacheDir, cacheKey, payload, { index });
assert.equal(shardEntry?.shard, 'shard-00008.bin', 'expected shard allocation to avoid stale nextShardId collisions');
assert.equal(index.nextShardId, 9, 'expected nextShardId to advance beyond the highest existing shard id');
upsertCacheIndexEntry(index, cacheKey, payload, shardEntry);

const shardPath = path.join(cacheDir, 'shards', 'shard-00008.bin');
assert.equal(fs.existsSync(shardPath), true, 'expected allocated shard file to be created');
assert.equal(index.entries[cacheKey]?.shard, 'shard-00008.bin', 'expected index entry to point at newly allocated shard');

console.log('embeddings cache shard id allocation test passed');
