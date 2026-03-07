#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createOrderingHasher, stableOrderWithComparator } from '../../../src/shared/order.js';
import { compareChunkMetaRows } from '../../../src/index/build/artifacts/helpers.js';

const hashRows = (rows) => {
  const hasher = createOrderingHasher();
  for (const row of rows) {
    hasher.update(JSON.stringify(row));
  }
  return hasher.digest();
};

const rowsA = [
  { file: 'b.js', chunkUid: 'ck:b', chunkId: 'b-1', id: 1, start: 20, name: 'Beta' },
  { file: 'a.js', chunkUid: 'ck:a', chunkId: 'a-1', id: 0, start: 10, name: 'Alpha' },
  { file: 'a.js', chunkUid: 'ck:a2', chunkId: 'a-2', id: 2, start: 40, name: 'Gamma' }
];
const rowsB = [rowsA[2], rowsA[0], rowsA[1]];

const orderedA = stableOrderWithComparator(rowsA, compareChunkMetaRows);
const orderedB = stableOrderWithComparator(rowsB, compareChunkMetaRows);

const hashA = hashRows(orderedA);
const hashB = hashRows(orderedB);

assert.equal(hashA.hash, hashB.hash, 'ordering hash should be stable across input ordering');
assert.equal(hashA.count, orderedA.length, 'ordering hash count should match row count');

const hashUnordered = hashRows(rowsB);
assert.notEqual(hashA.hash, hashUnordered.hash, 'ordering hash should change when ordering changes');

console.log('ordering hash tests passed');
