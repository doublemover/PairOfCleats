import { canonicalSemanticJson } from '../../index/semantic/identity.js';
import { readFiniteCausalDiscrimination } from './discriminate.js';
import { readFiniteModelIntervention } from './paired-intervention.js';
import { readFiniteCausalPrediction } from './predict.js';
import { finiteCausalQueryId } from './query.js';
import { compareFiniteCausalEvidence } from './compatibility.js';

const key = value => canonicalSemanticJson(value, { maxBytes: 131072 });
const ordered = values => [...values].sort((a, b) => a.variableId < b.variableId ? -1 : a.variableId > b.variableId ? 1 : 0);
const fail = message => Object.assign(new Error(message), { code: 'ERR_FINITE_MODEL_INTERVENTION_SCOPE' });

/** Compare an actual authored-model pair with proposed model consequences.
 * This supplies no observed-program receipt and updates no live hypothesis.
 */
export const comparePairedFiniteHypotheses = ({ plan, actionId, pair, predictions }) => {
  const { request, sourceWorld } = readFiniteCausalDiscrimination(plan), actual = readFiniteModelIntervention(pair);
  const action = [plan.selectedAction, ...plan.alternatives].find(action => action?.actionId === actionId);
  if (!action || pair.questionId !== plan.questionId || pair.worldId !== plan.worldId || key(pair.context) !== key(plan.context)
    || !plan.modelIds.includes(pair.modelId) || key(actual.modelWorld.source) !== key(sourceWorld)
    || key(ordered(actual.spec.assignedIntervention)) !== key(ordered(action.intervention))
    || key(ordered(actual.spec.outcomeVariables)) !== key(ordered(request.outcomeVariables))) throw fail('Paired execution differs in plan, action, model, world, definitions or revision.');
  if (!Array.isArray(predictions) || predictions.length > plan.modelIds.length) throw fail('Bounded original model predictions required.');
  const reports = new Map();
  for (const prediction of predictions) {
    const knowledge = readFiniteCausalPrediction(prediction), query = knowledge.query;
    if (!plan.modelIds.includes(prediction.modelId) || reports.has(prediction.modelId)
      || finiteCausalQueryId(query) !== finiteCausalQueryId({ modelId: prediction.modelId, worldId: request.worldId,
        questionId: request.questionId, context: request.context, outcomeVariables: request.outcomeVariables,
        factualEvidence: request.factualEvidence, evidenceStatus: request.evidenceStatus, intervention: action.intervention })) throw fail('Prediction differs in the paired action or pinned question.');
    reports.set(prediction.modelId, prediction);
  }
  const factual = new Map(actual.factualValues.map(row => [row.variableId, row.value]));
  const treated = new Map(actual.treatmentValues.map(row => [row.variableId, row.value]));
  const factualMatches = request.factualEvidence.every(row => key(factual.get(row.variableId)) === key(row.value));
  const heldMatches = action.heldFixed.every(row => key(factual.get(row.variableId)) === key(row.value) && key(treated.get(row.variableId)) === key(row.value));
  const realizationMatches = pair.assignedInterventionId === pair.realizedInterventionId && pair.admissibility === 'satisfied-in-declared-model' && heldMatches;
  const admissible = factualMatches && realizationMatches;
  const consequences = plan.modelIds.map(modelId => {
    const prediction = reports.get(modelId);
    if (!admissible || !prediction) return Object.freeze({ modelId, status: 'unresolved', consequence: 'no-model-elimination' });
    return Object.freeze({ modelId, ...compareFiniteCausalEvidence(prediction, { predictionId: prediction.predictionId,
      worldId: pair.worldId, questionId: pair.questionId, context: pair.context, kind: 'value', coverage: actual.modelWorld.coverage,
      values: pair.treatmentOutcome, observationReceiptIds: [pair.receiptId] }) });
  });
  return Object.freeze({ schemaVersion: 1, kind: 'paired-finite-hypothesis-comparison', planId: plan.planId, actionId,
    pairReceiptId: pair.receiptId, taskSpecId: pair.taskSpecId, splitManifestId: pair.splitManifestId,
    context: plan.context, admissible, reason: !factualMatches ? 'baseline-outside-factual-condition' : !realizationMatches ? 'intervention-not-admissibly-realized' : null,
    consequences: Object.freeze(consequences), evidenceClass: 'authored-finite-system-not-observed-program-execution',
    programCausalEffect: 'not-established', liveHypothesisUpdates: 0 });
};
