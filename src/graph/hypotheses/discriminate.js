import { performance } from 'node:perf_hooks';
import { canonicalSemanticJson, semanticHash } from '../../index/semantic/identity.js';
import { captureSemanticRequest } from '../../semantic/request-snapshot.js';
import { throwIfAborted } from '../../shared/abort.js';
import { FINITE_CAUSAL_DISCRIMINATION_SCHEMA } from '../../contracts/schemas/finite-causal-discrimination.js';
import { assertFiniteCausalDiscrimination } from '../../contracts/validators/finite-causal-discrimination.js';
import { readFiniteCausalModelInput } from './finite-model.js';
import { readFiniteCausalPrediction } from './predict.js';
import { captureFiniteCausalQuery, finiteCausalQueryId } from './query.js';

const plans = new WeakMap();
const key = value => canonicalSemanticJson(value, { maxBytes: 131072 });
const hash = (kind, value) => semanticHash('finite-causal.' + kind + '.v1', value, { maxBytes: 131072 });
const fail = (suffix, message) => Object.assign(new Error(message), { code: 'ERR_FINITE_CAUSAL_DISCRIMINATION_' + suffix });
const order = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const immutable = value => {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) immutable(child); Object.freeze(value); } return value;
};
const tupleId = values => hash('shared-outcome-tuple', values);
const queryFor = (model, request, action) => captureFiniteCausalQuery(model, { modelId: model.modelId, worldId: request.worldId,
  questionId: request.questionId, context: request.context, outcomeVariables: request.outcomeVariables,
  factualEvidence: request.factualEvidence, evidenceStatus: request.evidenceStatus, intervention: action.intervention });

/** Pure candidate-set minimax advice. Unknown/incomplete predictions survive
 * every possible outcome. Supplied finite admissibility is not permission to
 * execute an intervention; this function never runs a model or an experiment.
 */
export const planFiniteCausalDiscrimination = ({ models, request, predictions = [] }, { signal = null } = {}) => {
  const began = performance.now(); throwIfAborted(signal);
  request = captureSemanticRequest(request, FINITE_CAUSAL_DISCRIMINATION_SCHEMA); assertFiniteCausalDiscrimination(request); key(request);
  if (!Array.isArray(models) || models.length !== request.modelIds.length || models.some((model, index) => model?.modelId !== request.modelIds[index])
    || !Array.isArray(predictions) || predictions.length > 64) throw fail('CONTRACT', 'Original models and bounded action/model prediction receipts are required.');
  const modelInputs = models.map(readFiniteCausalModelInput), modelIds = request.modelIds;
  if (models.some(model => model.questionId !== request.questionId || model.worldId !== request.worldId)
    || new Set(request.actions.map(action => action.id)).size !== request.actions.length) throw fail('SCOPE', 'Models disagree in question/world, or action identities repeat.');
  const actionIds = new Set(request.actions.map(action => action.id)), supplied = new Map();
  for (const row of predictions) {
    if (!row || Object.keys(row).length !== 3 || !actionIds.has(row.actionId) || !modelIds.includes(row.modelId)) throw fail('CONTRACT', 'Prediction maps to an unknown action/model.');
    const pair = key([row.actionId, row.modelId]);
    if (supplied.has(pair)) throw fail('CONTRACT', 'Duplicate action/model prediction receipt.');
    supplied.set(pair, { prediction: row.prediction, knowledge: readFiniteCausalPrediction(row.prediction) });
  }
  const candidates = [], excluded = [], remainingActionIds = [], checkedSources = [], signatures = new Map(modelIds.map(id => [id, []]));
  let tupleChecks = 0, inspectedPredictions = 0;
  for (const action of request.actions) {
    throwIfAborted(signal);
    if (candidates.length + excluded.length > 0 && performance.now() - began >= request.limits.workMs) { remainingActionIds.push(action.id); continue; }
    if (action.admissibility !== 'declared-in-finite-model' || !action.admissibilityReceiptIds.length) {
      excluded.push({ actionId: action.id, reason: 'admissibility-unavailable' }); continue;
    }
    const expected = [];
    // Admission validates every model's operational definitions and intervention
    // domain. One unsupported model does not disappear from the candidate set.
    for (const model of models) {
      try { expected.push(queryFor(model, request, action)); }
      catch (error) {
        if (error?.code !== 'ERR_FINITE_CAUSAL_QUERY_CONTRACT') throw error;
        expected.length = 0; break;
      }
    }
    if (!expected.length) { excluded.push({ actionId: action.id, reason: 'intervention-or-definitions-not-admitted-by-every-model' }); continue; }
    const predictionsForAction = [], union = new Set(), unknown = new Set(); let invalidHeldFixed = false;
    for (const [index, model] of models.entries()) {
      const owned = supplied.get(key([action.id, model.modelId]));
      if (!owned) { unknown.add(model.modelId); predictionsForAction.push({ modelId: model.modelId, predictionId: null, complete: false, allowed: new Set() }); continue; }
      inspectedPredictions++;
      const { prediction, knowledge } = owned;
      if (prediction.modelId !== model.modelId || finiteCausalQueryId(knowledge.query) !== finiteCausalQueryId(expected[index])) throw fail('SCOPE', 'Prediction differs in action, evidence, world, task or operational definitions.');
      // Holding a modeled descendant fixed requires a separate admitted joint
      // prediction. An omitted variable or partial proof remains unresolved.
      for (const held of action.heldFixed) {
        const variable = modelInputs[index].variables.find(variable => variable.id === held.variableId);
        if (!variable || held.operationalDefinitionId !== variable.operationalDefinitionId || !variable.domain.some(value => key(value) === key(held.value))) throw fail('CONTRACT', 'Held-fixed condition has a missing/differently defined value.');
        if (!knowledge.query.outcomeVariables.some(row => row.variableId === held.variableId)) { invalidHeldFixed = true; break; }
        if (knowledge.completion.outcomeSet !== 'complete-in-declared-model' || knowledge.outcomes.some(outcome =>
          outcome.values.some(row => row.variableId === held.variableId && key(row.value) !== key(held.value)))) { invalidHeldFixed = true; break; }
      }
      const allowed = new Set();
      for (const outcome of knowledge.outcomes) { throwIfAborted(signal); const id = tupleId(outcome.values); allowed.add(id); union.add(id); tupleChecks++; }
      const complete = knowledge.completion.outcomeSet === 'complete-in-declared-model';
      if (!complete) unknown.add(model.modelId);
      predictionsForAction.push({ modelId: model.modelId, predictionId: prediction.predictionId, complete, allowed });
    }
    if (action.heldFixed.length && predictionsForAction.some(row => !row.complete)) invalidHeldFixed = true;
    if (invalidHeldFixed) { excluded.push({ actionId: action.id, reason: 'held-fixed-condition-not-completely-established' }); continue; }
    let worstCaseSurvivors = unknown.size, worstCaseOutcomeId = null, worstCaseModelIds = [...unknown];
    for (const id of [...union].sort(order)) {
      const survivors = predictionsForAction.filter(row => !row.complete || row.allowed.has(id)).map(row => row.modelId);
      if (survivors.length > worstCaseSurvivors || worstCaseOutcomeId === null && survivors.length === worstCaseSurvivors) {
        worstCaseSurvivors = survivors.length; worstCaseOutcomeId = id; worstCaseModelIds = survivors;
      }
    }
    if (!union.size) worstCaseSurvivors = modelIds.length;
    for (const row of predictionsForAction) signatures.get(row.modelId).push({ actionId: action.id,
      complete: row.complete, values: row.allowed });
    const expectedOutcomes = predictionsForAction.map(row => ({ modelId: row.modelId, predictionId: row.predictionId,
      completeness: row.complete ? 'complete-in-declared-model' : 'unresolved', knownOutcomes: row.allowed.size }));
    checkedSources.push(...expectedOutcomes.map(row => ({ actionId: action.id, ...row })));
    candidates.push({ actionId: action.id, intervention: action.intervention, heldFixed: action.heldFixed,
      admissibilityReceiptIds: action.admissibilityReceiptIds, expectedOutcomes, worstCaseSurvivors, worstCaseOutcomeId,
      worstCaseModelIds, knownOutcomePartitions: union.size, unknownOutcomeSurvivors: [...unknown],
      declaredCost: action.cost.actionWork + action.cost.proofWork, cost: action.cost });
  }
  candidates.sort((a, b) => a.worstCaseSurvivors - b.worstCaseSurvivors || a.declaredCost - b.declaredCost || order(a.actionId, b.actionId));
  const selected = candidates[0] ?? null, residualAmbiguity = [];
  for (let left = 0; left < modelIds.length; left++) for (let right = left + 1; right < modelIds.length; right++) {
    const a = signatures.get(modelIds[left]), b = signatures.get(modelIds[right]);
    const incomplete = a.some(row => !row.complete) || b.some(row => !row.complete) || remainingActionIds.length > 0;
    const identical = a.length === b.length && a.every((row, index) => row.complete === b[index].complete
      && row.actionId === b[index].actionId && row.values.size === b[index].values.size && [...row.values].every(value => b[index].values.has(value)));
    const guaranteed = a.some((row, index) => row.complete && b[index]?.complete && ![...row.values].some(value => b[index].values.has(value)));
    if (!guaranteed) residualAmbiguity.push({ modelIds: [modelIds[left], modelIds[right]], reason: !candidates.length ? 'no-admitted-action'
      : incomplete ? 'incomplete-predictions-or-action-frontier' : identical ? 'identical-complete-response-signatures' : 'overlapping-response-sets' });
  }
  const result = { schemaVersion: 1, kind: 'finite-causal-discrimination-plan', planId: hash('discrimination', { request, checkedSources, completedActions: [...candidates.map(row => row.actionId), ...excluded.map(row => row.actionId)] }),
    questionId: request.questionId, worldId: request.worldId, context: request.context, investigationRef: request.investigationRef,
    modelIds, selectedAction: selected, alternatives: candidates.slice(1), excluded, remainingActionIds, residualAmbiguity,
    tiedActionIds: selected ? candidates.filter(row => row.worstCaseSurvivors === selected.worstCaseSurvivors && row.declaredCost === selected.declaredCost).map(row => row.actionId) : [],
    selection: 'minimax-worst-surviving-model-count-then-declared-action-plus-proof-cost-then-stable-id',
    optimality: remainingActionIds.length ? 'unresolved' : 'minimum-among-supplied-actions-under-declared-models-and-costs',
    candidateSetExhaustiveness: 'not-established', causalTruth: 'not-established', execution: 'none',
    work: { inspectedPredictions, tupleChecks, elapsedMs: performance.now() - began, predictionWork: 'owned-by-referenced-prediction-receipts; not-free-new-work' } };
  if (Buffer.byteLength(JSON.stringify(result)) + 1 > request.limits.bytes) throw fail('OUTPUT_LIMIT', 'Finite discrimination advice exceeds its output allowance.');
  throwIfAborted(signal); immutable(result);
  plans.set(result, immutable({ request, sourceWorld: modelInputs[0].worldRef.source })); return result;
};

export const readFiniteCausalDiscrimination = plan => {
  const value = plan && typeof plan === 'object' ? plans.get(plan) : null;
  if (!value) throw fail('HANDLE', 'Original finite discrimination plan required.'); return value;
};
