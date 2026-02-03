#!/usr/bin/env node
import { createTopKReducer, compareTopKEntries } from '../../../src/retrieval/pipeline/topk.js';

const total = 2000;
const k = 8;

const items = [];
for (let i = 0; i < total; i += 1) {
  items.push({ idx: i, score: total - i, sourceRank: i });
}

const reducer = createTopKReducer({
  k,
  sorted: true
});

for (const item of items) {
  const stop = reducer.pushRaw(item.score, item.idx, item.sourceRank);
  if (stop) break;
}

const result = reducer.finish({ limit: k });
const baseline = items
  .slice()
  .sort((a, b) => compareTopKEntries(
    { score: a.score, id: a.idx, sourceRank: a.sourceRank },
    { score: b.score, id: b.idx, sourceRank: b.sourceRank }
  ))
  .slice(0, k);

if (reducer.stats.cutoffs <= 0) {
  console.error('candidates early cutoff failed: cutoff not triggered.');
  process.exit(1);
}
if (result.length !== baseline.length) {
  console.error('candidates early cutoff failed: length mismatch.');
  process.exit(1);
}
for (let i = 0; i < result.length; i += 1) {
  if (result[i].idx !== baseline[i].idx || result[i].score !== baseline[i].score) {
    console.error('candidates early cutoff failed: result mismatch.');
    process.exit(1);
  }
}

console.log('candidates early cutoff test passed');
