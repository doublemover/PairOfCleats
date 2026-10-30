#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createSymbolRefCacheMaintenance } from '../../../src/index/type-inference-crossfile/symbol-ref-cache-maintenance.js';
const cache = new Map(), maintenance = createSymbolRefCacheMaintenance(cache, { maxEntries: 20, ttlMs: 100 });
const insert = (key, ts, value = null) => { cache.set(key, { ts, value }); maintenance.inserted(ts); if (cache.size > 20) maintenance.prune(ts); };
for (let index = 0; index < 100; index += 1) insert(String(index), 0);
assert.equal(cache.size, 20); assert.equal(maintenance.stats().expiryVisits, 0);
const old = cache.get('80'); cache.delete('80'); cache.set('80', old);
maintenance.prune(100); assert.equal(cache.has('80'), true, 'exact TTL boundary remains valid');
insert('new', 101); maintenance.prune(101);
assert.equal(cache.has('80'), false, 'a hit did not refresh insertion expiry');
assert.equal(cache.get('new').value, null, 'negative entries remain cached');
assert.equal(cache.size, 1); assert.ok(maintenance.stats().expiryVisits <= 20);
