#!/usr/bin/env node
import assert from 'node:assert/strict';
import { summarizeRetrievalHitComparison } from '../../src/retrieval/hit-comparison.js';

const baseHits = [
  { id: 'a', score: 0.9 },
  { id: 'b', score: 0.7 },
  { id: 'c', score: 0.3 }
];
const otherHits = [
  { id: 'b', score: 0.6 },
  { id: 'd', score: 0.5 },
  { id: 'e', score: 0.4 }
];

const summary = summarizeRetrievalHitComparison(baseHits, otherHits, {
  topN: 3,
  missingLimit: 1
});
assert.equal(summary.overlap, 1 / 3, 'expected overlap to use the top-N hit intersection');
assert.ok(Math.abs(summary.avgDelta - 0.1) < Number.EPSILON, 'expected score delta to come from shared comparator');
assert.deepEqual(summary.missingFromOther, ['a'], 'expected missing-from-other list to honor the report limit');
assert.deepEqual(summary.missingFromBase, ['d'], 'expected missing-from-base list to honor the report limit');
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

console.log('hit comparison summary test passed');
