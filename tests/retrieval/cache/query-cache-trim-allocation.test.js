import assert from 'node:assert/strict';
import { findQueryCacheEntry, rememberQueryCacheEntry } from '../../../src/retrieval/query-cache.js';

const cachePath = 'synthetic-query-trim-allocation';
const entries = [3, 2, 3, 1, 4, 0, -1, '4'].map((ts, i) => ({
  key: `trim-fixture-${i}`, signature: 'sig', ts, payload: `value-${i}`
}));
const update = { ...entries[2], ts: 10, payload: 'updated' };
const ninth = { key: 'trim-fixture-8', signature: 'sig', ts: 4, payload: 'ninth' };
const input = [...entries, update, ninth];
input.forEach((entry) => Object.freeze(entry));
const expected = new Map();
let copies = 0;
let copiedReferences = 0;
const slice = Array.prototype.slice;
Array.prototype.slice = function(...args) {
  const isTupleArray = this.length > 0 && Array.isArray(this[0]) && typeof this[0][0] === 'string'
    && this[0][0].startsWith('trim-fixture-');
  const result = slice.apply(this, args);
  if (isTupleArray) { copies += 1; copiedReferences += result.length; }
  return result;
};
try {
  for (const entry of input) {
    rememberQueryCacheEntry(cachePath, entry.key, entry.signature, entry, 4);
    expected.set(`${entry.key}::${entry.signature}`, entry);
    if (expected.size > 4) {
      const sorted = [...expected].sort((left, right) => Number(right[1].ts) - Number(left[1].ts));
      expected.clear();
      for (const [key, value] of sorted.slice(0, 4)) expected.set(key, value);
    }
    for (let i = 0; i <= 8; i += 1) {
      const key = `trim-fixture-${i}`;
      const actual = findQueryCacheEntry({ entries: [] }, key, 'sig', { cachePath, strategy: 'memory-first' });
      assert.equal(actual, expected.get(`${key}::sig`) || null, 'same surviving key and exact entry reference');
    }
  }
} finally { Array.prototype.slice = slice; }
// The reference oracle's five four-entry prefix copies are excluded below.
const ownerCopies = copies - 5;
const ownerReferences = copiedReferences - 20;
console.log(`query hot-cache trim copies${ownerCopies}, references${ownerReferences}`);
assert.equal(ownerCopies, 5, 'one independent sorted snapshot per overflow, no second capped prefix copy');
assert.equal(ownerReferences, 25);
assert.equal(findQueryCacheEntry({ entries: [] }, 'trim-fixture-2', 'wrong', { cachePath, strategy: 'memory-first' }), null);
console.log('query cache trim allocation passed: stable timestamp ties, older late entries, upsert references and signature isolation preserved');
