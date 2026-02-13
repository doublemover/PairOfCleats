#!/usr/bin/env node
import assert from 'node:assert/strict';
import { buildQueryCacheKey } from '../../src/retrieval/cli-index.js';

const basePayload = {
  query: 'phase14 cache key',
  backend: 'memory',
  mode: 'code',
  topN: 5,
  ann: false,
  explain: false
};

const keyA = buildQueryCacheKey({
  ...basePayload,
  asOf: {
    ref: 'snap:snap-20260212-aa',
    identityHash: 'hash-aa'
  }
}).key;

const keyB = buildQueryCacheKey({
  ...basePayload,
  asOf: {
    ref: 'snap:snap-20260212-bb',
    identityHash: 'hash-bb'
  }
}).key;

const keyARepeat = buildQueryCacheKey({
  ...basePayload,
  asOf: {
    ref: 'snap:snap-20260212-aa',
    identityHash: 'hash-aa'
  }
}).key;

assert.notEqual(keyA, keyB, 'cache key must vary by as-of identity');
assert.equal(keyA, keyARepeat, 'cache key must be deterministic for same as-of identity');

console.log('retrieval cache key as-of unit test passed');
