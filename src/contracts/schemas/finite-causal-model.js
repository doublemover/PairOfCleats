import { semanticObject as object } from './semantic-envelopes.js';
import { QUESTION_WORLD_SCHEMA, QUESTION_SOURCE_REFERENCE_SCHEMA } from './repository-question.js';

export const FINITE_CAUSAL_MODEL_VERSION = 1;
const id = { type: 'string', pattern: '^[A-Za-z_][A-Za-z0-9_.-]{0,63}$' };
const hash = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const list = (items, maxItems, minItems = 0) => ({ type: 'array', items, maxItems, minItems });
const unique = (items, maxItems) => ({ ...list(items, maxItems), uniqueItems: true });
const nullable = item => ({ anyOf: [item, { type: 'null' }] });
export const FINITE_CAUSAL_VALUE_SCHEMA = { oneOf: [object({ type: { const: 'boolean' }, value: { type: 'boolean' } }),
  object({ type: { const: 'integer' }, value: { type: 'integer', minimum: Number.MIN_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER } }),
  object({ type: { const: 'string' }, value: { type: 'string', maxLength: 256 } })] };
const value = FINITE_CAUSAL_VALUE_SCHEMA;
export const FINITE_CAUSAL_BINDING_SCHEMA = object({ variableId: id, value });
const binding = FINITE_CAUSAL_BINDING_SCHEMA;
export const FINITE_CAUSAL_WORLD_SCHEMA = object({ source: QUESTION_WORLD_SCHEMA, buildId: hash, runtimeId: hash,
  traceRunId: nullable(hash), traceSchemaId: nullable(hash), phaseId: id, unitDefinitionId: hash,
  coverageId: hash, coverage: { enum: ['complete', 'partial', 'unknown'] }, observationContractId: hash });
export const FINITE_CAUSAL_RATIONAL_SCHEMA = object({ numerator: { type: 'string', pattern: '^(0|[1-9][0-9]{0,63})$' },
  denominator: { type: 'string', pattern: '^[1-9][0-9]{0,63}$' } });
export const FINITE_CAUSAL_MODEL_SCHEMAS = {
  model: object({ schemaVersion: { const: FINITE_CAUSAL_MODEL_VERSION }, questionId: hash, worldRef: FINITE_CAUSAL_WORLD_SCHEMA,
    variables: list(object({ id, kind: { enum: ['exogenous', 'endogenous'] },
      domain: { ...list(value, 8, 1), uniqueItems: true }, operationalDefinitionId: hash, sourceBindings: list(QUESTION_SOURCE_REFERENCE_SCHEMA, 16) }), 32, 1),
    equations: list(object({ output: id, orderedParents: unique(id, 8),
      rows: list(object({ parentValues: list(value, 8), value }), 256, 1) }), 32),
    exogenousSupport: object({ state: { enum: ['complete', 'partial'] }, weighting: { enum: ['none', 'normalized-rational'] },
      assignments: list(object({ values: list(binding, 32), weight: nullable(FINITE_CAUSAL_RATIONAL_SCHEMA) }), 256) }),
    admissibleInterventionVariables: unique(id, 32),
    assumptions: list(object({ id, description: { type: 'string', minLength: 1, maxLength: 4096 },
      status: { enum: ['declared', 'contradicted', 'externally-supported'] }, supportReceiptIds: unique(hash, 32) }), 32),
    evidencePartition: object({ sourceEvidenceIds: unique(hash, 256), observationEvidenceIds: unique(hash, 256), modelEvidenceIds: unique(hash, 256) }) }),
  evaluation: object({ modelId: hash, exogenousAssignment: list(binding, 32), intervention: list(binding, 32) })
};
