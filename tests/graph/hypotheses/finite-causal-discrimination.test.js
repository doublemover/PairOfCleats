import assert from 'node:assert/strict';
import { semanticHash } from '../../../src/index/semantic/identity.js';
import { causalValue, causalVariable, causalEquation, finiteCausalInput } from '../../helpers/finite-causal-model.js';
import { createFiniteCausalModel } from '../../../src/graph/hypotheses/finite-model.js';
import { createFiniteCausalPredictionService } from '../../../src/graph/hypotheses/predict.js';
import { planFiniteCausalDiscrimination } from '../../../src/graph/hypotheses/discriminate.js';
import { deriveInvestigation } from '../../../src/context-pack/task-evidence/investigation.js';
import { planInvestigationCausalEvidence } from '../../../src/context-pack/task-evidence/causal-advice.js';

const mode = process.env.PAIROFCLEATS_TEST_ID?.split('graph/hypotheses/finite-causal-discrimination/')[1];
assert.ok(['common-cause-minimax-and-ties', 'mediator-admissibility-and-held-fixed', 'compensating-and-nondiscriminating-actions',
  'overlapping-unknown-outcome-oracle', 'investigation-read-only-handoff'].includes(mode));
const reference = variableId => ({ variableId, operationalDefinitionId: '1'.repeat(64) });
const binding = (variableId, value) => ({ ...reference(variableId), value: causalValue(value) });
const action = (id, intervention, cost = 1) => ({ id, intervention, heldFixed: [], admissibility: 'declared-in-finite-model',
  admissibilityReceiptIds: ['b'.repeat(64)], cost: { actionWork: cost, proofWork: 1 } });
const context = { taskRevision: 'revision-1', branchId: 'branch-1', assumptionSetId: 'assumptions-1' };
const requestFor = (models, actions, factualEvidence = [], outcomeVariables = ['Y']) => ({ schemaVersion: 1,
  modelIds: models.map(model => model.modelId), questionId: models[0].questionId, worldId: models[0].worldId, context,
  investigationRef: { investigationId: 'investigation-1', projectionRevision: 0 }, outcomeVariables: outcomeVariables.map(reference),
  factualEvidence, evidenceStatus: 'supplied-values', actions, limits: { workMs: 250, bytes: 131072 } });
const collect = (models, request, service, { partialModelId = null, omitModelId = null } = {}) => request.actions.flatMap(action => models.flatMap(model => {
  if (model.modelId === omitModelId) return [];
  const query = { modelId: model.modelId, worldId: request.worldId, questionId: request.questionId, context: request.context,
    outcomeVariables: request.outcomeVariables, factualEvidence: request.factualEvidence, evidenceStatus: request.evidenceStatus, intervention: action.intervention };
  let result = service({ model, query, request: { cursor: null, limits: { assignments: model.modelId === partialModelId ? 1 : 256 } } });
  let pages = 1;
  while (result.cursor && model.modelId !== partialModelId) {
    assert.ok(pages++ < 16); result = service({ model, query, request: { cursor: result.cursor } });
  }
  return [{ actionId: action.id, modelId: model.modelId, prediction: result }];
}));
const directAndCommon = () => {
  const direct = createFiniteCausalModel(finiteCausalInput()), common = finiteCausalInput();
  common.equations[1] = causalEquation('Y', ['U'], [[[false], false], [[true], true]]);
  return [direct, createFiniteCausalModel(common)];
};

if (mode === 'common-cause-minimax-and-ties') {
  const models = directAndCommon(), service = createFiniteCausalPredictionService();
  const request = requestFor(models, [action('z-do-x', [binding('X', true)]), action('observe', [], 0),
    action('do-y', [binding('Y', true)], 0), action('a-do-x', [binding('X', true)])], [binding('X', false), binding('Y', false)]);
  const predictions = collect(models, request, service), plan = planFiniteCausalDiscrimination({ models, request, predictions });
  assert.equal(plan.selectedAction.actionId, 'a-do-x'); assert.equal(plan.selectedAction.worstCaseSurvivors, 1);
  assert.deepEqual(plan.tiedActionIds, ['a-do-x', 'z-do-x'], 'equally useful/costed actions remain visible despite deterministic selection');
  assert.equal(plan.alternatives.find(row => row.actionId === 'observe').worstCaseSurvivors, 2);
  assert.equal(plan.alternatives.find(row => row.actionId === 'do-y').worstCaseSurvivors, 2);
  assert.deepEqual(plan.residualAmbiguity, []); assert.equal(plan.execution, 'none');
  const cheaper = structuredClone(request); cheaper.actions[0].cost.actionWork = 0;
  const costPlan = planFiniteCausalDiscrimination({ models, request: cheaper, predictions }); assert.equal(costPlan.selectedAction.actionId, 'z-do-x');
  assert.notEqual(plan.planId, costPlan.planId); service.dispose();
} else if (mode === 'mediator-admissibility-and-held-fixed') {
  const first = finiteCausalInput(); first.variables.splice(2, 0, causalVariable('M', 'endogenous'));
  first.equations.splice(1, 0, causalEquation('M', ['X'], [[[false], false], [[true], true]]));
  first.equations[2] = causalEquation('Y', ['M'], [[[false], false], [[true], true]]); first.admissibleInterventionVariables.push('M');
  const second = structuredClone(first); second.equations[2] = causalEquation('Y', ['X'], [[[false], false], [[true], true]]);
  const models = [createFiniteCausalModel(first), createFiniteCausalModel(second)], service = createFiniteCausalPredictionService();
  const request = requestFor(models, [action('do-x', [binding('X', false)]), action('do-m', [binding('M', false)])], [binding('X', true)]);
  const plan = planFiniteCausalDiscrimination({ models, request, predictions: collect(models, request, service) });
  assert.equal(plan.selectedAction.actionId, 'do-m'); assert.equal(plan.selectedAction.worstCaseSurvivors, 1);
  assert.equal(plan.alternatives[0].worstCaseSurvivors, 2, 'do(X) does not separate direct and mediated effects here');
  const unavailable = structuredClone(request); unavailable.actions[1].admissibility = 'inadmissible';
  const limited = planFiniteCausalDiscrimination({ models, request: unavailable, predictions: collect(models, request, service) });
  assert.equal(limited.selectedAction.actionId, 'do-x'); assert.equal(limited.residualAmbiguity[0].reason, 'identical-complete-response-signatures');
  assert.equal(limited.excluded[0].reason, 'admissibility-unavailable');
  const impossible = requestFor(models, [action('freeze-m', [binding('M', false)])], [binding('X', true)], ['Y', 'M']);
  impossible.actions[0].heldFixed = [binding('M', true)];
  const denied = planFiniteCausalDiscrimination({ models, request: impossible, predictions: collect(models, impossible, service) });
  assert.equal(denied.selectedAction, null); assert.equal(denied.excluded[0].reason, 'held-fixed-condition-not-completely-established');
  const held = requestFor(models, [action('do-m', [binding('M', false)])], [binding('X', true)], ['Y', 'X']); held.actions[0].heldFixed = [binding('X', true)];
  assert.equal(planFiniteCausalDiscrimination({ models, request: held, predictions: collect(models, held, service) }).selectedAction.worstCaseSurvivors, 1);
  service.dispose();
} else if (mode === 'compensating-and-nondiscriminating-actions') {
  const cancelled = finiteCausalInput();
  cancelled.variables.push(causalVariable('M1', 'endogenous'), causalVariable('M2', 'endogenous'));
  cancelled.equations = [causalEquation('X', ['U'], [[[false], false], [[true], true]]),
    causalEquation('M1', ['X'], [[[false], false], [[true], true]]), causalEquation('M2', ['X'], [[[false], false], [[true], true]]),
    causalEquation('Y', ['M1', 'M2'], [false, true].flatMap(a => [false, true].map(b => [[a, b], a !== b])))];
  cancelled.admissibleInterventionVariables.push('M1', 'M2');
  const noEffect = structuredClone(cancelled); noEffect.equations[3] = causalEquation('Y', [], [[[], false]]);
  const models = [createFiniteCausalModel(cancelled), createFiniteCausalModel(noEffect)], service = createFiniteCausalPredictionService();
  const request = requestFor(models, [action('do-x', [binding('X', false)]), action('do-m1', [binding('M1', false)])], [binding('X', true)]);
  const predictions = collect(models, request, service), plan = planFiniteCausalDiscrimination({ models, request, predictions });
  assert.equal(plan.selectedAction.actionId, 'do-m1'); assert.equal(plan.alternatives[0].worstCaseSurvivors, 2);
  const unavailable = structuredClone(request); unavailable.actions[1].admissibility = 'unknown';
  const unresolved = planFiniteCausalDiscrimination({ models, request: unavailable, predictions });
  assert.equal(unresolved.selectedAction.actionId, 'do-x'); assert.equal(unresolved.selectedAction.worstCaseSurvivors, 2);
  assert.equal(unresolved.residualAmbiguity[0].reason, 'identical-complete-response-signatures', 'zero net response does not prove the absence of mechanisms');
  assert.equal(unresolved.causalTruth, 'not-established'); service.dispose();
} else if (mode === 'overlapping-unknown-outcome-oracle') {
  const models = Array.from({ length: 4 }, (_, truth) => {
    const input = finiteCausalInput(); input.equations[1] = causalEquation('Y', ['U'], [false, true].map(u => [[u], Boolean(truth & (1 << Number(u)))]));
    return createFiniteCausalModel(input);
  });
  const service = createFiniteCausalPredictionService();
  const request = requestFor(models, [action('observe', []), action('do-x', [binding('X', true)]), action('do-y', [binding('Y', false)])]);
  const source = collect(models, request, service);
  // Independent tiny action oracle: enumerate both Boolean outcomes and count
  // explicit truth-function support. Incomplete/missing models survive either.
  for (let unknownMask = 0; unknownMask < 16; unknownMask++) {
    const predictions = source.filter(row => !(unknownMask & (1 << models.findIndex(model => model.modelId === row.modelId))));
    const plan = planFiniteCausalDiscrimination({ models, request, predictions });
    const expected = request.actions.map(action => ({ id: action.id, worst: Math.max(...[false, true].map(outcome => models.filter((_, truth) => {
      if (unknownMask & (1 << truth)) return true;
      const allowed = action.id === 'do-y' ? [false] : [Boolean(truth & 1), Boolean(truth & 2)]; return allowed.includes(outcome);
    }).length)) }));
    expected.sort((a, b) => a.worst - b.worst || (a.id < b.id ? -1 : 1));
    assert.equal(plan.selectedAction.actionId, expected[0].id); assert.equal(plan.selectedAction.worstCaseSurvivors, expected[0].worst);
    for (const alternative of [plan.selectedAction, ...plan.alternatives]) assert.equal(alternative.worstCaseSurvivors, expected.find(row => row.id === alternative.actionId).worst);
  }
  const partial = collect(models, request, service, { partialModelId: models[1].modelId });
  const guarded = planFiniteCausalDiscrimination({ models, request, predictions: partial });
  assert.ok(guarded.selectedAction.unknownOutcomeSurvivors.includes(models[1].modelId));
  assert.ok(guarded.residualAmbiguity.some(row => row.reason === 'incomplete-predictions-or-action-frontier'));
  service.dispose();
} else {
  const models = directAndCommon(), service = createFiniteCausalPredictionService();
  const request = requestFor(models, [action('do-x', [binding('X', true)])], [binding('X', false), binding('Y', false)]);
  const predictions = collect(models, request, service), plan = planFiniteCausalDiscrimination({ models, request, predictions });
  const sourceWorld = finiteCausalInput().worldRef.source;
  const investigation = deriveInvestigation({ investigationId: request.investigationRef.investigationId, ...context,
    beforeWorldRef: sourceWorld, afterWorldRef: sourceWorld, changes: [{ id: 'change-1', kind: 'body', correspondence: 'checked',
      afterRef: { sourceUnitId: 'su1:' + 'c'.repeat(64), span: [0, 10], coordinateUnit: 'utf16' } }] }, { relationClosure: 'complete-in-model' });
  const obligation = investigation.obligations[0], args = { causalPlanId: plan.planId, causalActionId: plan.selectedAction.actionId, path: 'src/example.js' };
  const read = { id: 'inspect-mechanism', ownerId: 'fixture-source', capability: 'read', capabilityVersion: '1', kind: 'read-source',
    executionClass: 'read-only', arguments: args, argumentAdmissionId: semanticHash('pairofcleats.owner-admitted-read.v1', args),
    worldRef: sourceWorld, predicateId: obligation.requirement.predicateId, expectedRole: 'changed-source', obligationId: obligation.id,
    hardLimits: { calls: 1, sourceBytes: 100, work: 1 }, estimatedWork: 1 };
  const capabilityManifest = new Map([['fixture-source/read', { version: '1', executionClass: 'read-only', authorized: true, kinds: ['read-source'], worldRefs: [sourceWorld] }]]);
  const options = { investigation, plan, actions: [read], runId: 'run-1', remainingBudget: { calls: 1, sourceBytes: 100, work: 1 }, capabilityManifest };
  const advice = planInvestigationCausalEvidence(options); assert.equal(advice.readAdvice.selectedAction.id, read.id);
  assert.equal(advice.interventionAuthority, 'not-granted-by-model-advice'); assert.deepEqual(investigation.observations, []);
  assert.equal(investigation.obligations[0].status, 'open'); assert.equal(advice.execution, 'none');
  assert.throws(() => planInvestigationCausalEvidence({ ...options, investigation: { ...investigation, projectionRevision: 1 } }), { code: 'ERR_INVESTIGATION_CONFLICT' });
  assert.throws(() => planInvestigationCausalEvidence({ ...options, plan: { ...plan } }), { code: 'ERR_FINITE_CAUSAL_DISCRIMINATION_HANDLE' });
  assert.equal(planInvestigationCausalEvidence({ ...options, actions: [{ ...read, executionClass: 'execute' }] }).readAdvice.selectedAction, null);
  const stale = structuredClone(request); stale.context.taskRevision = 'revision-2';
  assert.throws(() => planFiniteCausalDiscrimination({ models, request: stale, predictions }), { code: 'ERR_FINITE_CAUSAL_DISCRIMINATION_SCOPE' });
  assert.throws(() => planFiniteCausalDiscrimination({ models, request: { ...request, limits: { workMs: 250, bytes: 1024 } }, predictions }), { code: 'ERR_FINITE_CAUSAL_DISCRIMINATION_OUTPUT_LIMIT' });
  const controller = new AbortController(); controller.abort();
  assert.throws(() => planFiniteCausalDiscrimination({ models, request, predictions }, { signal: controller.signal }), { name: 'AbortError' }); service.dispose();
}
console.log('Finite action advice minimizes conservative surviving-model counts while retaining ambiguity and read-only authority.');
