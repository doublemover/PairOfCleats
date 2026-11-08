import assert from 'node:assert/strict';
import { TimestampRetention } from '../../../src/retrieval/timestamp-retention.js';

const retained = new TimestampRetention();
let reference = new Map(), seed = 17;
const keys = Array.from({ length: 24 }, (_, id) => `key-${id}`);
const next = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
const numeric = entry => Number.isFinite(Number(entry?.ts)) ? Number(entry.ts) : 0;
const trimReference = cap => {
  if (reference.size <= cap) return;
  reference = new Map([...reference].sort((left, right) => numeric(right[1]) - numeric(left[1])).slice(0, cap));
};
for (let operation = 0; operation < 1000; operation++) {
  const key = keys[next() % keys.length], cap = 1 + next() % 12;
  if (operation % 4 === 0 && reference.has(key)) {
    // Timestamp touches can happen through a previously returned entry object.
    reference.get(key).ts = operation % 8 === 0 ? 5 : next() % 9;
  } else {
    const entry = { ts: operation % 7 === 0 ? NaN : next() % 9, value: operation };
    reference.set(key, entry); retained.set(key, entry);
  }
  trimReference(cap); retained.trim(cap);
  assert.equal(retained.size, reference.size);
  for (const candidate of keys) assert.equal(retained.get(candidate), reference.get(candidate), `operation ${operation}, ${candidate}`);
}

// A prior timestamp sort, rather than original insertion order or access-LRU,
// determines which equal-timestamp entry survives a later overflow.
const ties = new TimestampRetention(), a = { ts: 1 }, b = { ts: 3 }, c = { ts: 2 };
ties.set('a', a).set('b', b).set('c', c); ties.trim(2);
b.ts = 2;
ties.set('d', { ts: 2 }); ties.trim(2);
assert.equal(ties.get('b'), b);
assert.equal(ties.get('c'), c);
assert.equal(ties.get('d'), undefined);
const originalSort = Array.prototype.sort;
try {
  Array.prototype.sort = () => { throw new Error('hot retention must not sort the full resident cache'); };
  for (let id = 0; id < 128; id++) { ties.set(`overflow-${id}`, { ts: id + 10 }); ties.trim(16); }
} finally { Array.prototype.sort = originalSort; }
console.log('Timestamp retention preserves stable newest-write order under touches, replacement, resize and overflow.');
