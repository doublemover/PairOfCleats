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

assert.ok(String(key).startsWith('pairofcleats:ck1:'), 'Expected key to include cache namespace prefix.');
const keyRange = buildVfsSegmentHashCacheKey({
  fileHash: 'abc123',
  fileHashAlgo: 'sha1',
  containerPath: 'src/app.js',
  languageId: 'javascript',
  effectiveExt: '.js',
  segmentStart: 0,
  segmentEnd: 11
});
assert.notEqual(key, keyRange, 'Expected key to change when segment range changes.');

const cache = createVfsSegmentHashCache({ maxEntries: 2 });
cache.set('k1', 'v1');
cache.set('k2', 'v2');
assert.equal(cache.get('k1'), 'v1', 'Expected cache to return existing entry.');
cache.set('k3', 'v3');

assert.equal(cache.get('k2'), null, 'Expected LRU to evict the oldest entry.');
assert.equal(cache.get('k1'), 'v1', 'Expected most-recently-used entry to remain.');
assert.equal(cache.get('k3'), 'v3', 'Expected newest entry to remain.');

console.log('vfs segment hash cache ok');
