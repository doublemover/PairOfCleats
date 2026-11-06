import assert from 'node:assert/strict';
import { causalValue, causalBinding, causalEquation, finiteCausalInput } from '../../helpers/finite-causal-model.js';
import { createFiniteCausalModel } from '../../../src/graph/hypotheses/finite-model.js';
import { createFiniteCausalPredictionService } from '../../../src/graph/hypotheses/predict.js';
import { planFiniteCausalDiscrimination } from '../../../src/graph/hypotheses/discriminate.js';
import { planFiniteModelIntervention, replayFiniteModelIntervention, readFiniteModelIntervention } from '../../../src/graph/hypotheses/paired-intervention.js';
import { deriveInvestigation } from '../../../src/context-pack/task-evidence/investigation.js';
import { compareInvestigationFiniteModelPair } from '../../../src/context-pack/task-evidence/causal-advice.js';
import { getOfflineEvaluationAdapter } from '../../../tools/eval/adapters.js';

const mode = process.env.PAIROFCLEATS_TEST_ID?.split('graph/hypotheses/paired-intervention/')[1];
assert.ok(['realized-descendant-replay', 'no-change-and-execution-cost', 'held-fixed-admissibility', 'hypothesis-revision-handoff', 'profile-contract-and-cancellation'].includes(mode));
const ref = variableId => ({ variableId, operationalDefinitionId: '1'.repeat(64) });
const bind = (variableId, value) => ({ ...ref(variableId), value: causalValue(value) });
const context = { taskRevision: 'task-1', branchId: 'branch-1', assumptionSetId: 'assumptions-1' };
const specFor = (model, assignedIntervention = [bind('X', true)]) => ({ schemaVersion: 1, pairId: '1'.repeat(64), taskSpecId: '2'.repeat(64),
  splitManifestId: '3'.repeat(64), questionId: model.questionId, worldId: model.worldId, context,
  exogenousAssignment: [causalBinding('U', false)], assignedIntervention, outcomeVariables: [ref('Y')], heldFixed: [],
  expectedRelation: 'directed-change', expectedTreatmentOutcome: [bind('Y', true)], estimand: 'same-unit-contrast-in-supplied-finite-model',
  executionProfile: { kind: 'finite-lookup-only', maxEquationSteps: 64, maxOutputBytes: 131072 } });
const model = createFiniteCausalModel(finiteCausalInput());
if (mode === 'realized-descendant-replay') {
  const adapter = await getOfflineEvaluationAdapter('finite-lookup-v1'), plan = adapter.plan({ model, spec: specFor(model) });
  assert.equal(plan.execution, 'none'); assert.equal(plan.sourceExecutionAuthority, 'none');
  const result = adapter.replay(plan);
  assert.deepEqual(result.baselineOutcome, [bind('Y', false)]); assert.deepEqual(result.treatmentOutcome, [bind('Y', true)]);
  assert.equal(result.negativeControl, 'pass'); assert.equal(result.realized[0].variableId, 'X');
  assert.equal(result.assignedInterventionId, result.realizedInterventionId); assert.notEqual(result.realized[0].originalMechanismId, result.realized[0].replacementMechanismId);
  assert.equal(adapter.inspect(result).treatmentValues.find(row => row.variableId === 'Y').value.value, true, 'nonintervened Y recomputes');
  assert.equal(result.work.actualEquationSteps, 4); assert.equal(result.causalStatus, 'identified-in-declared-model');
  assert.equal(result.axes.observedSourceExecution, false); assert.equal(result.axes.programCausalEffect, 'not-established');
} else if (mode === 'no-change-and-execution-cost') {
  const same = specFor(model, [bind('X', false)]); same.expectedRelation = 'invariant'; same.expectedTreatmentOutcome = [];
  const plan = planFiniteModelIntervention({ model, spec: same }), first = replayFiniteModelIntervention(plan), second = replayFiniteModelIntervention(plan);
  assert.equal(first.sameOutput, true); assert.equal(first.realization, 'complete-in-declared-model'); assert.equal(first.negativeControl, 'pass');
  assert.equal(first.realized.length, 1, 'same value is still a mechanism replacement'); assert.deepEqual(first.baselineOutcome, first.treatmentOutcome);
  assert.notEqual(first.receiptId, second.receiptId); assert.notEqual(first.baselineExecutionId, second.baselineExecutionId);
  assert.notEqual(first.treatmentExecutionId, second.treatmentExecutionId); assert.equal(first.comparisonId, second.comparisonId);
  assert.equal(first.work.actualEquationSteps + second.work.actualEquationSteps, 8, 'same immutable inputs do not conceal repeated actual work');
  const identity = specFor(model, []); identity.expectedRelation = 'invariant'; identity.expectedTreatmentOutcome = [];
  const zero = replayFiniteModelIntervention(planFiniteModelIntervention({ model, spec: identity }));
  assert.equal(zero.realized.length, 0); assert.equal(zero.sameOutput, true); assert.equal(zero.negativeControl, 'pass');
  assert.notEqual(zero.baselineExecutionId, zero.treatmentExecutionId, 'both actual passes have distinct execution identities even under no change');
} else if (mode === 'held-fixed-admissibility') {
  const invalid = specFor(model); invalid.heldFixed = [bind('Y', false)];
  const result = replayFiniteModelIntervention(planFiniteModelIntervention({ model, spec: invalid }));
  assert.equal(result.executionStatus, 'completed'); assert.equal(result.admissibility, 'failed'); assert.equal(result.negativeControl, 'not-admissible');
  assert.equal(result.causalStatus, 'unidentifiable'); assert.equal(result.violations[0].variableId, 'Y');
  const mismatchedBaseline = specFor(model); mismatchedBaseline.heldFixed = [bind('U', true)];
  assert.equal(replayFiniteModelIntervention(planFiniteModelIntervention({ model, spec: mismatchedBaseline })).admissibility, 'failed');
  const asserted = finiteCausalInput(); asserted.assumptions[0].status = 'contradicted'; const hypothesis = createFiniteCausalModel(asserted);
  assert.equal(replayFiniteModelIntervention(planFiniteModelIntervention({ model: hypothesis, spec: specFor(hypothesis) })).causalStatus, 'assumption-dependent');
} else if (mode === 'hypothesis-revision-handoff') {
  const alternative = finiteCausalInput(); alternative.equations[1] = causalEquation('Y', ['U'], [[[false], false], [[true], true]]);
  const common = createFiniteCausalModel(alternative), models = [model, common], service = createFiniteCausalPredictionService();
  const request = { schemaVersion: 1, modelIds: models.map(model => model.modelId), questionId: model.questionId, worldId: model.worldId, context,
    investigationRef: { investigationId: 'investigation-1', projectionRevision: 0 }, outcomeVariables: [ref('Y')], factualEvidence: [bind('X', false), bind('Y', false)],
    evidenceStatus: 'supplied-values', actions: [{ id: 'do-x', intervention: [bind('X', true)], heldFixed: [], admissibility: 'declared-in-finite-model',
      admissibilityReceiptIds: ['4'.repeat(64)], cost: { actionWork: 1, proofWork: 1 } }], limits: { workMs: 250, bytes: 131072 } };
  const predictions = models.map(candidate => {
    const query = { modelId: candidate.modelId, worldId: request.worldId, questionId: request.questionId, context,
      outcomeVariables: request.outcomeVariables, factualEvidence: request.factualEvidence, evidenceStatus: request.evidenceStatus, intervention: request.actions[0].intervention };
    let prediction = service({ model: candidate, query }); let pages = 0;
    while (prediction.cursor) { assert.ok(pages++ < 8); prediction = service({ model: candidate, query, request: { cursor: prediction.cursor } }); } return prediction;
  });
  const plan = planFiniteCausalDiscrimination({ models, request, predictions: predictions.map(prediction => ({ actionId: 'do-x', modelId: prediction.modelId, prediction })) });
  const source = finiteCausalInput().worldRef.source;
  const investigation = deriveInvestigation({ investigationId: 'investigation-1', ...context, beforeWorldRef: source, afterWorldRef: source,
    changes: [{ id: 'change', kind: 'body', afterRef: { sourceUnitId: 'su1:' + 'f'.repeat(64), span: [0, 1], coordinateUnit: 'utf16' } }] });
  const pair = replayFiniteModelIntervention(planFiniteModelIntervention({ model, spec: specFor(model) }));
  const options = { investigation, plan, actionId: 'do-x', pair, predictions };
  const comparison = compareInvestigationFiniteModelPair(options);
  assert.equal(comparison.admissible, true); assert.equal(comparison.consequences.find(row => row.modelId === common.modelId).status, 'model-counterexample');
  assert.equal(comparison.consequences.find(row => row.modelId === model.modelId).status, 'compatible-not-causal-confirmation');
  assert.equal(comparison.liveHypothesisUpdates, 0); assert.deepEqual(investigation.observations, []);
  assert.equal(comparison.evidenceClass, 'authored-finite-system-not-observed-program-execution');
  assert.throws(() => compareInvestigationFiniteModelPair({ ...options, investigation: { ...investigation, projectionRevision: 1 } }), { code: 'ERR_INVESTIGATION_CONFLICT' });
  const other = specFor(model); other.context = { ...context, branchId: 'another' };
  assert.throws(() => compareInvestigationFiniteModelPair({ ...options, pair: replayFiniteModelIntervention(planFiniteModelIntervention({ model, spec: other })) }), { code: 'ERR_FINITE_MODEL_INTERVENTION_SCOPE' });
  const outside = specFor(model); outside.exogenousAssignment = [causalBinding('U', true)]; outside.expectedRelation = 'unknown'; outside.expectedTreatmentOutcome = [];
  const noMatch = compareInvestigationFiniteModelPair({ ...options, pair: replayFiniteModelIntervention(planFiniteModelIntervention({ model, spec: outside })) });
  assert.equal(noMatch.admissible, false); assert.equal(noMatch.reason, 'baseline-outside-factual-condition');
  assert.ok(noMatch.consequences.every(row => row.consequence === 'no-model-elimination')); service.dispose();
} else {
  for (const mutate of [value => { value.worldId = '0'.repeat(64); }, value => { value.assignedIntervention = [bind('U', true)]; },
    value => { value.exogenousAssignment = []; }, value => { value.heldFixed = [{ ...bind('Y', true), operationalDefinitionId: '0'.repeat(64) }]; },
    value => { value.expectedTreatmentOutcome = []; }, value => { value.executionProfile.kind = 'shell'; },
    value => { value.assignedIntervention[0].value = causalValue(1); }, value => { value.execute = () => {}; }]) {
    const spec = specFor(model); mutate(spec); assert.throws(() => planFiniteModelIntervention({ model, spec }));
  }
  await assert.rejects(getOfflineEvaluationAdapter('shell'), { code: 'ERR_INTERVENTION_ADAPTER_UNAVAILABLE' });
  let reads = 0; await assert.rejects(getOfflineEvaluationAdapter({ toString() { reads++; return 'shell'; } })); assert.equal(reads, 0);
  const spec = specFor(model), plan = planFiniteModelIntervention({ model, spec }); spec.assignedIntervention[0].value.value = false;
  const result = replayFiniteModelIntervention(plan); assert.equal(result.treatmentOutcome[0].value.value, true);
  assert.throws(() => readFiniteModelIntervention({ ...result }), { code: 'ERR_FINITE_MODEL_INTERVENTION_HANDLE' });
  assert.throws(() => replayFiniteModelIntervention({ ...plan }), { code: 'ERR_FINITE_MODEL_INTERVENTION_HANDLE' });
  assert.throws(() => { result.realization = 'fake'; }, TypeError);
  const work = specFor(model); work.executionProfile.maxEquationSteps = 1;
  assert.throws(() => planFiniteModelIntervention({ model, spec: work }), { code: 'ERR_FINITE_MODEL_INTERVENTION_WORK_LIMIT' });
  const bytes = specFor(model); bytes.executionProfile.maxOutputBytes = 1024;
  assert.throws(() => replayFiniteModelIntervention(planFiniteModelIntervention({ model, spec: bytes })), { code: 'ERR_FINITE_MODEL_INTERVENTION_OUTPUT_LIMIT' });
  const controller = new AbortController(); controller.abort();
  assert.throws(() => replayFiniteModelIntervention(plan, { signal: controller.signal }), { name: 'AbortError' });
  assert.throws(() => planFiniteModelIntervention({ model, spec: specFor(model) }, { signal: controller.signal }), { name: 'AbortError' });
}
console.log('Paired finite-model interventions separate assignments, actual mechanism replacement, admissibility and qualified comparison.');
