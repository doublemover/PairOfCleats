#!/usr/bin/env node
import assert from 'node:assert/strict';

import { compareChunkMetaRows } from '../../../src/index/build/artifacts/helpers.js';
import {
  createOrderingHasher,
  orderRepoMapEntries,
  stableBucketOrder,
  stableOrder,
  stableOrderMapEntries,
  stableOrderWithComparator
} from '../../../src/shared/order.js';

const hashRows = (rows) => {
  const hasher = createOrderingHasher();
  for (const row of rows) {
    hasher.update(JSON.stringify(row));
  }
  return hasher.digest();
};

const cases = [
  {
    name: 'stable ordering is deterministic across permutations and ties',
    run() {
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
      assert.deepEqual(orderedB, orderedA);

      const tieRows = [
        { key: 'same', value: 1 },
        { key: 'same', value: 2 },
        { key: 'same', value: 3 }
      ];
      const tieOrdered = stableOrderWithComparator(tieRows, (left, right) => left.key.localeCompare(right.key));
      assert.deepEqual(tieOrdered.map((row) => row.value), [1, 2, 3]);
    }
  },
  {
    name: 'bucket ordering and repo map ordering stay stable',
    run() {
      const items = [
        { id: 1, key: 'b', bucket: 'z', value: 2 },
        { id: 2, key: 'a', bucket: 'y', value: 2 },
        { id: 3, key: 'a', bucket: 'y', value: 1 },
        { id: 4, key: 'a', bucket: 'z', value: 2 }
      ];
      assert.deepEqual(stableOrder(items, ['key', 'value']).map((item) => item.id), [3, 2, 4, 1]);
      assert.deepEqual(
        stableOrderWithComparator(items, (left, right) => {
          if (left.key !== right.key) return left.key.localeCompare(right.key);
          return left.value - right.value;
        }).map((item) => item.id),
        [3, 2, 4, 1]
      );
      assert.deepEqual(stableBucketOrder(items, 'bucket', ['key', 'value']).map((item) => item.id), [3, 2, 4, 1]);

      const map = new Map([
        ['b', 1],
        ['a', 2],
        ['c', 3]
      ]);
      assert.deepEqual(stableOrderMapEntries(map).map((entry) => entry.key), ['a', 'b', 'c']);

      const repoEntries = orderRepoMapEntries([
        { file: 'b.js', name: 'z', kind: 'Function', signature: 'b', startLine: 2, endLine: 4 },
        { file: 'a.js', name: 'b', kind: 'Function', signature: 'a', startLine: 1, endLine: 2 },
        { file: 'a.js', name: 'a', kind: 'Function', signature: 'a', startLine: 1, endLine: 2 }
      ]);
      assert.deepEqual(repoEntries.map((entry) => entry.name), ['a', 'b', 'z']);
    }
  },
  {
    name: 'ordering hashes are deterministic for sorted artifact rows',
    run() {
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
      assert.equal(hashA.hash, hashB.hash);
      assert.equal(hashA.count, orderedA.length);
      assert.notEqual(hashA.hash, hashRows(rowsB).hash);
    }
  }
];

for (const entry of cases) {
  entry.run();
}

console.log('shared order contract matrix test passed');
