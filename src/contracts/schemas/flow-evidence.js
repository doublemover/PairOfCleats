import { FLOW_FIELDS, FLOW_STATES, FLOW_AUTHORITIES } from '../../shared/flow-evidence.js';
const count = { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
const nullableString = { type: ['string', 'null'] };
const field = { type: 'object', additionalProperties: false,
  required: ['state', 'producer', 'authority', 'scope', 'kind', 'valueHash', 'reasons'], properties: {
    state: { enum: FLOW_STATES }, authority: { enum: FLOW_AUTHORITIES }, scope: { type: 'string', minLength: 1, maxLength: 256 },
    producer: { type: 'object', additionalProperties: false, required: ['id', 'version'],
      properties: { id: { type: 'string', minLength: 1, maxLength: 128 }, version: { type: 'string', minLength: 1, maxLength: 128 } } },
    kind: { enum: ['syntactic-control-counts', 'syntactic-effects', 'semantic-effects', 'lexical-hints'] },
    valueHash: { type: ['string', 'null'], pattern: '^[a-f0-9]{64}$' },
    reasons: { type: 'array', maxItems: 8, items: { type: 'string', maxLength: 128 } }
  } };
export const FLOW_EVIDENCE_SCHEMA = { type: 'object', additionalProperties: false,
  required: ['schemaVersion', 'source', 'fields', 'diagnostics', 'omittedDiagnostics', 'identity'], properties: {
    schemaVersion: { const: 1 }, identity: { type: 'string', pattern: '^fm1:[a-f0-9]{64}$' },
    source: { type: 'object', additionalProperties: false, required: ['textHash', 'length', 'range', 'owner', 'languageId', 'generation'], properties: {
      textHash: { type: ['string', 'null'], pattern: '^[a-f0-9]{64}$' }, length: { ...count, type: ['integer', 'null'] },
      range: { type: ['object', 'null'], additionalProperties: false, required: ['start', 'end'], properties: { start: count, end: count } },
      owner: { type: ['object', 'null'], additionalProperties: false, required: ['kind', 'name'], properties: { kind: nullableString, name: nullableString } },
      languageId: nullableString, generation: nullableString } },
    fields: { type: 'object', additionalProperties: false, required: FLOW_FIELDS, properties: Object.fromEntries(FLOW_FIELDS.map(name => [name, field])) },
    diagnostics: { type: 'array', maxItems: 16, items: { type: 'object', additionalProperties: false,
      required: ['field', 'code', 'keptProducer', 'rejectedProducer'], properties: { field: { enum: FLOW_FIELDS },
        code: { enum: ['lower_authority_ignored', 'equal_authority_conflict', 'incomparable_scope_or_fact_kind'] },
        keptProducer: { type: 'string', maxLength: 128 }, rejectedProducer: { type: 'string', maxLength: 128 } } } },
    omittedDiagnostics: count
  } };
