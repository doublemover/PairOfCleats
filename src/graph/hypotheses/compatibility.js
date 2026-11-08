import { canonicalSemanticJson, semanticHash } from '../../index/semantic/identity.js';
import { captureSemanticRequest } from '../../semantic/request-snapshot.js';
import { FINITE_CAUSAL_QUERY_SCHEMAS } from '../../contracts/schemas/finite-causal-query.js';
import { assertFiniteCausalQuery } from '../../contracts/validators/finite-causal-query.js';
import { readFiniteCausalPrediction } from './predict.js';

const key = value => canonicalSemanticJson(value, { maxBytes: 131072 });
const fail = message => Object.assign(new Error(message), { code: 'ERR_FINITE_CAUSAL_OBSERVATION_MISMATCH' });

/** Model compatibility never confirms a causal direction. A complete finite
 * exclusion contradicts this model under supplied premises, not the program.
 */
export const compareFiniteCausalEvidence = (prediction, observation) => {
  const knowledge = readFiniteCausalPrediction(prediction), query = knowledge.query;
  observation = captureSemanticRequest(observation, FINITE_CAUSAL_QUERY_SCHEMAS.observation); assertFiniteCausalQuery('observation', observation); key(observation);
  if (observation.predictionId !== prediction.predictionId || observation.worldId !== query.worldId || observation.questionId !== query.questionId
    || key(observation.context) !== key(query.context)) throw fail('Observation belongs to another prediction, world, question or task/branch/assumption revision.');
  const provided = new Map();
  for (const row of observation.values) {
    const variable = knowledge.variables.find(variable => variable.id === row.variableId);
    const expected = query.outcomeVariables.find(variable => variable.variableId === row.variableId);
    if (!variable || !expected || provided.has(row.variableId) || expected.operationalDefinitionId !== row.operationalDefinitionId
      || !variable.domain.some(value => key(value) === key(row.value))) throw fail('Observation variables, definitions and typed values differ.');
    provided.set(row.variableId, row.value);
  }
  if (provided.size !== query.outcomeVariables.length) throw fail('Observation must bind the complete requested outcome tuple.');
  const contained = knowledge.outcomes.some(outcome => outcome.values.every(row => key(row.value) === key(provided.get(row.variableId))));
  const absentPremise = observation.kind === 'absence' && (observation.coverage !== 'complete' || knowledge.modelWorld.coverage !== 'complete');
  const status = absentPremise ? 'premise-unverified' : contained ? 'compatible-not-causal-confirmation'
    : knowledge.completion.outcomeSet === 'complete-in-declared-model' ? 'model-counterexample' : 'unresolved';
  return Object.freeze({ schemaVersion: 1, kind: 'finite-causal-compatibility', predictionId: prediction.predictionId,
    observationId: semanticHash('finite-causal.observation.v1', observation, { maxBytes: 131072 }), modelId: prediction.modelId,
    worldId: prediction.worldId, status, consequence: status === 'model-counterexample' ? 'contradicts-declared-model-under-supplied-premises' : 'no-model-elimination',
    premise: absentPremise ? 'missing-instrumentation-or-window-coverage' : 'supplied-observation-not-independently-revalidated',
    causalTruth: 'not-established', execution: 'none' });
};
