import assert from 'node:assert/strict';
import { selectEvaluationCohort } from '../../../tools/eval/cohorts.js';
import { captureEvaluationJudgments } from '../../../tools/eval/judgments.js';
import { matchExpected } from '../../../tools/eval/match.js';
import { collectExpectedJudgments, computeRecallAtK, computeMRR, computeNDCG } from '../../../tools/eval/metrics.js';

// Actual cohort, judgment, matcher and metric consumers. No runner/search/cache,
// process/model/browser/native or benchmark boundary is invoked.
let getterReads = 0;
const accessor = (value, key, answer) => Object.defineProperty(value, key, { get() { getterReads++; return answer; } });
const inherited = (rows, value) => { Object.setPrototypeOf(rows, Object.create(Array.prototype, { 0: { get() { getterReads++; return value; } } })); return rows; };
const actual = { file: 'src/a.js', name: 'foobar', kind: 'function', chunkUid: 'original-a' };
for (const rows of [accessor(new Array(1), 0, 1), inherited(new Array(1), 1)]) {
  for (const compute of [value => computeRecallAtK(value, 1, 1), computeMRR, value => computeNDCG(value, 1, 1)]) assert.throws(() => compute(rows));
}
assert.equal(getterReads, 0, 'rank accessors/inherited entries cannot execute to mint quality evidence');
const ranks = [2, 4];
ranks.filter = ranks.reduce = () => assert.fail('caller array methods are not admitted metric computations');
ranks[Symbol.iterator] = () => assert.fail('caller iterator cannot substitute original rank slots');
assert.equal(computeRecallAtK(ranks, 2, 2), 0.5); assert.equal(computeMRR(ranks), 0.5);
assert.equal(computeNDCG(ranks, 2, 4), (1 / Math.log2(3) + 1 / Math.log2(5)) / (1 + 1 / Math.log2(3)));
for (const denominator of [undefined, null, false, 0, 1, 2.5, NaN]) {
  assert.throws(() => computeRecallAtK(ranks, denominator, 2)); assert.throws(() => computeNDCG(ranks, denominator, 2));
}
for (const rows of [accessor(new Array(1), 0, { file: actual.file }), inherited(new Array(1), { file: actual.file })]) {
  assert.throws(() => captureEvaluationJudgments(rows), value => value.code === 'ERR_EVAL_JUDGMENT');
}
for (const rows of [accessor(new Array(1), 0, actual), inherited(new Array(1), actual)]) {
  assert.throws(() => collectExpectedJudgments(rows, [{ file: actual.file }], matchExpected), value => value.code === 'ERR_EVAL_HIT_IDENTITY');
  assert.throws(() => selectEvaluationCohort({ code: rows }, 'code'), value => value.code === 'ERR_EVAL_RESPONSE');
}
assert.equal(getterReads, 0, 'row admission reads only original data descriptors');
for (const payload of [accessor({ code: [] }, 'ok', true), accessor({}, 'code', []),
  accessor({ code: [] }, 'outputBudget', { truncated: true, omittedHits: 0 }),
  { code: [], outputBudget: accessor({ truncated: true }, 'omittedHits', 0) },
  { code: [], outputBudget: accessor({ omittedHits: 0 }, 'truncated', true) },
  Object.assign(Object.create({ ok: true }), { code: [] }), Object.create({ code: [] }),
  { code: [], outputBudget: Object.assign(Object.create({ omittedHits: 0 }), { truncated: false }) }]) {
  assert.throws(() => selectEvaluationCohort(payload, 'code'), value => value.code === 'ERR_EVAL_RESPONSE');
}
assert.equal(getterReads, 0, 'successful envelope/retention receipt/selected cohort require passive own evidence');
const unchanged = [actual]; assert.equal(selectEvaluationCohort({ ok: true, code: unchanged }, 'code'), unchanged,
  'cohort selection preserves existing returned hit references; metric admission owns its private capture');

for (const key of ['file', 'chunkUid', 'name', 'kind', 'mode', 'repoId', 'repoRoot', 'start', 'end', 'startLine', 'endLine', 'metaV2']) {
  const hit = { ...actual }; delete hit[key]; accessor(hit, key, key === 'metaV2' ? { chunkUid: 'original-a' } : 'forged');
  assert.throws(() => collectExpectedJudgments([hit], [{ file: actual.file }], matchExpected), value => value.code === 'ERR_EVAL_HIT_IDENTITY');
  assert.throws(() => matchExpected(hit, { file: actual.file }, 'exact'), value => value.code === 'ERR_EVAL_HIT_IDENTITY');
}
assert.throws(() => collectExpectedJudgments([{ file: actual.file, metaV2: accessor({}, 'chunkUid', 'forged') }], [{ file: actual.file }], matchExpected));
assert.throws(() => collectExpectedJudgments([Object.assign(Object.create({ file: actual.file }), { name: actual.name })], [{ name: 'foo' }], matchExpected));
assert.equal(getterReads, 0);
for (const extra of [{ repoId: {} }, { repoRoot: false }, { mode: 'all' }, { start: {} }, { end: Infinity },
  { startLine: 0 }, { endLine: '2' }, { start: 5, end: 4 }, { startLine: 3, endLine: 2 }, { metaV2: { chunkUid: {} } }]) {
  assert.throws(() => collectExpectedJudgments([{ ...actual, ...extra }], [{ file: actual.file }], matchExpected), value => value.code === 'ERR_EVAL_HIT_IDENTITY');
}
const noisy = { ...actual, name: { toString() { assert.fail('opaque name cannot mint identity or match'); } }, kind: 123 };
assert.equal(matchExpected(noisy, { name: '123' }, 'substring'), false); assert.equal(matchExpected(noisy, { kind: '123' }, 'exact'), false);

const rows = [{ file: 'src/a.js', name: 'foo', chunkUid: 'first' }, { file: 'src/a.js', name: 'bar', chunkUid: 'second' }];
const predicates = [{ file: 'src/a.js' }, { file: 'src/a.js', name: 'foo' }];
const decisions = new Map(); let callbackCalls = 0;
const quality = collectExpectedJudgments(rows, predicates, (hit, expected) => {
  callbackCalls++; assert(Object.isFrozen(hit)); assert(Object.isFrozen(expected));
  const key = `${hit.chunkUid}:${expected.name || '*'}`;
  assert(!decisions.has(key), 'one original boolean decision per hit/judgment pair survives augmenting reassignment'); decisions.set(key, true);
  rows[0].name = 'replacement'; rows[0].file = 'foreign.js'; rows[1].chunkUid = 'first'; rows[1] = { file: 'foreign.js' };
  return matchExpected(hit, expected, 'substring');
});
assert.deepEqual(quality.ranks, [1, 2]); assert.equal(quality.totalRelevant, 2); assert(callbackCalls <= 4);
assert(Object.isFrozen(quality)); assert(Object.isFrozen(quality.ranks));
assert.equal(computeRecallAtK(quality.ranks, quality.totalRelevant, 2), 1);
assert.equal(computeMRR(quality.ranks), 1); assert.equal(computeNDCG(quality.ranks, quality.totalRelevant, 2), 1);
const visits = new Map();
const repeatedPaths = collectExpectedJudgments([
  { chunkUid: 'file-only-1', file: 'src/a.js', name: 'bar' }, { chunkUid: 'name-only', file: 'src/b.js', name: 'foo' },
  { chunkUid: 'file-only-2', file: 'src/a.js', name: 'baz' }, { chunkUid: 'file-only-3', file: 'src/a.js', name: 'qux' }
], [{ file: 'src/a.js' }, { name: 'foo' }], (hit, expected) => {
  const key = `${hit.chunkUid}:${expected.file || expected.name}`;
  visits.set(key, (visits.get(key) || 0) + 1); assert.equal(visits.get(key), 1, 'failed augmenting paths cannot re-read a prior negative decision');
  return matchExpected(hit, expected);
});
assert.deepEqual(repeatedPaths.ranks, [1, 2]); assert.equal(visits.get('file-only-1:foo'), 1);
for (const value of [undefined, null, 0, 1, '', 'yes', {}, []]) {
  assert.throws(() => collectExpectedJudgments([actual], [{ file: actual.file }], () => value), error => error.code === 'ERR_EVAL_MATCH' && error.cause === value);
}
const unknownDecision = Object.freeze(Object.defineProperties({}, {
  cacheOwnershipReleased: { value: () => false }, message: { get() { assert.fail('nonboolean decision is not inspected or adopted'); } }
}));
assert.throws(() => collectExpectedJudgments([actual], [{ file: actual.file }], () => unknownDecision), error => {
  assert.equal(error.cause, unknownDecision); assert.equal(error.cause.cacheOwnershipReleased(), false); return true;
});
for (const primary of [undefined, null, false, 0, '']) {
  let observed = Symbol('not observed');
  try { collectExpectedJudgments([actual], [{ file: actual.file }], () => { throw primary; }); } catch (error) { observed = error; }
  assert.equal(observed, primary, 'falsey original matcher failure cannot become a negative or positive relevance decision');
  const trapped = new Proxy([actual], { getOwnPropertyDescriptor() { throw primary; } });
  observed = Symbol('not observed');
  try { collectExpectedJudgments(trapped, [{ file: actual.file }], matchExpected); } catch (error) { observed = error; }
  assert.equal(observed, primary, 'original descriptor inspection failure propagates exactly');
}
const metadata = { chunkUid: 'metadata-original' }, metaRow = { file: 'src/m.js', metaV2: metadata };
const capturedMetadata = collectExpectedJudgments([metaRow], [{ file: 'src/m.js' }], (hit, expected) => {
  metadata.chunkUid = 'foreign'; assert(Object.isFrozen(hit.metaV2)); assert.equal(hit.metaV2.chunkUid, 'metadata-original'); return matchExpected(hit, expected); });
assert.deepEqual(capturedMetadata.ranks, [1]);
assert.deepEqual(collectExpectedJudgments([{}], [], matchExpected).ranks, [], 'unjudged input stays unjudged without manufacturing identity or labels');
console.log('Passive original rank/hit/judgment/envelope and one-shot match decision controls authored; execution deferred.');
