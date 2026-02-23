#!/usr/bin/env node
import assert from 'node:assert/strict';
import { upsertCacheIndexEntry } from '../../../tools/build/embeddings/cache.js';
import { ensureTestingEnv } from '../../helpers/test-env.js';

ensureTestingEnv(process.env);

const now = new Date().toISOString();
const entries = {};
const files = {};
const index = {
  version: 1,
  identityKey: 'identity-test-key',
  createdAt: now,
  updatedAt: now,
  nextShardId: 0,
  currentShard: null,
  entries,
  files,
  shards: {}
};

const cacheKey = 'cache-key';
const payload = {
  file: 'src/cache.js',
  hash: 'hash-a',
  chunkSignature: 'sig-a',
  chunkHashes: ['abc'],
  codeVectors: [[1, 2, 3]]
};

const first = upsertCacheIndexEntry(index, cacheKey, payload, {
  path: '/tmp/cache.bin',
  sizeBytes: 128
});
assert.ok(first, 'expected first index entry');
assert.equal(index.entries, entries, 'entries map should be reused in place');
assert.equal(index.files, files, 'files map should be reused in place');
assert.equal(index.entries[cacheKey].path, '/tmp/cache.bin');
assert.equal(index.files['src/cache.js'], cacheKey);

const second = upsertCacheIndexEntry(index, cacheKey, {
  ...payload,
  hash: 'hash-b',
  chunkHashes: ['abc', 'def']
}, {
  shard: 'shard-00001.bin',
  offset: 4,
  length: 64,
  sizeBytes: 68
});

assert.ok(second, 'expected second index entry');
assert.equal(index.entries, entries, 'entries map should remain in-place after second upsert');
assert.equal(index.files, files, 'files map should remain in-place after second upsert');
assert.equal(index.entries[cacheKey].hash, 'hash-b');
assert.equal(index.entries[cacheKey].shard, 'shard-00001.bin');
assert.equal(index.entries[cacheKey].path, null, 'shard-backed entries should clear standalone path');
assert.equal(index.entries[cacheKey].chunkHashesCount, 2);
assert.equal(typeof index.entries[cacheKey].chunkHashesFingerprint, 'string');

console.log('embeddings cache index upsert mutation test passed');
