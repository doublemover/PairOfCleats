import { semanticObject as object } from './semantic-envelopes.js';
import { FINITE_CAUSAL_BINDING_SCHEMA } from './finite-causal-model.js';
import { FINITE_CAUSAL_QUERY_SCHEMAS } from './finite-causal-query.js';
const hash = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const fields = FINITE_CAUSAL_QUERY_SCHEMAS.query.properties;
export const FINITE_MODEL_INTERVENTION_SCHEMA = object({ schemaVersion: { const: 1 }, pairId: hash, taskSpecId: hash,
  splitManifestId: hash, questionId: hash, worldId: hash, context: fields.context,
  exogenousAssignment: { type: 'array', items: FINITE_CAUSAL_BINDING_SCHEMA, maxItems: 32, uniqueItems: true },
  assignedIntervention: fields.intervention, outcomeVariables: fields.outcomeVariables, heldFixed: fields.factualEvidence,
  expectedRelation: { enum: ['invariant', 'directed-change', 'unknown'] }, expectedTreatmentOutcome: fields.factualEvidence,
  estimand: { const: 'same-unit-contrast-in-supplied-finite-model' },
  executionProfile: object({ kind: { const: 'finite-lookup-only' }, maxEquationSteps: { type: 'integer', minimum: 1, maximum: 64 },
    maxOutputBytes: { type: 'integer', minimum: 1024, maximum: 131072 } }) });
