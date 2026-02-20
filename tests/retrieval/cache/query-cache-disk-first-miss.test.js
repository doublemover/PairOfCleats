#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  findQueryCacheEntry,
  rememberQueryCacheEntry
} from '../../../src/retrieval/query-cache.js';

const cachePath = path.join(process.cwd(), '.testCache', 'query-cache-disk-first-miss', 'queryCache.json');
const key = 'query-key';
const signature = 'signature';
const memoryEntry = { key, signature, ts: 200, payload: { source: 'memory' } };
rememberQueryCacheEntry(cachePath, key, signature, memoryEntry, 16);

const emptyDiskCache = { version: 1, entries: [] };
const diskFirstMiss = findQueryCacheEntry(emptyDiskCache, key, signature, {
  cachePath,
  strategy: 'disk-first'
});
assert.equal(
  diskFirstMiss,
  null,
  'expected disk-first lookup to miss when disk cache has no entry'
);

const memoryFirstHit = findQueryCacheEntry(emptyDiskCache, key, signature, {
  cachePath,
  strategy: 'memory-first'
});
assert.ok(memoryFirstHit, 'expected memory-first lookup to hit hot cache entry');
assert.equal(memoryFirstHit?.payload?.source, 'memory', 'expected memory-first hit to come from hot cache');

const diskCacheWithEntry = {
  version: 1,
  entries: [
    { key, signature, ts: 100, payload: { source: 'disk' } }
  ]
};
const diskFirstHit = findQueryCacheEntry(diskCacheWithEntry, key, signature, {
  cachePath,
  strategy: 'disk-first'
});
assert.ok(diskFirstHit, 'expected disk-first lookup to hit disk cache entry');
assert.equal(diskFirstHit?.payload?.source, 'disk', 'expected disk-first hit to come from disk cache');

console.log('query cache disk-first miss test passed');
