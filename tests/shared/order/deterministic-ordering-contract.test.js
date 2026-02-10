#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  createOrderingHasher,
  stableOrder,
  stableOrderWithComparator
} from '../../../src/shared/order.js';

const rowsA = [
  { file: 'b.js', line: 2, id: 'b2' },
  { file: 'a.js', line: 1, id: 'a1' },
  { file: 'a.js', line: 3, id: 'a3' }
];
const rowsB = [
  { file: 'a.js', line: 3, id: 'a3' },
  { file: 'b.js', line: 2, id: 'b2' },
  { file: 'a.js', line: 1, id: 'a1' }
];

const selectors = [(row) => row.file, (row) => row.line];
const orderedA = stableOrder(rowsA, selectors).map((row) => row.id);
const orderedB = stableOrder(rowsB, selectors).map((row) => row.id);
assert.deepEqual(orderedA, ['a1', 'a3', 'b2']);
assert.deepEqual(orderedB, orderedA, 'expected stableOrder determinism across input permutations');

const tieRows = [
  { key: 'same', value: 1 },
  { key: 'same', value: 2 },
  { key: 'same', value: 3 }
];
const tieOrdered = stableOrderWithComparator(tieRows, (left, right) => left.key.localeCompare(right.key));
assert.deepEqual(
  tieOrdered.map((row) => row.value),
  [1, 2, 3],
  'expected stable comparator tie-break by original index'
);

const hasherA = createOrderingHasher();
hasherA.update('row:1');
hasherA.update('row:2');
const digestA = hasherA.digest();

const hasherB = createOrderingHasher();
hasherB.update('row:1');
hasherB.update('row:2');
const digestB = hasherB.digest();

assert.equal(digestA.hash, digestB.hash, 'expected deterministic hash output');
assert.equal(digestA.count, 2);

console.log('deterministic ordering contract test passed');
