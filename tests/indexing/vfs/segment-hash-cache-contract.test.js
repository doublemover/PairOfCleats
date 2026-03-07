#!/usr/bin/env node
import assert from 'node:assert/strict';
import * as mod from '../../../src/index/build/vfs-segment-hash-cache.js';
const buildKey = mod.buildVfsSegmentHashCacheKey || mod.buildDocHashCacheKey;
assert.equal(typeof buildKey, 'function', 'Expected buildVfsSegmentHashCacheKey export.');

assert.equal(
  mod.VFS_SEGMENT_HASH_CACHE_SCHEMA_VERSION,
  '1.0.0',
  'Expected VFS segment hash cache schema version 1.0.0.'
);

const key = buildKey({
  fileHash: 'abc123',
  fileHashAlgo: 'sha1',
  containerPath: 'src/app.js',
  segmentUid: 'segu:v1:abc',
  segmentStart: 0,
  segmentEnd: 42
});

assert.ok(String(key).startsWith('pairofcleats:ck1:'), 'Expected key to include cache namespace prefix.');
const keyWithRange = buildKey({
  fileHash: 'abc123',
  fileHashAlgo: 'sha1',
  containerPath: 'src/app.js',
  segmentUid: 'segu:v1:abc',
  segmentStart: 0,
  segmentEnd: 43
});
assert.notEqual(key, keyWithRange, 'Expected key to change when segment range changes.');
const keyWithHash = buildKey({
  fileHash: 'def456',
  fileHashAlgo: 'sha1',
  containerPath: 'src/app.js',
  segmentUid: 'segu:v1:abc',
  segmentStart: 0,
  segmentEnd: 42
});
assert.notEqual(key, keyWithHash, 'Expected key to change when file hash changes.');

if (typeof mod.createVfsSegmentHashCache === 'function') {
  const cache = mod.createVfsSegmentHashCache({ maxEntries: 1 });
  assert.equal(typeof cache.get, 'function', 'Expected cache.get function.');
  assert.equal(typeof cache.set, 'function', 'Expected cache.set function.');
}

console.log('VFS segment hash cache contract ok.');
