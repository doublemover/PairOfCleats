#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  stableOrder,
  stableBucketOrder,
  stableOrderMapEntries,
  orderRepoMapEntries
} from '../../../src/shared/order.js';

const items = [
  { id: 1, key: 'b', bucket: 'z', value: 2 },
  { id: 2, key: 'a', bucket: 'y', value: 2 },
  { id: 3, key: 'a', bucket: 'y', value: 1 },
  { id: 4, key: 'a', bucket: 'z', value: 2 }
];

const ordered = stableOrder(items, ['key', 'value']);
assert.deepEqual(ordered.map((item) => item.id), [3, 2, 4, 1]);

const bucketed = stableBucketOrder(items, 'bucket', ['key', 'value']);
assert.deepEqual(bucketed.map((item) => item.id), [3, 2, 4, 1]);

const map = new Map([
  ['b', 1],
  ['a', 2],
  ['c', 3]
]);
const mapEntries = stableOrderMapEntries(map);
assert.deepEqual(mapEntries.map((entry) => entry.key), ['a', 'b', 'c']);

const repoEntries = orderRepoMapEntries([
  { file: 'b.js', name: 'z', kind: 'Function', signature: 'b', startLine: 2, endLine: 4 },
  { file: 'a.js', name: 'b', kind: 'Function', signature: 'a', startLine: 1, endLine: 2 },
  { file: 'a.js', name: 'a', kind: 'Function', signature: 'a', startLine: 1, endLine: 2 }
]);
assert.deepEqual(repoEntries.map((entry) => entry.name), ['a', 'b', 'z']);

console.log('ordering helpers tests passed');
