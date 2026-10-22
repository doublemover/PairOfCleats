#!/usr/bin/env node
import assert from 'node:assert/strict';
import { rankBM25, rankBM25Fields } from '../../../src/retrieval/rankers.js';
import { admitSortedPostings } from '../../../src/shared/posting-order.js';

const count = 4096, lengths = Array.from({ length: count }, (_, id) => id < 32 ? 101 : 10);
const body = admitSortedPostings({ vocab: ['alpha', 'beta'], postings: [
  Array.from({ length: count }, (_, id) => [id, 1]), Array.from({ length: 32 }, (_, id) => [id, 100])
], docLengths: lengths, totalDocs: count, avgDocLen: lengths.reduce((sum, value) => sum + value, 0) / count });
const idx = { chunkMeta: Array.from({ length: count }, () => ({ weight: 1 })), tokenIndex: body };
const compare = (request, fielded = false) => {
  const rank = fielded ? rankBM25Fields : rankBM25;
  const work = {}, actual = rank({ ...request, work }), expected = rank({ ...request, scoreBoundPruning: false });
  assert.deepEqual(actual, expected, 'exact scores and cutoff tie order match the retained exhaustive owner');
  return { actual, work };
};
const request = { idx, tokens: ['alpha', 'beta', 'beta'], topN: 8, k1: 1.2, b: 0.75 };
const first = compare(request);
assert.equal(first.work.strategy, 'request-bound-wand');
assert.equal(first.work.retainedScoreMapEntries, 0);
assert.ok(first.work.postingsSkipped > 4000);
assert.ok(first.work.fullyScoredDocuments <= 32);
assert.equal(first.work.boundPostingRowsInspected, count + 32, 'request preparation cost is counted separately from score work avoided');
assert.deepEqual(first.actual.map(hit => hit.idx), Array.from({ length: 8 }, (_, id) => id), 'equality at the cutoff retains the lower ordinal');

const names = admitSortedPostings({ vocab: ['beta'], postings: [Array.from({ length: 32 }, (_, id) => [id, 1])],
  docLengths: Array.from({ length: count }, (_, id) => id < 32 ? 1 : 0), totalDocs: count, avgDocLen: 32 / count });
const fielded = { ...idx, fieldPostings: { fields: { name: names } } };
assert.equal(compare({ ...request, idx: fielded, fieldWeights: { body: 1.7, name: 5 } }, true).work.strategy, 'request-bound-wand');
idx.chunkMeta[4000].weight = 500000;
const late = compare(request);
assert.equal(late.actual[0].idx, 4000, 'a high-weight late common-term document cannot be pruned');
idx.chunkMeta[4000].weight = -2;
assert.equal(compare(request).work.boundFallback, 'length-tf-or-chunk-weight-domain');
idx.chunkMeta[4000].weight = Infinity;
assert.equal(compare(request).work.strategy, 'exhaustive');
idx.chunkMeta[4000].weight = 1;
const zero = compare({ ...request, includeZeroScores: true, allowedIdx: new Set([0, 1, 2, 4000]) });
assert.equal(zero.work.boundFallback, 'boolean-zero-completion');
const selective = compare({ ...request, allowedIdx: new Set([0, 2]) });
assert.equal(selective.work.boundFallback, 'selective-intersection');

let state = 123456789;
const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state; };
const broadLengths = Array.from({ length: 1200 }, () => 1 + random() % 30);
const broad = admitSortedPostings({ vocab: ['left', 'right'], postings: [0, 1].map(() =>
  Array.from({ length: 1200 }, (_, id) => [id, 1 + random() % 9])), docLengths: broadLengths,
  avgDocLen: broadLengths.reduce((sum, value) => sum + value, 0) / 1200, totalDocs: 1200 });
const worst = { chunkMeta: Array.from({ length: 1200 }, () => ({ weight: 0.1 + random() % 50 / 10 })), tokenIndex: broad };
for (const k1 of [0.1, 1.2, 16]) for (const b of [0, 0.75, 1]) compare({ idx: worst, tokens: ['right', 'left', 'right'], topN: 7, k1, b });
const unsorted = { ...broad, postings: [[...broad.postings[0]].reverse(), broad.postings[1]] };
admitSortedPostings(unsorted);
assert.equal(compare({ idx: { ...worst, tokenIndex: unsorted }, tokens: ['left', 'right'], topN: 7 }).work.boundFallback,
  'posting-or-frequency-domain');
console.log('Request-bound BM25 WAND preserves exact exhaustive scores/order with conservative unsupported-domain fallback.');
