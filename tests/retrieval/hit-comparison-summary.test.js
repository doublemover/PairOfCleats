#!/usr/bin/env node
import assert from 'node:assert/strict';
import { buildRetrievalHitKey, compareRetrievalHitLists, summarizeRetrievalHitComparison } from '../../src/retrieval/hit-comparison.js';

const baseHits = [
  { chunkUid: 'a', score: 0.9 },
  { chunkUid: 'b', score: 0.7 },
  { chunkUid: 'c', score: 0.3 }
];
const otherHits = [
  { chunkUid: 'b', score: 0.6 },
  { chunkUid: 'd', score: 0.5 },
  { chunkUid: 'e', score: 0.4 }
];

const summary = summarizeRetrievalHitComparison(baseHits, otherHits, {
  topN: 3,
  missingLimit: 1
});
assert.equal(summary.overlap, 1 / 3, 'expected overlap to use the top-N hit intersection');
assert.ok(Math.abs(summary.avgDelta - 0.1) < Number.EPSILON, 'expected score delta to come from shared comparator');
assert.deepEqual(summary.missingFromOther, [buildRetrievalHitKey({ chunkUid: 'a' })], 'expected missing-from-other list to honor the report limit');
assert.deepEqual(summary.missingFromBase, [buildRetrievalHitKey({ chunkUid: 'd' })], 'expected missing-from-base list to honor the report limit');
assert.equal(summary.zeroHits, false, 'non-empty comparisons should not be marked zero-hit');

const emptyDefault = summarizeRetrievalHitComparison([], [], { topN: 5 });
assert.equal(emptyDefault.overlap, 0, 'default empty comparison behavior should match compareRetrievalHitLists');
assert.equal(emptyDefault.zeroHits, true, 'empty comparisons should expose a zero-hit marker');

const emptyParity = summarizeRetrievalHitComparison([], [], {
  topN: 5,
  treatBothEmptyAsPerfect: true
});
assert.equal(emptyParity.overlap, 1, 'parity-style empty comparisons can opt into perfect overlap');
assert.deepEqual(emptyParity.baseKeys, [], 'empty comparisons should keep top key arrays empty');
assert.deepEqual(emptyParity.otherKeys, [], 'empty comparisons should keep top key arrays empty');

const hits = ids => ids.map(chunkUid => ({ chunkUid, score: 1 }));
const first = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
const displaced = ['k', 'l', 'm', 'n', 'o', 'p', 'q', 'r'];
for (const [label, left, right, expected] of [
  ['shifted shared order', first, [...displaced, 'a', 'b'], 1],
  ['shifted shared reverse', first, [...displaced, 'b', 'a'], -1],
  ['gapped three-hit swap', ['a', 'x', 'b', 'y', 'c'], ['z', 'a', 'w', 'c', 'v', 'b'], 0.5],
  ['gapped three-hit rotation', ['a', 'x', 'b', 'y', 'c'], ['z', 'b', 'w', 'c', 'v', 'a'], -0.5],
  ['identical full membership', first, first, 1],
  ['reversed full membership', first, [...first].reverse(), -1]
]) {
  const actual = compareRetrievalHitLists(hits(left), hits(right));
  assert.equal(actual.rankCorr, expected, label);
  assert.ok(Number.isFinite(actual.rankCorr) && actual.rankCorr >= -1 && actual.rankCorr <= 1, label);
  assert.equal(summarizeRetrievalHitComparison(hits(left), hits(right)).rankCorr, expected,
    'report/parity summaries retain the shared correlation semantics');
}
const partial = compareRetrievalHitLists(hits(first), hits([...displaced, 'a', 'b']));
assert.equal(partial.overlap, 0.2, 'missing membership remains visible independently of relative order');
assert.equal(partial.top1Same, false);
assert.equal(compareRetrievalHitLists(hits(['a']), hits(['a'])).rankCorr, null);
assert.equal(compareRetrievalHitLists(hits(['a']), hits(['b'])).rankCorr, null);
assert.equal(compareRetrievalHitLists(hits(['a', 'a']), hits(['a'])).rankCorr, null,
  'repeated rows cannot create independent shared ranks');
assert.equal(compareRetrievalHitLists(hits(first), hits(first), { topN: 0 }).rankCorr, null);
const duplicates = compareRetrievalHitLists([{ chunkUid: 'a', score: 1 }, { chunkUid: 'a', score: 99 }], [{ chunkUid: 'a', score: 1 }]);
assert.equal(duplicates.overlap, 1);
assert.equal(duplicates.avgDelta, 0, 'the first ranked occurrence owns the distinct hit score');
assert.equal(duplicates.baseKeys.length, 1);
assert.deepEqual(duplicates.missingFromOther, []);

console.log('hit comparison summary test passed');
