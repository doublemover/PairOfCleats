#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import {
  pruneCacheIndex,
  readCacheEntry,
  upsertCacheIndexEntry,
  writeCacheEntry
} from '../../../tools/build/embeddings/cache.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'embeddings-cache-fallback-entry');
const cacheDir = path.join(tempRoot, 'files');
const cacheKey = 'cache-fallback-key';
const now = new Date().toISOString();

await fsPromises.rm(tempRoot, { recursive: true, force: true });
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
  shards: {}
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

const writeResult = await writeCacheEntry(cacheDir, cacheKey, payload);
assert.ok(writeResult?.path, 'expected fallback write to return entry path');
assert.ok(Number.isFinite(Number(writeResult?.sizeBytes)) && Number(writeResult.sizeBytes) > 0, 'expected fallback write to report size');
assert.ok(fs.existsSync(writeResult.path), 'expected fallback cache entry file to exist');

const indexEntry = upsertCacheIndexEntry(index, cacheKey, payload, writeResult);
assert.ok(indexEntry, 'expected index entry to be created');
assert.equal(indexEntry.shard, null, 'expected fallback entry to remain path-backed');
assert.equal(indexEntry.path, writeResult.path, 'expected fallback entry path to be indexed');
assert.equal(index.entries[cacheKey]?.path, writeResult.path, 'expected indexed fallback path in cache index');

const loaded = await readCacheEntry(cacheDir, cacheKey, index);
assert.ok(loaded?.entry, 'expected fallback cache entry to be readable via index metadata');
assert.equal(loaded.path, writeResult.path, 'expected read path to match fallback path');

const pruneResult = await pruneCacheIndex(cacheDir, index, { maxBytes: 1 });
assert.ok(pruneResult.removedKeys.includes(cacheKey), 'expected fallback entry to be pruned by size budget');
assert.ok(!fs.existsSync(writeResult.path), 'expected fallback cache entry file to be removed during prune');

console.log('embeddings cache fallback index entry test passed');
