#!/usr/bin/env node
import { applyTestEnv } from '../../helpers/test-env.js';
import assert from 'node:assert/strict';
import { compareTopKEntries, selectTopK } from '../../../src/retrieval/pipeline/topk.js';

applyTestEnv();

const makeRng = (seed) => {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
};

const buildExpected = (items, k) => {
  const entries = items.map((item, index) => ({
    item,
    score: item.score,
    id: item.idx,
    sourceRank: index
  }));
  return entries
    .slice()
    .sort(compareTopKEntries)
    .slice(0, k)
    .map((entry) => entry.item);
};

const runSeed = (seed) => {
  const rng = makeRng(seed);
  const items = Array.from({ length: 200 }, (_, i) => ({
    idx: i,
    score: Math.round(rng() * 1000) / 1000
  }));
  const k = 15;
  const expected = buildExpected(items, k);
  const result = selectTopK(items, {
    k,
    score: (item) => item.score,
    id: (item) => item.idx,
    sourceRank: (_, index) => index
  });
  assert.deepEqual(
    result.map((item) => item.idx),
    expected.map((item) => item.idx),
    `topk mismatch for seed ${seed}`
  );
};

runSeed(11);
runSeed(42);
runSeed(1337);

console.log('topk equivalence test passed');
