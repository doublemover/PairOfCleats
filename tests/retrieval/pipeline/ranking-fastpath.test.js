#!/usr/bin/env node
import { applyTestEnv } from '../../helpers/test-env.js';
import assert from 'node:assert/strict';
import { compareTopKEntries, selectTopK } from '../../../src/retrieval/pipeline/topk.js';

applyTestEnv();

const items = Array.from({ length: 500 }, (_, i) => ({
  idx: i,
  score: ((i * 73) % 97) + (i % 5) * 0.01
}));
const k = 5;
const stats = {};
const result = selectTopK(items, {
  k,
  score: (item) => item.score,
  id: (item) => item.idx,
  sourceRank: (_, index) => index,
  stats
});

const expected = items
  .map((item, index) => ({
    item,
    score: item.score,
    id: item.idx,
    sourceRank: index
  }))
  .sort(compareTopKEntries)
  .slice(0, k)
  .map((entry) => entry.item.idx);

assert.deepEqual(
  result.map((item) => item.idx),
  expected,
  'expected topk to match full sort'
);
assert.equal(stats.usedHeap, true, 'expected heap fastpath');
assert.equal(stats.usedSort, false, 'expected heap path to avoid full sort');

console.log('ranking fastpath test passed');
