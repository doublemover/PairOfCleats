#!/usr/bin/env node
import assert from 'node:assert/strict';
import { buildCacheIdentity, buildCacheKey, isCacheValid } from '../tools/build-embeddings/cache.js';

const base = buildCacheIdentity({
  modelId: 'model-a',
  provider: 'provider-a',
  mode: 'inline',
  stub: false,
  dims: 384,
  scale: 0.5
});
const dimsChanged = buildCacheIdentity({
  modelId: 'model-a',
  provider: 'provider-a',
  mode: 'inline',
  stub: false,
  dims: 768,
  scale: 0.5
});
const modelChanged = buildCacheIdentity({
  modelId: 'model-b',
  provider: 'provider-a',
  mode: 'inline',
  stub: false,
  dims: 384,
  scale: 0.5
});
const providerChanged = buildCacheIdentity({
  modelId: 'model-a',
  provider: 'provider-b',
  mode: 'inline',
  stub: false,
  dims: 384,
  scale: 0.5
});

assert.notEqual(base.key, dimsChanged.key, 'expected cache identity to change with dims');
assert.notEqual(base.key, modelChanged.key, 'expected cache identity to change with model');
assert.notEqual(base.key, providerChanged.key, 'expected cache identity to change with provider');

const signature = 'sig-1';
const cached = {
  chunkSignature: signature,
  cacheMeta: { identityKey: base.key }
};
assert.equal(isCacheValid({ cached, signature, identityKey: base.key }), true, 'expected cache to be valid for matching identity');
assert.equal(isCacheValid({ cached, signature, identityKey: dimsChanged.key }), false, 'expected cache to be invalid for mismatched identity');

const cacheKey = buildCacheKey({
  file: 'src/index.js',
  hash: 'hash-1',
  signature,
  identityKey: base.key
});
assert.ok(cacheKey, 'expected cache key for hashed file');
const cacheKeyMismatch = buildCacheKey({
  file: 'src/index.js',
  hash: 'hash-1',
  signature,
  identityKey: dimsChanged.key
});
assert.notEqual(cacheKey, cacheKeyMismatch, 'expected cache key to change with identity');

console.log('embeddings cache invalidation test passed');
