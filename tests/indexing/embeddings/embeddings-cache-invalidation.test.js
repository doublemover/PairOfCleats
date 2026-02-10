#!/usr/bin/env node
import assert from 'node:assert/strict';
import { buildCacheIdentity, buildCacheKey, isCacheValid } from '../../../tools/build/embeddings/cache.js';

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
const poolingChanged = buildCacheIdentity({
  modelId: 'model-a',
  provider: 'provider-a',
  mode: 'inline',
  stub: false,
  dims: 384,
  scale: 0.5,
  pooling: 'cls'
});
const normalizeChanged = buildCacheIdentity({
  modelId: 'model-a',
  provider: 'provider-a',
  mode: 'inline',
  stub: false,
  dims: 384,
  scale: 0.5,
  normalize: false
});
const truncationChanged = buildCacheIdentity({
  modelId: 'model-a',
  provider: 'provider-a',
  mode: 'inline',
  stub: false,
  dims: 384,
  scale: 0.5,
  truncation: 'none'
});
const maxLengthChanged = buildCacheIdentity({
  modelId: 'model-a',
  provider: 'provider-a',
  mode: 'inline',
  stub: false,
  dims: 384,
  scale: 0.5,
  maxLength: 256
});

assert.notEqual(base.key, dimsChanged.key, 'expected cache identity to change with dims');
assert.notEqual(base.key, modelChanged.key, 'expected cache identity to change with model');
assert.notEqual(base.key, providerChanged.key, 'expected cache identity to change with provider');
assert.notEqual(base.key, poolingChanged.key, 'expected cache identity to change with pooling');
assert.notEqual(base.key, normalizeChanged.key, 'expected cache identity to change with normalize');
assert.notEqual(base.key, truncationChanged.key, 'expected cache identity to change with truncation');
assert.notEqual(base.key, maxLengthChanged.key, 'expected cache identity to change with maxLength');

const signature = 'sig-1';
const cached = {
  chunkSignature: signature,
  cacheMeta: { identityKey: base.key }
};
assert.equal(isCacheValid({ cached, signature, identityKey: base.key }), true, 'expected cache to be valid for matching identity');
assert.equal(isCacheValid({ cached, signature, identityKey: dimsChanged.key }), false, 'expected cache to be invalid for mismatched identity');
const cachedWithHash = {
  chunkSignature: signature,
  hash: 'hash-1',
  cacheMeta: { identityKey: base.key }
};
assert.equal(
  isCacheValid({ cached: cachedWithHash, signature, identityKey: base.key, hash: 'hash-1' }),
  true,
  'expected cache to be valid for matching hash'
);
assert.equal(
  isCacheValid({ cached: cachedWithHash, signature, identityKey: base.key, hash: 'hash-2' }),
  false,
  'expected cache to be invalid for mismatched hash'
);

const cacheKey = buildCacheKey({
  file: 'src/index.js',
  hash: 'hash-1',
  signature,
  identityKey: base.key,
  repoId: 'repo-1',
  mode: 'code',
  featureFlags: ['normalize'],
  pathPolicy: 'posix'
});
assert.ok(cacheKey, 'expected cache key for hashed file');
const cacheKeyOtherMode = buildCacheKey({
  file: 'src/index.js',
  hash: 'hash-1',
  signature,
  identityKey: base.key,
  repoId: 'repo-1',
  mode: 'prose',
  featureFlags: ['normalize'],
  pathPolicy: 'posix'
});
assert.notEqual(cacheKey, cacheKeyOtherMode, 'expected cache key to change with mode');
const cacheKeyMismatch = buildCacheKey({
  file: 'src/index.js',
  hash: 'hash-1',
  signature,
  identityKey: dimsChanged.key,
  repoId: 'repo-1',
  mode: 'code',
  featureFlags: ['normalize'],
  pathPolicy: 'posix'
});
assert.notEqual(cacheKey, cacheKeyMismatch, 'expected cache key to change with identity');

console.log('embeddings cache invalidation test passed');
