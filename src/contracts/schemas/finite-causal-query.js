import { semanticObject as object } from './semantic-envelopes.js';
import { FINITE_CAUSAL_VALUE_SCHEMA } from './finite-causal-model.js';
const id = { type: 'string', pattern: '^[A-Za-z_][A-Za-z0-9_.-]{0,63}$' };
const hash = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const text = { type: 'string', minLength: 1, maxLength: 4096 };
const list = (items, maxItems, minItems = 0) => ({ type: 'array', items, maxItems, minItems, uniqueItems: true });
const variable = object({ variableId: id, operationalDefinitionId: hash });
const binding = object({ variableId: id, operationalDefinitionId: hash, value: FINITE_CAUSAL_VALUE_SCHEMA });
export const FINITE_CAUSAL_QUERY_SCHEMAS = {
  query: object({ modelId: hash, worldId: hash, questionId: hash,
    context: object({ taskRevision: text, branchId: text, assumptionSetId: text }),
    outcomeVariables: list(variable, 8, 1), factualEvidence: list(binding, 32),
    evidenceStatus: { enum: ['supplied-values', 'unavailable'] }, intervention: list(binding, 32) }),
  page: object({ cursor: { anyOf: [{ type: 'string', minLength: 1, maxLength: 64 }, { type: 'null' }] } }, {
    limits: object({}, { assignments: { type: 'integer', minimum: 1, maximum: 256 }, outcomes: { type: 'integer', minimum: 1, maximum: 32 },
      workMs: { type: 'integer', minimum: 1, maximum: 250 }, bytes: { type: 'integer', minimum: 1024, maximum: 131072 } }) }),
  observation: object({ predictionId: hash, worldId: hash, questionId: hash,
    context: object({ taskRevision: text, branchId: text, assumptionSetId: text }),
    kind: { enum: ['value', 'absence'] }, coverage: { enum: ['complete', 'partial', 'unknown'] },
    values: list(binding, 8, 1), observationReceiptIds: list(hash, 32, 1) })
};
