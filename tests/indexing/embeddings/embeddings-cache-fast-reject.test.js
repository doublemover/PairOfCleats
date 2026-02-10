#!/usr/bin/env node
import assert from 'node:assert/strict';
import { shouldFastRejectCacheLookup } from '../../../tools/build/embeddings/cache.js';

const cacheIndex = {
  version: 1,
  identityKey: 'identity-a',
  entries: {
    'key-a': {
      key: 'key-a',
      hash: 'hash-a',
      chunkSignature: 'sig-a'
    }
  }
};

assert.equal(
  shouldFastRejectCacheLookup({
    cacheIndex,
    cacheKey: 'key-a',
    identityKey: 'identity-a',
    fileHash: 'hash-a',
    chunkSignature: 'sig-a'
  }),
  false,
  'expected matching cache index entry to avoid fast reject'
);

assert.equal(
  shouldFastRejectCacheLookup({
    cacheIndex,
    cacheKey: 'key-a',
    identityKey: 'identity-a',
    fileHash: 'hash-b',
    chunkSignature: 'sig-a'
  }),
  true,
  'expected hash mismatch to fast reject'
);

assert.equal(
  shouldFastRejectCacheLookup({
    cacheIndex,
    cacheKey: 'key-a',
    identityKey: 'identity-a',
    fileHash: 'hash-a',
    chunkSignature: 'sig-b'
  }),
  true,
  'expected signature mismatch to fast reject'
);

assert.equal(
  shouldFastRejectCacheLookup({
    cacheIndex,
    cacheKey: 'key-a',
    identityKey: 'identity-b',
    fileHash: 'hash-a',
    chunkSignature: 'sig-a'
  }),
  true,
  'expected identity mismatch to fast reject'
);

assert.equal(
  shouldFastRejectCacheLookup({
    cacheIndex,
    cacheKey: 'key-missing',
    identityKey: 'identity-a',
    fileHash: 'hash-a',
    chunkSignature: 'sig-a'
  }),
  false,
  'expected missing index entry to avoid fast reject (legacy standalone files may exist)'
);

console.log('embeddings cache fast reject test passed');

