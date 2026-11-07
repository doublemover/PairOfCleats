import assert from 'node:assert/strict';
import { collectExpectedJudgments, computeRecallAtK, computeMRR, computeNDCG } from '../../tools/eval/metrics.js';
import { buildRetrievalHitKey, compareRetrievalHitLists } from '../../src/retrieval/hit-comparison.js';
const hits = [{ id: 0, file: 'a.js', name: 'foo', chunkUid: 'foo' }, { id: 1, file: 'a.js', name: 'bar', chunkUid: 'bar' }];
const match = (hit, expected) => hit.file === expected.file && (!expected.name || hit.name === expected.name);
for (const expected of [
  [{ file: 'a.js' }, { file: 'a.js', name: 'foo' }],
  [{ file: 'a.js', name: 'foo' }, { file: 'a.js' }],
  [{ file: 'a.js' }, { file: 'a.js' }, { file: 'a.js', name: 'foo' }]
]) {
  const result = collectExpectedJudgments(hits, expected, match);
  assert.deepEqual(result.ranks, [1, 2]);
  assert.equal(result.totalRelevant, 2);
  assert.equal(computeRecallAtK(result.ranks, result.totalRelevant, 10), 1);
  assert.equal(computeNDCG(result.ranks, result.totalRelevant, 10), 1);
  const one = collectExpectedJudgments(hits.slice(0, 1), expected, match);
  assert.deepEqual(one.ranks, [1], 'one actual hit cannot satisfy multiple distinct relevant slots');
  assert.equal(computeRecallAtK(one.ranks, one.totalRelevant, 10), 0.5);
  assert.ok(computeNDCG(one.ranks, one.totalRelevant, 10) <= 1);
}
const repeated = collectExpectedJudgments([hits[0], hits[0]], [{ file: 'a.js' }, { file: 'a.js', name: 'foo' }], match);
assert.deepEqual(repeated.ranks, [1]);
assert.equal(computeMRR([3, 5]), 1 / 3);
assert.throws(() => computeNDCG([1, 1], 2, 10));
assert.equal(compareRetrievalHitLists([{ id: 0 }], [{ id: 0 }]).comparable, false);
assert.equal(compareRetrievalHitLists([{ id: 0 }], [{ id: 0 }]).overlap, 0);
assert.equal(compareRetrievalHitLists(hits, hits.map(hit => ({ ...hit, id: hit.id + 100 }))).overlap, 1);
assert.notEqual(buildRetrievalHitKey({ ...hits[0], repoId: 'one' }), buildRetrievalHitKey({ ...hits[0], repoId: 'two' }));
assert.equal(compareRetrievalHitLists([{ id: 0 }], [{ id: 0 }], { idNamespace: 'authored-same-generation' }).overlap, 1);
console.log('evaluation judgment identity passed');
