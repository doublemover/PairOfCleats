import assert from 'node:assert/strict';
import { createLruCache, estimateStringBytes } from '../src/shared/cache.js';

const sizeCache = createLruCache({
  name: 'size-test',
  maxMb: 0.0001,
  ttlMs: 0,
  sizeCalculation: estimateStringBytes
});

sizeCache.set('a', 'a'.repeat(80));
sizeCache.set('b', 'b'.repeat(80));

const hasA = sizeCache.get('a') !== null;
const hasB = sizeCache.get('b') !== null;
assert.ok(!(hasA && hasB), 'expected size-based eviction');
assert.ok(sizeCache.stats.evictions >= 1, 'expected at least one eviction');

const ttlCache = createLruCache({
  name: 'ttl-test',
  maxMb: 1,
  ttlMs: 10,
  sizeCalculation: estimateStringBytes
});

ttlCache.set('x', 'value');
await new Promise((resolve) => setTimeout(resolve, 25));
const expired = ttlCache.get('x');
assert.equal(expired, null, 'expected ttl-based expiration');

console.log('cache lru test passed');
