import { SEMANTIC_RECORD_REF_SCHEMA } from './semantic.js';
import { SEMANTIC_GENERATION_SCHEMA } from './semantic-envelopes.js';

export const CALL_SITE_SEMANTIC_REF_VERSION = 1;
export const CALL_SITE_SEMANTIC_REF_UNAVAILABLE_REASONS = Object.freeze([
  'semantic-retention-unavailable', 'invocation-reference-unavailable', 'invocation-reference-stale',
  'ambiguous-invocation-span', 'mapped-source-unqualified', 'coordinate-system-unqualified'
]);
export const CALL_SITE_SEMANTIC_REF_SCHEMA = { oneOf: [
  { type: 'object', additionalProperties: false,
    required: ['schemaVersion', 'status', 'recordRef', 'sourceUnitId', 'sourceHash', 'generation', 'coordinateUnit'],
    properties: { schemaVersion: { const: CALL_SITE_SEMANTIC_REF_VERSION }, status: { const: 'available' },
      recordRef: SEMANTIC_RECORD_REF_SCHEMA, sourceUnitId: { type: 'string', pattern: '^su1:[a-f0-9]{64}$' },
      sourceHash: { type: 'string', pattern: '^[a-f0-9]{64}$' }, generation: SEMANTIC_GENERATION_SCHEMA,
      coordinateUnit: { const: 'utf16' } } },
  { type: 'object', additionalProperties: false, required: ['schemaVersion', 'status', 'reason'],
    properties: { schemaVersion: { const: CALL_SITE_SEMANTIC_REF_VERSION }, status: { const: 'unavailable' },
      reason: { enum: CALL_SITE_SEMANTIC_REF_UNAVAILABLE_REASONS } } }
] };
