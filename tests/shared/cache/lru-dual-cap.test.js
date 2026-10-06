#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createLruCache } from '../../../src/shared/cache/lru.js';
import {
  configureOutputCaches,
  getFileTextCache,
  getSummaryCache
} from '../../../src/retrieval/output/cache.js';

const mb = (bytes) => bytes / (1024 * 1024);
let sizingCalls = 0;
const sized = (value) => { sizingCalls++; return value.length; };
const disposed = [];
const cache = createLruCache({
  name: 'dual-cap', maxEntries: 2, maxMb: mb(10), sizeCalculation: sized,
  onEvict: ({ key, reason }) => disposed.push([key, reason])
});
cache.set('a', '123456');
cache.set('b', '123456');
assert.equal(cache.get('a'), null, 'byte cap must apply even below entry cap');
assert.equal(cache.size(), 1);
cache.set('c', '1');
cache.set('d', '2');
assert.equal(cache.get('b'), null, 'entry cap must apply even below byte cap');
assert.equal(cache.size(), 2);
assert.equal(cache.cache.calculatedSize, 2);
assert.equal(cache.stats.maxEntries, 2);
assert.equal(cache.stats.maxSizeBytes, 10);
assert.deepEqual(disposed, [['a', 'evict'], ['b', 'evict']]);
cache.set('c', '123456789');
assert.equal(cache.cache.calculatedSize, 10);
cache.set('c', '1');
assert.equal(cache.cache.calculatedSize, 2, 'replacement must return retired bytes');
cache.delete('c');
assert.equal(cache.cache.calculatedSize, 1);
cache.clear();
assert.equal(cache.cache.calculatedSize, 0);
assert.equal(sizingCalls, 6);

for (const maxEntries of [null, undefined]) {
  const bytesOnly = createLruCache({ name: 'nullable-entries', maxEntries, maxMb: mb(8), sizeCalculation: sized });
  bytesOnly.set('a', '12345678');
  assert.equal(bytesOnly.get('a'), '12345678', 'absent entry cap must preserve byte-backed caching');
  bytesOnly.set('b', '9');
  assert.equal(bytesOnly.get('a'), null);
  bytesOnly.clear();
}
const noSizer = () => { throw new Error('entry-only/no-cache must not inspect payload size'); };
const entriesOnly = createLruCache({ name: 'entries-only', maxEntries: 1, sizeCalculation: noSizer });
entriesOnly.set('a', {});
entriesOnly.set('b', {});
assert.equal(entriesOnly.size(), 1);
const callbacks = [];
const disabled = createLruCache({
  name: 'disabled', maxEntries: 0, maxMb: 1, sizeCalculation: noSizer,
  onSet: () => callbacks.push('set'), onMiss: () => callbacks.push('miss'),
  onDelete: () => callbacks.push('delete'), onClear: () => callbacks.push('clear'),
  onSizeChange: (size) => assert.equal(size, 0)
});
disabled.set('a', {});
assert.equal(disabled.get('a'), null);
disabled.delete('a');
disabled.clear();
assert.deepEqual(callbacks, ['set', 'miss', 'delete', 'clear']);
assert.equal(disabled.cache, null);

const ttlDisposed = [];
const ttl = createLruCache({ name: 'dual-ttl', maxEntries: 2, maxMb: mb(20), ttlMs: 5,
  sizeCalculation: sized, onEvict: ({ reason }) => ttlDisposed.push(reason) });
ttl.set('a', '12');
await new Promise((resolve) => setTimeout(resolve, 25));
assert.equal(ttl.get('a'), null);
assert.deepEqual(ttlDisposed, ['expire']);

const held = { size: 6, references: 1, retired: false, closed: false };
const leases = createLruCache({ name: 'leased', maxEntries: 2, maxMb: mb(10),
  sizeCalculation: (value) => value.size,
  onEvict: ({ value }) => { value.retired = true; if (!value.references) value.closed = true; } });
leases.set('held', held);
leases.set('next', { size: 6, references: 0, retired: false, closed: false });
assert.equal(held.retired, true);
assert.equal(held.closed, false, 'eviction callback must preserve caller-owned lease lifetime');
held.references--;
if (held.retired && !held.references) held.closed = true;
assert.equal(held.closed, true);
leases.clear();

// The output owner uses null to mean that its environment entry cap is absent.
delete process.env.PAIROFCLEATS_FILE_CACHE_MAX;
delete process.env.PAIROFCLEATS_SUMMARY_CACHE_MAX;
configureOutputCaches({ cacheConfig: {} });
for (const outputCache of [getFileTextCache(), getSummaryCache()]) {
  outputCache.set('default-policy', 'retained text');
  assert.equal(outputCache.get('default-policy'), 'retained text');
  assert.ok(outputCache.stats.maxSizeBytes > 0);
  outputCache.clear();
}
console.log('dual-cap LRU policy, TTL, callbacks and lease lifetime passed');
