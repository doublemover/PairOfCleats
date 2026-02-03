#!/usr/bin/env node
import { createTopKReducer } from '../../../src/retrieval/pipeline/topk.js';

const total = 50000;
const k = 10;
const slack = 5;

const reducer = createTopKReducer({
  k,
  slack,
  sorted: true
});

for (let i = 0; i < total; i += 1) {
  const score = total - i;
  const stop = reducer.pushRaw(score, i, i);
  if (stop) break;
}

const stats = reducer.stats;
if (!stats.usedHeap) {
  console.error('candidates memory plateau failed: heap path not used.');
  process.exit(1);
}
if (stats.maxSize > k + slack) {
  console.error(`candidates memory plateau failed: heap grew to ${stats.maxSize}.`);
  process.exit(1);
}

console.log('candidates memory plateau test passed');
