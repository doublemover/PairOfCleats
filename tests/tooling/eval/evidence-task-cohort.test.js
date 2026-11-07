import assert from 'node:assert/strict';
import { authoredEvidenceTask, evidenceTaskHash as hash } from '../../helpers/finite-evidence-task.js';
import { evaluateEvidenceTaskCohort, readEvidenceTaskCohort } from '../../../tools/eval/tasks/cohort.js';

const mode = process.env.PAIROFCLEATS_TEST_ID?.split('tooling/eval/evidence-task-cohort/')[1];
assert.ok(['shared-corpus-and-fixed-controls', 'failed-and-unknown-denominators', 'capture-cancellation-and-budgets'].includes(mode));
const policy = { schemaVersion: 1, seed: 'shared-corpus', train: 5000, dev: 2000, calibration: 1000, test: 2000 };
const candidate = method => ({ schemaVersion: 1, method, runId: hash('run-' + method), maxReadBytes: 1048576,
  maxSelectedFiles: 1, maxSelectedSourceBytes: 1048576, maxWorkMs: 100 });
const make = () => ({ schemaVersion: 1, compilations: ['first', 'second', 'third'].map(seed => {
  const input = authoredEvidenceTask(seed); input.spec.problem = 'Select main and helper together, or select the alternative.'; return input;
}), splitPolicy: policy, candidates: [candidate('lexical-visible-prefix-v1'), candidate('source-order-files-v1')] });
if (mode === 'shared-corpus-and-fixed-controls') {
  const input = make(), result = await evaluateEvidenceTaskCohort(input);
  assert.equal(result.complete, true); assert.equal(result.funnel.suppliedTasks, 3); assert.equal(result.funnel.declaredRuns, 6);
  assert.equal(result.funnel.executionStatuses.completed, 6); assert.equal(result.funnel.pass, 3); assert.equal(result.funnel.fail, 3);
  assert.equal(result.funnel.unknown, 0); assert.equal(result.outcomes.length, 6);
  for (const index of [0, 1, 2]) {
    const runs = result.outcomes.filter(row => row.taskIndex === index);
    assert.equal(runs[0].outcome.work.compilation.executionId, runs[1].outcome.work.compilation.executionId, 'one actual source preparation is shared');
    assert.equal(runs[0].outcome.work.split.executionId, runs[1].outcome.work.split.executionId);
    assert.equal(runs[0].outcome.taskSpecId, runs[1].outcome.taskSpecId);
    assert.equal(runs.find(row => row.method === 'lexical-visible-prefix-v1').taskResult, 'fail');
    assert.equal(runs.find(row => row.method === 'source-order-files-v1').taskResult, 'pass');
  }
  assert.equal(result.retirement.taskOwners.length, 3); assert.equal(result.retirement.candidateViews.length, 6);
  assert.ok(result.retirement.taskOwners.every(row => row.status === 'retired')); assert.equal(result.retirement.nativeResources, 'none');
  assert.equal(result.currentSearchEvidence, false); assert.equal(result.executedCandidateProgram, false);
  assert.equal(result.policyQualification, 'not-established'); assert.equal(readEvidenceTaskCohort(result).runs.length, 6);
  const repeated = await evaluateEvidenceTaskCohort(input);
  assert.equal(repeated.inputId, result.inputId); assert.equal(repeated.splitManifest.manifestId, result.splitManifest.manifestId);
  assert.notEqual(repeated.executionId, result.executionId); assert.notEqual(repeated.outcomes[0].outcome.receiptId, result.outcomes[0].outcome.receiptId);
  const anotherInvocation = structuredClone(input); anotherInvocation.candidates.forEach((row, index) => { row.runId = hash('another-run-' + index); });
  assert.equal((await evaluateEvidenceTaskCohort(anotherInvocation)).inputId, result.inputId, 'invocation-only labels cannot change semantic corpus identity');
} else if (mode === 'failed-and-unknown-denominators') {
  const input = structuredClone(make());
  input.compilations[0].sourceSnapshot[0].availableAt = 1000;
  input.compilations[1].privateOracle.units[0].source.span = [0, 0];
  input.compilations[2].privateOracle.validation.status = 'unverified';
  const result = await evaluateEvidenceTaskCohort(input);
  assert.equal(result.complete, false); assert.equal(result.funnel.declaredRuns, 6); assert.equal(result.funnel.quarantinedTasks, 2);
  assert.equal(result.funnel.executionStatuses['invalid-fixture'], 4); assert.equal(result.funnel.executionStatuses.completed, 2);
  assert.equal(result.funnel.unknown, 6); assert.equal(result.funnel.pass, 0);
  assert.ok(result.outcomes.filter(row => row.executionStatus === 'invalid-fixture').every(row => row.outcome.evidence.analysisState === 'not-evaluated-incomplete-run-or-fixture'));
  const invalid = structuredClone(make()); invalid.compilations[0].privateOracle.alternatives[0].groups[0].require = 2;
  const refused = await evaluateEvidenceTaskCohort(invalid);
  assert.equal(refused.funnel.invalidFixtures, 1); assert.equal(refused.funnel.executionStatuses['invalid-fixture'], 2);
  assert.equal(refused.retirement.taskOwners.length, 2, 'only successfully compiled original owners exist to retire');
  const tool = make(); tool.compilations = [tool.compilations[0]]; tool.compilations[0].spec.allowedActions = ['search-visible-source'];
  const failure = await evaluateEvidenceTaskCohort(tool);
  assert.equal(failure.complete, false); assert.equal(failure.funnel.executionStatuses['tool-error'], 1);
  assert.equal(failure.outcomes.find(row => row.executionStatus === 'tool-error').error.code, 'ERR_EVIDENCE_TASK_BASELINE');
  assert.equal(failure.retirement.taskOwners.length, 1); assert.equal(failure.retirement.candidateViews.length, 2);
} else {
  const input = make(), pending = evaluateEvidenceTaskCohort(input); input.compilations[0].spec.problem = 'Find alternative';
  const captured = await pending; assert.equal(captured.outcomes.find(row => row.taskIndex === 0 && row.method === 'lexical-visible-prefix-v1').taskResult, 'fail');
  assert.throws(() => readEvidenceTaskCohort({ ...captured }), { code: 'ERR_EVIDENCE_TASK_COHORT_INPUT' });
  const mismatch = make(); mismatch.candidates[1].maxReadBytes = 100;
  await assert.rejects(evaluateEvidenceTaskCohort(mismatch), { code: 'ERR_EVIDENCE_TASK_COHORT_INPUT' });
  await assert.rejects(evaluateEvidenceTaskCohort(make(), { maxOutputBytes: 1024 }), { code: 'ERR_EVIDENCE_TASK_COHORT_OUTPUT' });
  const controller = new AbortController(); setImmediate(() => controller.abort(0));
  await assert.rejects(evaluateEvidenceTaskCohort(make(), { signal: controller.signal }), error => {
    assert.equal(error.name, 'AbortError'); assert.equal(error.cause, 0);
    const partial = error.taskCohortPartial; assert.equal(partial.complete, false); assert.equal(partial.declaredRuns, 6);
    assert.equal(partial.completedRuns + partial.canceledRemaining, 6); assert.ok(partial.retiredTaskOwners > 0);
    assert.equal(partial.policyQualification, 'not-established'); return true;
  });
  const malformed = make(); malformed.compilations[0].privateOracle.alternatives[0].groups[0].require = 2;
  const afterInvalid = new AbortController(); setImmediate(() => afterInvalid.abort(false));
  await assert.rejects(evaluateEvidenceTaskCohort(malformed, { signal: afterInvalid.signal }), error => {
    assert.equal(error.cause, false); assert.equal(error.taskCohortPartial.invalidFixtureRuns, 2);
    assert.equal(error.taskCohortPartial.canceledRemaining, 4);
    assert.ok(error.taskCohortPartial.rows.filter(row => row.executionStatus === 'invalid-fixture').every(row => /Private q-of/.test(row.reason))); return true;
  });
  const pre = new AbortController(); pre.abort();
  await assert.rejects(evaluateEvidenceTaskCohort(make(), { signal: pre.signal }), { name: 'AbortError' });
}
console.log('Shared finite task cohorts preserve matched controls, actual setup identity, invalid/unknown outcomes and cancellation progress.');
