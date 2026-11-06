import { semanticObject as object } from './semantic-envelopes.js';
import { FINITE_CAUSAL_QUERY_SCHEMAS } from './finite-causal-query.js';
const hash = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const id = { type: 'string', pattern: '^[A-Za-z_][A-Za-z0-9_.-]{0,63}$' };
const text = { type: 'string', minLength: 1, maxLength: 4096 };
const list = (items, maxItems, minItems = 0) => ({ type: 'array', items, maxItems, minItems, uniqueItems: true });
const queryFields = FINITE_CAUSAL_QUERY_SCHEMAS.query.properties;
export const FINITE_CAUSAL_DISCRIMINATION_SCHEMA = object({ schemaVersion: { const: 1 }, questionId: hash, worldId: hash,
  context: queryFields.context, investigationRef: object({ investigationId: text, projectionRevision: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER } }),
  modelIds: list(hash, 8, 1), outcomeVariables: queryFields.outcomeVariables, factualEvidence: queryFields.factualEvidence,
  evidenceStatus: queryFields.evidenceStatus,
  actions: list(object({ id, intervention: queryFields.intervention, heldFixed: queryFields.factualEvidence,
    admissibility: { enum: ['declared-in-finite-model', 'inadmissible', 'unknown'] }, admissibilityReceiptIds: list(hash, 32),
    cost: object({ actionWork: { type: 'integer', minimum: 0, maximum: 1000000000 }, proofWork: { type: 'integer', minimum: 0, maximum: 1000000000 } }) }), 8),
  limits: object({ workMs: { type: 'integer', minimum: 1, maximum: 250 }, bytes: { type: 'integer', minimum: 1024, maximum: 131072 } }) });
