#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  buildVfsSegmentHashCacheKey,
  createVfsSegmentHashCache
} from '../../../src/index/build/vfs-segment-hash-cache.js';

const key = buildVfsSegmentHashCacheKey({
  fileHash: 'abc123',
  fileHashAlgo: 'sha1',
  containerPath: 'src/app.js',
  languageId: 'javascript',
  effectiveExt: '.js',
  segmentStart: 0,
  segmentEnd: 10
});

assert.ok(String(key).includes('sha1:abc123'), 'Expected key to include file hash prefix.');
assert.ok(String(key).includes('src/app.js'), 'Expected key to include container path.');
assert.ok(String(key).includes('0-10'), 'Expected key to include segment range.');

const cache = createVfsSegmentHashCache({ maxEntries: 2 });
cache.set('k1', 'v1');
cache.set('k2', 'v2');
assert.equal(cache.get('k1'), 'v1', 'Expected cache to return existing entry.');
cache.set('k3', 'v3');

assert.equal(cache.get('k2'), null, 'Expected LRU to evict the oldest entry.');
assert.equal(cache.get('k1'), 'v1', 'Expected most-recently-used entry to remain.');
assert.equal(cache.get('k3'), 'v3', 'Expected newest entry to remain.');

console.log('vfs segment hash cache ok');
