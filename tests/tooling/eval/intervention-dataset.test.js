import assert from 'node:assert/strict';
import { makeTaskSpanTrace, taskTraceFixtureHash as hash, TASK_TRACE_FIXTURE_QUERY as query } from '../../helpers/task-span-trace-fixture.js';
import { finiteCausalInput, causalBinding, causalValue } from '../../helpers/finite-causal-model.js';
import { createRepositoryAnswerInput, answerQuotation } from '../../helpers/repository-answer-input.js';
import { createFiniteCausalModel } from '../../../src/graph/hypotheses/finite-model.js';
import { compileAdmittedQueryAnswer } from '../../../src/context-pack/answers/render.js';
import { captureDatasetInterventions, evaluateDatasetInterventions } from '../../../tools/eval/interventions/dataset.js';

const mode = process.env.PAIROFCLEATS_TEST_ID?.split('tooling/eval/intervention-dataset/')[1];
assert.ok(['explicit-profile-report', 'capture-and-refusal-boundaries', 'profile-errors-and-report-bounds'].includes(mode));
const ref = variableId => ({ variableId, operationalDefinitionId: '1'.repeat(64) });
const binding = (variableId, value) => ({ ...ref(variableId), value: causalValue(value) });
const make = () => {
  const model = finiteCausalInput(), handle = createFiniteCausalModel(model), trace = makeTaskSpanTrace();
  const answerInput = createRepositoryAnswerInput(); answerInput.quotations = [answerQuotation('original source')];
  const context = { taskRevision: 'task-1', branchId: 'branch-1', assumptionSetId: 'assumptions-1' };
  return { schemaVersion: 1, queryDigest: hash(query), trials: [
    { id: hash('model-trial'), profile: 'finite-lookup-v1', model, spec: { schemaVersion: 1, pairId: hash('pair'), taskSpecId: hash('task'),
      splitManifestId: hash('split'), questionId: handle.questionId, worldId: handle.worldId, context,
      exogenousAssignment: [causalBinding('U', false)], assignedIntervention: [binding('X', true)], outcomeVariables: [ref('Y')], heldFixed: [],
      expectedRelation: 'directed-change', expectedTreatmentOutcome: [binding('Y', true)], estimand: 'same-unit-contrast-in-supplied-finite-model',
      executionProfile: { kind: 'finite-lookup-only', maxEquationSteps: 64, maxOutputBytes: 131072 } } },
    { id: hash('origin-trial'), profile: 'origin-observation-v1', input: { schemaVersion: 1, trace,
      origins: [{ id: hash('origin'), dependenceGroupId: null, independence: 'unknown', assumptionIds: [] }],
      sourceBindings: trace.sources.map(source => ({ sourceKey: source.key, originIds: [hash('origin')], lineage: 'authored-origin', lineageReceiptId: hash(source.key) })), edges: [] } },
    { id: hash('answer-trial'), profile: 'retained-answer-integrity-v1', input: { schemaVersion: 1,
      revision: compileAdmittedQueryAnswer(answerInput), cases: ['identity-control', 'negated-predicate', 'replacement-input-control'] } }
  ] };
};
const capture = data => captureDatasetInterventions([{ query, entry: { interventionEvidence: data } }]);
if (mode === 'explicit-profile-report') {
  assert.equal(await captureDatasetInterventions([{ query, entry: {} }]), null); assert.equal(await evaluateDatasetInterventions(null), null);
  const input = await capture(make()), report = await evaluateDatasetInterventions(input);
  assert.equal(report.complete, true); assert.equal(report.currentSearchEvidence, false); assert.equal(report.summary.evaluatedTrials, 3);
  assert.equal(report.summary.refusedProfiles, 0); assert.equal(report.summary.refusedInputs, 0);
  assert.equal(report.trials[0].payload.realization, 'complete-in-declared-model'); assert.equal(report.trials[0].payload.negativeControl, 'pass');
  assert.equal(report.trials[1].payload.stageOrigins.retrieved.distinctOriginIds, 1);
  assert.equal(report.trials[2].payload.allExpectedResultsObserved, true); assert.equal(report.trials[2].payload.currentSourceAuthority, false);
  assert.equal(report.policyQualification, 'not-established'); assert.equal(report.taskOutcome, 'not-assessed'); assert.equal(report.decision, null);
} else if (mode === 'capture-and-refusal-boundaries') {
  const data = make(), pending = capture(data); data.trials[0].spec.assignedIntervention[0].value.value = false;
  const owned = await pending, report = await evaluateDatasetInterventions(owned);
  assert.equal(report.trials[0].payload.treatmentOutcome[0].value.value, true, 'caller containers are owned before asynchronous schema loading');
  await assert.rejects(evaluateDatasetInterventions({ ...owned }), { code: 'ERR_EVAL_INTERVENTION_INPUT' });
  for (const mutate of [value => { value.queryDigest = '0'.repeat(64); }, value => { value.trials[0].profile = 'shell'; },
    value => { value.trials.push(structuredClone(value.trials[0])); }, value => { value.trials[1].input.trace.identity.queryDigest = '0'.repeat(64); }]) {
    const invalid = make(); mutate(invalid); const refused = await evaluateDatasetInterventions(await capture(invalid));
    assert.equal(refused.complete, false); assert.equal(refused.summary.refusedInputs, 1); assert.equal(refused.summary.evaluatedTrials, 0);
  }
  let reads = 0;
  const accessor = { get interventionEvidence() { reads++; return make(); } };
  const refused = await evaluateDatasetInterventions(await captureDatasetInterventions([{ query, entry: accessor }]));
  assert.equal(reads, 0); assert.equal(refused.summary.refusedInputs, 1);
  const original = Object.assign(new Error('original descriptor failure'), { code: 'EIO' });
  const proxy = new Proxy({}, { getOwnPropertyDescriptor() { throw original; } });
  await assert.rejects(captureDatasetInterventions([{ query, entry: proxy }]), error => error === original);
} else {
  const invalid = make(); invalid.trials = [invalid.trials[0]]; invalid.trials[0].model.equations[0].rows.pop();
  const report = await evaluateDatasetInterventions(await capture(invalid));
  assert.equal(report.complete, false); assert.equal(report.summary.refusedProfiles, 1);
  assert.equal(report.trials[0].code, 'ERR_FINITE_CAUSAL_CONTRACT'); assert.match(report.trials[0].reason, /Incomplete finite equation/);
  const input = await capture(make()), bounded = await evaluateDatasetInterventions(input, { maxOutputBytes: 2048 });
  assert.equal(bounded.complete, false); assert.equal(bounded.summary.unreportedTrials, 3); assert.equal(bounded.summary.evaluatedTrials, 0);
  assert.ok(bounded.remaining[0].reason.includes('output-budget')); assert.ok(Buffer.byteLength(JSON.stringify(bounded)) + 1 <= 2048);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(evaluateDatasetInterventions(input, { signal: controller.signal }), { name: 'AbortError' });
  await assert.rejects(evaluateDatasetInterventions(input, { maxMs: 1001 }));
}
console.log('Optional offline profiles retain captured inputs and explicit failures without changing current search qualification.');
