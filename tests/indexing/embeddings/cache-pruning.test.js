#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsSync from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { pruneCacheIndex, resolveCacheEntryPath } from '../../../tools/build/embeddings/cache.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';
import { rmDirRecursive } from '../../helpers/temp.js';


const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'embeddings-cache-pruning');
const cacheDir = path.join(tempRoot, 'files');
const shardDir = path.join(cacheDir, 'shards');

await rmDirRecursive(tempRoot, { retries: 8, delayMs: 150 });
await fsPromises.mkdir(shardDir, { recursive: true });

const shardA = 'shard-00000.bin';
const shardB = 'shard-00001.bin';
await fsPromises.writeFile(path.join(shardDir, shardA), Buffer.alloc(16));
await fsPromises.writeFile(path.join(shardDir, shardB), Buffer.alloc(16));
const standalonePath = resolveCacheEntryPath(cacheDir, 'keyC');
await fsPromises.writeFile(standalonePath, Buffer.alloc(24));

const now = Date.now();
const index = {
  version: 1,
  identityKey: 'identity-key',
  createdAt: new Date(now - 1000).toISOString(),
  updatedAt: new Date(now - 1000).toISOString(),
  nextShardId: 2,
  currentShard: shardB,
  entries: {
    keyA: {
      key: 'keyA',
      shard: shardA,
      offset: 0,
      length: 12,
      sizeBytes: 16,
      lastAccessAt: new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString()
    },
    keyB: {
      key: 'keyB',
      shard: shardB,
      offset: 0,
      length: 12,
      sizeBytes: 16,
      lastAccessAt: new Date(now).toISOString()
    },
    keyC: {
      key: 'keyC',
      path: standalonePath,
      sizeBytes: 24,
      lastAccessAt: new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString()
    }
  },
  files: {},
  shards: {
    [shardA]: { createdAt: new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString(), sizeBytes: 16 },
    [shardB]: { createdAt: new Date(now).toISOString(), sizeBytes: 16 }
  }
};

const result = await pruneCacheIndex(cacheDir, index, { maxAgeMs: 5 * 24 * 60 * 60 * 1000 });
assert.ok(result.removedKeys.includes('keyA'), 'expected stale entry to be pruned');
assert.ok(result.removedKeys.includes('keyC'), 'expected stale standalone entry to be pruned');
assert.equal(index.entries.keyA, undefined, 'expected pruned entry to be removed from index');
assert.equal(index.entries.keyC, undefined, 'expected pruned standalone entry to be removed from index');
assert.ok(!fsSync.existsSync(path.join(shardDir, shardA)), 'expected unused shard to be removed');
assert.ok(fsSync.existsSync(path.join(shardDir, shardB)), 'expected active shard to remain');
assert.ok(!fsSync.existsSync(standalonePath), 'expected stale standalone cache entry to be removed');

console.log('embeddings cache pruning test passed');
