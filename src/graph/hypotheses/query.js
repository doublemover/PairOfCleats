import { canonicalSemanticJson, semanticHash } from '../../index/semantic/identity.js';
import { captureSemanticRequest } from '../../semantic/request-snapshot.js';
import { FINITE_CAUSAL_QUERY_SCHEMAS } from '../../contracts/schemas/finite-causal-query.js';
import { assertFiniteCausalQuery } from '../../contracts/validators/finite-causal-query.js';
import { readFiniteCausalModelInput } from './finite-model.js';

const key = value => canonicalSemanticJson(value, { maxBytes: 131072 });
const fail = message => Object.assign(new Error(message), { code: 'ERR_FINITE_CAUSAL_QUERY_CONTRACT' });
export const captureFiniteCausalQuery = (model, query) => {
  query = captureSemanticRequest(query, FINITE_CAUSAL_QUERY_SCHEMAS.query); assertFiniteCausalQuery('query', query); key(query);
  const input = readFiniteCausalModelInput(model), variables = new Map(input.variables.map(variable => [variable.id, variable]));
  if (query.modelId !== model.modelId || query.worldId !== model.worldId || query.questionId !== model.questionId) throw fail('Query model, world or question identity differs.');
  for (const group of [query.outcomeVariables, query.factualEvidence, query.intervention]) {
    const seen = new Set();
    for (const row of group) {
      const variable = variables.get(row.variableId);
      if (!variable || seen.has(row.variableId) || row.operationalDefinitionId !== variable.operationalDefinitionId
        || Object.hasOwn(row, 'value') && !variable.domain.some(value => key(value) === key(row.value))) throw fail('Query has duplicate, missing or differently defined variables/values.');
      seen.add(row.variableId);
    }
  }
  if (query.intervention.some(row => !input.admissibleInterventionVariables.includes(row.variableId))
    || query.evidenceStatus === 'unavailable' && query.factualEvidence.length) throw fail('Unavailable evidence cannot filter assignments; interventions must be explicitly admitted.');
  return query;
};
export const finiteCausalQueryId = query => semanticHash('finite-causal.query.v1', query, { maxBytes: 131072 });
