#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createSymbolRefCacheMaintenance } from '../../../src/index/type-inference-crossfile/symbol-ref-cache-maintenance.js';
const cache = new Map(), maintenance = createSymbolRefCacheMaintenance(cache, { maxEntries: 20, ttlMs: 100 });
const insert = (key, ts, value = null) => { cache.set(key, { ts, value }); maintenance.inserted(key, ts); if (cache.size > 20) maintenance.prune(ts); };
for (let index = 0; index < 100; index += 1) insert(String(index), 0);
assert.equal(cache.size, 20); assert.equal(maintenance.stats().expiryVisits, 0);
const old = cache.get('80'); cache.delete('80'); cache.set('80', old);
maintenance.prune(100); assert.equal(cache.has('80'), true, 'exact TTL boundary remains valid');
insert('new', 101); maintenance.prune(101);
assert.equal(cache.has('80'), false, 'a hit did not refresh insertion expiry');
assert.equal(cache.get('new').value, null, 'negative entries remain cached');
assert.equal(cache.size, 1); assert.ok(maintenance.stats().expiryVisits <= 20);

// Staggered expirations previously triggered one complete cache sweep per tick.
// Visits here count original expired nodes; compaction/heap work is separate.
const staggered = new Map(), scheduled = createSymbolRefCacheMaintenance(staggered, { maxEntries: 20000, ttlMs: 300000 });
for (let index = 0; index < 20000; index++) {
  const key = 'old-' + index; staggered.set(key, { ts: index, value: null }); scheduled.inserted(key, index);
}
for (let index = 0; index < 5000; index++) {
  scheduled.prune(300001 + index);
  const key = 'fresh-' + index, timestamp = 300001 + index;
  staggered.set(key, { ts: timestamp, value: index }); scheduled.inserted(key, timestamp);
}
const work = scheduled.stats();
assert.equal(work.expiryVisits, 5000); assert.equal(staggered.size, 20000);
assert.ok(work.heapComparisons < 1500000, 'bound actual heap comparisons, not only the number of expiry calls');
assert.ok(work.scheduledEntries <= 40000); assert.equal(work.trackedEntries, staggered.size);

// Reinsertion, rolling overflow and backwards clocks cannot leave an unbounded
// secondary schedule or allow an old node to delete a newer negative result.
const rolling = new Map(), owner = createSymbolRefCacheMaintenance(rolling, { maxEntries: 20, ttlMs: 100 });
for (let index = 0; index < 500; index++) {
  const key = String(index % 25), timestamp = index;
  rolling.delete(key); rolling.set(key, { ts: timestamp, value: null }); owner.inserted(key, timestamp); owner.prune(timestamp);
}
assert.equal(rolling.size, 20); assert.ok(owner.stats().maxScheduledEntries <= 41);
const newer = rolling.get('24'); owner.prune(450); assert.equal(rolling.get('24'), newer);
owner.prune(599); assert.equal(rolling.has('24'), true, 'last insertion remains valid at its exact TTL');
owner.prune(600); assert.equal(rolling.size, 0); assert.equal(owner.stats().scheduledEntries, 0);
assert.equal(owner.stats().trackedEntries, 0);
const hot = new Map(), hotOwner = createSymbolRefCacheMaintenance(hot, { maxEntries: 20, ttlMs: 100 });
for (let index = 0; index < 19; index++) {
  hot.set('held-' + index, { ts: 0, value: index }); hotOwner.inserted('held-' + index, 0);
}
for (let timestamp = 1; timestamp <= 80; timestamp++) {
  hot.set('hot', { ts: timestamp, value: null }); hotOwner.inserted('hot', timestamp); hotOwner.prune(timestamp);
}
assert.ok(hotOwner.stats().compactions > 0); assert.ok(hotOwner.stats().maxScheduledEntries <= 41);
hotOwner.prune(101); assert.equal(hot.size, 1); assert.equal(hot.get('hot').ts, 80);
hotOwner.prune(180); assert.equal(hot.has('hot'), true); hotOwner.prune(181); assert.equal(hot.size, 0);
console.log('Symbol cache expiry uses a bounded heap without repeated full-cache sweeps.');
