#!/usr/bin/env node
import { applyTestEnv } from '../../helpers/test-env.js';
import assert from 'node:assert/strict';
import { compareTopKEntries, selectTopK } from '../../../src/retrieval/pipeline/topk.js';

applyTestEnv();

const items = [
  { idx: 'b', score: 1 },
  { idx: 2, score: 1 },
  { idx: 'a', score: 1 },
  { idx: 1, score: 1 },
  { idx: 1, score: 1, label: 'second-dup' }
];

const entries = items.map((item, index) => ({
  item,
  score: item.score,
  id: item.idx,
  sourceRank: index
}));

const expected = entries
  .slice()
  .sort(compareTopKEntries)
  .map((entry) => entry.item);

const result = selectTopK(items, {
  k: items.length,
  score: (item) => item.score,
  id: (item) => item.idx,
  sourceRank: (_, index) => index
});

assert.deepEqual(
  result.map((item) => item.idx),
  expected.map((item) => item.idx),
  'expected deterministic tie-break ordering'
);
assert.equal(
  result.findIndex((item) => item.label === 'second-dup') > result.findIndex((item) => item.idx === 1),
  true,
  'expected duplicate id ordering to follow source rank'
);

console.log('topk tie-break test passed');
