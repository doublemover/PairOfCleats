#!/usr/bin/env node
import assert from 'node:assert/strict';

import {
  resolveCrossFileChunkDedupeMaxEntries
} from '../../../tools/build/embeddings/runner.js';
import { createLruCache } from '../../../src/shared/cache/lru.js';

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

// Exercise the exact production LRU owner, preserving capacity, replacement and
// recency assertions without depending on a retired Map representation helper.
const map = createLruCache({ name: 'stage3-cross-file-vector-reuse-fixture', maxEntries: 2, maxMb: 1, sizeCalculation: () => 1 }).cache;
map.set('a', 1); map.set('b', 2); map.set('c', 3);
assert.equal(map.size, 2); assert.equal(map.has('a'), false); assert.equal(map.has('b'), true); assert.equal(map.has('c'), true);
map.set('b', 22); map.set('d', 4);
assert.equal(map.size, 2); assert.equal(map.has('c'), false); assert.equal(map.has('b'), true); assert.equal(map.has('d'), true);
assert.equal(map.get('b'), 22, 'expected updated value to be retained');

console.log('cross-file chunk dedupe map test passed');
