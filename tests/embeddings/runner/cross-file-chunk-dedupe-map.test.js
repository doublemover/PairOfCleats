#!/usr/bin/env node
import assert from 'node:assert/strict';

import {
  boundedMapSet,
  resolveCrossFileChunkDedupeMaxEntries,
  resolveEmbeddingsSourceHashCacheMaxEntries
} from '../../../tools/build/embeddings/runner.js';

assert.equal(
  resolveCrossFileChunkDedupeMaxEntries({ embeddings: { crossFileChunkDedupeMaxEntries: 42 } }),
  42,
  'expected configured cross-file chunk dedupe max entries to be honored'
);

assert.equal(
  resolveCrossFileChunkDedupeMaxEntries({ embeddings: {} }),
  200000,
  'expected default cross-file chunk dedupe max entries'
);

assert.equal(
  resolveEmbeddingsSourceHashCacheMaxEntries({ embeddings: { sourceHashCacheMaxEntries: 123 } }),
  123,
  'expected configured source hash cache max entries to be honored'
);

assert.equal(
  resolveEmbeddingsSourceHashCacheMaxEntries({ embeddings: {} }),
  200000,
  'expected default source hash cache max entries'
);

const map = new Map();
boundedMapSet(map, 'a', 1, 2);
boundedMapSet(map, 'b', 2, 2);
boundedMapSet(map, 'c', 3, 2);
assert.deepEqual(Array.from(map.keys()), ['b', 'c'], 'expected bounded map to evict oldest key');

boundedMapSet(map, 'b', 22, 2);
assert.deepEqual(Array.from(map.keys()), ['c', 'b'], 'expected key update to refresh recency');
assert.equal(map.get('b'), 22, 'expected updated value to be retained');

console.log('cross-file chunk dedupe map test passed');
