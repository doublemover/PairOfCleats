import assert from 'node:assert/strict';
import { createRepositoryAnswerInput, answerQuotation } from '../../helpers/repository-answer-input.js';
import { compileAdmittedQueryAnswer, inspectAnswerRevision } from '../../../src/context-pack/answers/render.js';
import { evaluateAnswerIntegrityAttacks } from '../../../src/retrieval/evaluation/answer-integrity.js';
import { ANSWER_INTEGRITY_CASES } from '../../../src/contracts/schemas/answer-integrity-evaluation.js';
import { getOfflineEvaluationAdapter } from '../../../tools/eval/adapters.js';

const mode = process.env.PAIROFCLEATS_TEST_ID?.split('tooling/eval/answer-integrity-attacks/')[1];
assert.ok(['sealed-semantic-attacks', 'partial-and-unsupported-fixtures', 'replacement-input-is-historical', 'strict-profile-and-bounds'].includes(mode));
const create = (options = {}) => {
  const input = createRepositoryAnswerInput(options); input.quotations = [answerQuotation('if ready, retain 5 units.')];
  return { schemaVersion: 1, revision: compileAdmittedQueryAnswer(input), cases: [...ANSWER_INTEGRITY_CASES] };
};
if (mode === 'sealed-semantic-attacks') {
  const adapter = await getOfflineEvaluationAdapter('retained-answer-integrity-v1'), input = create(), before = structuredClone(input);
  const result = adapter.evaluate(input);
  assert.equal(result.complete, true); assert.equal(result.allExpectedResultsObserved, true); assert.deepEqual(input, before);
  assert.equal(result.results.length, 8); assert.equal(result.results.filter(row => row.actual === 'rejected').length, 6);
  for (const row of result.results) {
    assert.equal(row.status, 'checked'); assert.equal(row.envelope, 'public-digest-and-byte-counters-recomputed');
    assert.equal(row.currentSourceAuthority, false); assert.equal(row.satisfied, true);
    if (row.expected === 'rejected') assert.equal(row.rejectionClass, 'integrity-contract', 'a byte-budget rejection is not proof of semantic integrity checking');
  }
  assert.equal(result.results.find(row => row.id === 'moved-citation').actual, 'rejected');
  assert.equal(result.results.find(row => row.id === 'removed-qualification').actual, 'rejected');
  assert.equal(result.results.find(row => row.id === 'changed-numeric-value').actual, 'rejected');
  assert.equal(result.currentSourceAuthority, false); assert.equal(result.executorReliance, 'not-measured');
} else if (mode === 'partial-and-unsupported-fixtures') {
  const input = create({ partial: true }); input.cases = ['identity-control', 'changed-numeric-value', 'removed-qualification'];
  const result = evaluateAnswerIntegrityAttacks(input);
  assert.equal(result.complete, true); assert.equal(result.allExpectedResultsObserved, true);
  assert.equal(inspectAnswerRevision(input.revision).qualification.questionCoverage, 'retained-question-partial');
  const empty = { schemaVersion: 1, revision: compileAdmittedQueryAnswer(createRepositoryAnswerInput({ count: 0 })),
    cases: ['negated-predicate', 'changed-quotation', 'replacement-input-control'] };
  const unsupported = evaluateAnswerIntegrityAttacks(empty);
  assert.equal(unsupported.complete, true); assert.equal(unsupported.allExpectedResultsObserved, false);
  assert.ok(unsupported.results.every(row => row.status === 'unsupported-fixture' && row.satisfied === false), 'unsupported fixtures cannot disappear as successful checks');
} else if (mode === 'replacement-input-is-historical') {
  const input = create(); input.cases = ['replacement-input-control'];
  const report = evaluateAnswerIntegrityAttacks(input), control = report.results[0];
  assert.equal(control.actual, 'accepted'); assert.equal(control.satisfied, true);
  assert.equal(report.checkedInputAuthority, 'supplied-historical-report-integrity-only');
  assert.equal(report.currentSourceAuthority, false); assert.equal(report.sourceSupportTruth, 'requires-independent-current-source-admission');
  assert.equal(report.freeTextEntailment, 'not-assessed'); assert.equal(report.taskOutcome, 'not-assessed');
  assert.equal(control.meaning, 'different-self-consistent-input-is-historical-only');
} else {
  const input = create();
  for (const mutate of [value => { value.cases = ['unknown-attack']; }, value => { value.cases.push(value.cases[0]); },
    value => { value.execute = () => {}; }, value => { value.revision.text += 'unsupported claim'; }]) {
    const invalid = structuredClone(input); mutate(invalid); assert.throws(() => evaluateAnswerIntegrityAttacks(invalid));
  }
  assert.throws(() => evaluateAnswerIntegrityAttacks(input, { maxOutputBytes: 1024 }), { code: 'ERR_ANSWER_INTEGRITY_OUTPUT_LIMIT' });
  const controller = new AbortController(); controller.abort();
  assert.throws(() => evaluateAnswerIntegrityAttacks(input, { signal: controller.signal }), { name: 'AbortError' });
  let reads = 0; const accessor = { ...input, get cases() { reads++; return []; } };
  assert.throws(() => evaluateAnswerIntegrityAttacks(accessor)); assert.equal(reads, 0);
  assert.deepEqual(inspectAnswerRevision(input.revision), input.revision);
}
console.log('Re-sealed answer attacks preserve meaningful integrity coverage and distinguish historical consistency from current source authority.');
