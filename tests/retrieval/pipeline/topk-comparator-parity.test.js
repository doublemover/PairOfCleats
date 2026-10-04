#!/usr/bin/env node
import assert from 'node:assert/strict';
import { compareTopKEntries, createTopKReducer, selectTopK } from '../../../src/retrieval/pipeline/topk.js';

// Retain the previous comparator, including coercion and nonfinite behavior.
const legacyCompare = (a, b) => {
  const normalizeId = (value) => typeof value === 'number' && Number.isFinite(value)
    ? { type: 'number', value }
    : { type: 'string', value: value == null ? '' : String(value) };
  const scoreA = Number.isFinite(a?.score) ? a.score : -Infinity;
  const scoreB = Number.isFinite(b?.score) ? b.score : -Infinity;
  if (scoreA !== scoreB) return scoreB - scoreA;
  const left = normalizeId(a?.id);
  const right = normalizeId(b?.id);
  if (left.type !== right.type) return left.type === 'number' ? -1 : 1;
  if (left.value < right.value) return -1;
  if (left.value > right.value) return 1;
  const rankA = Number.isFinite(a?.sourceRank) ? a.sourceRank : 0;
  const rankB = Number.isFinite(b?.sourceRank) ? b.sourceRank : 0;
  return rankA - rankB;
};

const ids = [
  -1, -0, 0, 1, 2, 10, Number.MAX_SAFE_INTEGER, NaN, Infinity, -Infinity,
  '', '0', '2', '10', 'a', '漢字', '👩🏽‍💻', null, undefined, false, 2n, Symbol('id'),
  { toString: () => 'object-id' }
];
let comparisons = 0;
for (const idA of ids) {
  for (const idB of ids) {
    for (const [scoreA, scoreB] of [[1, 1], [2, 1], [NaN, Infinity], ['2', undefined]]) {
      for (const [rankA, rankB] of [[0, 1], [1, 0], [NaN, undefined]]) {
        const a = { id: idA, score: scoreA, sourceRank: rankA };
        const b = { id: idB, score: scoreB, sourceRank: rankB };
        assert.equal(compareTopKEntries(a, b), legacyCompare(a, b));
        comparisons += 1;
      }
    }
  }
}

// Small-list sort still evaluates each selector in its original order, even if
// score differences mean the resulting IDs/ranks will not be compared.
const trace = [];
const selectors = {
  score: (item) => { trace.push(`score:${item.name}`); return item.score; },
  id: (item) => {
    trace.push(`id:${item.name}`);
    return { toString: () => { trace.push(`string:${item.name}`); return item.id; } };
  },
  sourceRank: (item) => { trace.push(`rank:${item.name}`); return item.rank; }
};
const rows = [
  { name: 'a', id: '2', score: 1, rank: 1 },
  { name: 'b', id: '10', score: 1, rank: 0 },
  { name: 'c', id: '2', score: 2, rank: 0 },
  { name: 'd', id: '2', score: 1, rank: 0 }
];
const buildLegacyEntry = (item) => ({
  score: selectors.score(item),
  id: selectors.id(item),
  sourceRank: selectors.sourceRank(item)
});
const expected = rows.slice().sort((a, b) => legacyCompare(buildLegacyEntry(a), buildLegacyEntry(b)));
const expectedTrace = [...trace];
for (const k of [rows.length, 2]) {
  trace.length = 0;
  assert.deepEqual(selectTopK(rows, { k, ...selectors }), expected.slice(0, k));
  assert.deepEqual(trace, expectedTrace);
}

// Number-vs-string ordering still performs prior object coercion and propagates
// its error rather than silently avoiding a user-provided conversion.
let conversions = 0;
const objectId = { toString: () => { conversions += 1; return '1'; } };
assert.equal(compareTopKEntries({ id: 1, score: 1 }, { id: objectId, score: 1 }), -1);
assert.equal(conversions, 1);
const badId = { toString: () => { throw new Error('conversion failure'); } };
assert.throws(() => compareTopKEntries({ id: 1, score: 1 }, { id: badId, score: 1 }), /conversion failure/);

const tiedRows = Array.from({ length: 96 }, (_, index) => ({
  idx: index % 3 === 0 ? String(index % 11) : index % 11,
  score: (index * 17) % 5,
  sourceRank: index,
  label: index
}));
const sortedReference = tiedRows.slice().sort((a, b) => legacyCompare(
  { id: a.idx, score: a.score, sourceRank: a.sourceRank },
  { id: b.idx, score: b.score, sourceRank: b.sourceRank }
));
for (const k of [1, 7, 96]) {
  for (const minHeapSize of [0, 1000]) {
    assert.deepEqual(selectTopK(tiedRows, { k, minHeapSize }), sortedReference.slice(0, k));
  }
  const reducer = createTopKReducer({ k, buildPayload: (entry) => entry.item });
  for (const item of tiedRows) reducer.push(item);
  assert.deepEqual(reducer.finish(), sortedReference.slice(0, k));
}

console.log(`topk comparator parity passed: ${comparisons} comparisons, selector/coercion order, heap/sort ties`);
