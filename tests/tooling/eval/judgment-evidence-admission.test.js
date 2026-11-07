import assert from 'node:assert/strict';
import { captureEvaluationJudgment, captureEvaluationJudgments } from '../../../tools/eval/judgments.js';
import { resolveEvaluationCohorts, judgmentsForCohort } from '../../../tools/eval/cohorts.js';
import { matchExpected } from '../../../tools/eval/match.js';
import { collectExpectedJudgments, computeRecallAtK, computeMRR, computeNDCG } from '../../../tools/eval/metrics.js';

// Actual shared cohort/matcher/metric consumers; no search/process/model calls.
const invalidJudgment = error => { assert.equal(error.code, 'ERR_EVAL_JUDGMENT'); return true; };
const hit = { file: 'src/a.js', name: 'foobar', kind: 'Function' };
for (const row of [null, false, 0, '', [], {}, { mode: 'code' }, { id: 'unsupported matcher' },
  { file: '' }, { file: '  ' }, { name: false }, { kind: {} }, { file: 'src/a.js', name: '' },
  ...[null, false, 0, '', undefined, 'all', 'Code', 'code '].map(mode => ({ mode, file: 'src/a.js' }))]) {
  assert.throws(() => captureEvaluationJudgment(row), invalidJudgment);
  assert.throws(() => resolveEvaluationCohorts('code', [row]), invalidJudgment);
  assert.throws(() => judgmentsForCohort([row], 'code'), invalidJudgment);
  assert.throws(() => collectExpectedJudgments([hit], [row], (actual, expected) => matchExpected(actual, expected, 'substring'), { mode: 'code' }), invalidJudgment);
  assert.throws(() => matchExpected(hit, row, 'exact'), invalidJudgment);
}
for (const rows of [null, false, 'labels', {}, new Array(1), [undefined]]) assert.throws(() => captureEvaluationJudgments(rows), invalidJudgment);
const inherited = Object.create({ file: 'src/a.js' });
assert.throws(() => captureEvaluationJudgment(inherited), invalidJudgment);
assert.throws(() => captureEvaluationJudgment(Object.assign(Object.create({ mode: 'code' }), { file: 'src/a.js' })), invalidJudgment);
let reads = 0;
const accessor = Object.defineProperty({}, 'file', { get() { reads++; return 'src/a.js'; } });
assert.throws(() => captureEvaluationJudgment(accessor), invalidJudgment); assert.equal(reads, 0, 'an accessor cannot mint label evidence');
const original = { file: 'src/a.js', name: 'foo' };
Object.defineProperty(original, 'comment', { get() { assert.fail('metadata is not a matcher field'); } });
const captured = captureEvaluationJudgment(original); assert(Object.isFrozen(captured)); assert.notEqual(captured, original);
assert.equal(captureEvaluationJudgment(captured), captured); original.name = 'replacement';
assert.equal(captured.name, 'foo'); assert.equal(matchExpected(hit, captured, 'substring'), true);
assert.throws(() => captureEvaluationJudgment(Object.freeze({})), invalidJudgment, 'a frozen lookalike has no private admission proof');
assert.equal(matchExpected({ ...hit, name: 123 }, { name: '123' }, 'substring'), false, 'numeric hit data is not coerced into a symbol name');
assert.equal(matchExpected({ ...hit, kind: 123 }, { kind: '123' }, 'exact'), false);
assert.throws(() => matchExpected(hit, { file: hit.file }, 'unsupported'), /Invalid match mode/);

assert.deepEqual(resolveEvaluationCohorts('all', [{ mode: 'records', file: 'record.json' }]).modes, ['code', 'prose', 'extracted-prose', 'records']);
assert.throws(() => resolveEvaluationCohorts('all', [{ file: hit.file }]), /explicit mode/);
assert.throws(() => resolveEvaluationCohorts('code', [{ mode: 'records', file: 'record.json' }]), /outside/);
const scoped = judgmentsForCohort([{ mode: 'records', file: 'record.json' }, { mode: 'code', file: hit.file }], 'code');
assert.deepEqual(scoped, [{ mode: 'code', file: hit.file }]); assert(Object.isFrozen(scoped[0]));
assert.throws(() => judgmentsForCohort([], 'all'), invalidJudgment);
assert.throws(() => collectExpectedJudgments([hit], scoped, matchExpected), /selected evaluation cohort/);
assert.throws(() => collectExpectedJudgments([hit], [{ mode: 'records', file: 'record.json' }], matchExpected, { mode: 'code' }), /selected evaluation cohort/);

const hits = [{ file: 'noise.js', name: 'noise' }, hit, { ...hit }, { file: hit.file, name: 'bar', kind: 'function' }];
const expected = [{ file: hit.file }, { file: hit.file, name: 'foo' }, { file: hit.file, name: 'FOO' }];
const actual = collectExpectedJudgments(hits, expected, matchExpected, { mode: 'code' });
assert.deepEqual(actual.ranks, [2, 4]); assert.equal(actual.totalRelevant, 2);
assert.equal(actual.policy, 'distinct-document-one-to-one.v1');
assert.equal(computeRecallAtK(actual.ranks, actual.totalRelevant, 2), 0.5); assert.equal(computeMRR(actual.ranks), 0.5);
const handNdcg = (1 / Math.log2(3) + 1 / Math.log2(5)) / (1 + 1 / Math.log2(3));
assert.equal(computeNDCG(actual.ranks, actual.totalRelevant, 4), handNdcg);
assert.deepEqual(collectExpectedJudgments([], expected, matchExpected, { mode: 'code' }).ranks, []);
assert.deepEqual(collectExpectedJudgments([{}], [], matchExpected), { ranks: [], totalRelevant: 0, policy: 'distinct-document-one-to-one.v1' },
  'unjudged rows do not fabricate judged quality or require a distinct-document denominator');

const mutation = { file: hit.file, name: 'foo' };
const immutable = collectExpectedJudgments([hit], [mutation], (actualHit, label) => {
  mutation.name = 'never matches'; assert.notEqual(label, mutation); assert(Object.isFrozen(label));
  return matchExpected(actualHit, label, 'substring');
});
assert.deepEqual(immutable.ranks, [1], 'a callback sees only the issued immutable predicate');
for (const rows of [null, {}, new Array(1), [null], ['row']]) assert.throws(() => collectExpectedJudgments(rows, [{ file: hit.file }], matchExpected));
for (const row of [{ id: 0, name: 'foo' }, { name: 'foo' }, { file: 123 }, { chunkUid: {} }, { chunkUid: '' }]) {
  assert.throws(() => collectExpectedJudgments([row], [{ name: 'foo' }], matchExpected), error => error.code === 'ERR_EVAL_HIT_IDENTITY');
}
assert.throws(() => collectExpectedJudgments([{ ...hit, mode: 'records' }], [{ file: hit.file }], matchExpected, { mode: 'code' }), /hit mode/);
for (const ranks of [new Array(1), [undefined], [NaN], [0], [1, 1], [1, , 3]]) {
  assert.throws(() => computeRecallAtK(ranks, 4, 4)); assert.throws(() => computeMRR(ranks)); assert.throws(() => computeNDCG(ranks, 4, 4));
}
const inheritedRank = new Array(1); Object.setPrototypeOf(inheritedRank, Object.create(Array.prototype, { 0: { value: 1 } }));
assert.throws(() => computeMRR(inheritedRank), /unique positive ranks/);
assert.equal(computeMRR(Array.from({ length: 200000 }, (_, index) => index + 1)), 1,
  'a bounded large rank list does not expand into native function arguments');
assert.equal(computeRecallAtK([], 1, 1), 0); assert.equal(computeMRR([]), 0); assert.equal(computeNDCG([], 1, 1), 0);
console.log('Actual evaluation judgment/cohort/matcher/metric evidence controls authored; execution deferred.');
