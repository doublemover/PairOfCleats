import { MANAGED_REFERENCE_VERSION, MANAGED_REFERENCE_LANGUAGES, MANAGED_REFERENCE_KINDS,
  MANAGED_REFERENCE_MAX_OCCURRENCES } from '../managed-reference-identities.js';

const count = { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
const name = { type: 'string', minLength: 1, maxLength: 4096 };
const sourceRange = { type: ['object', 'null'], additionalProperties: false,
  required: ['start', 'end', 'range'], properties: { start: count, end: count, range: { enum: ['token', 'instruction'] } } };
const owner = { type: ['object', 'null'], additionalProperties: false,
  required: ['id', 'name', 'start', 'end'], properties: { id: { type: 'string', minLength: 1, maxLength: 4196 },
    name, start: count, end: count } };

export const MANAGED_REFERENCE_FACTS_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['schemaVersion', 'languageId', 'source', 'scope', 'references', 'coverage'],
  properties: {
    schemaVersion: { const: MANAGED_REFERENCE_VERSION }, languageId: { enum: MANAGED_REFERENCE_LANGUAGES },
    scope: { const: 'static-reference-occurrences-not-call-edges' },
    source: { type: 'object', additionalProperties: false, required: ['textHash', 'length', 'encoding'],
      properties: { textHash: { type: 'string', pattern: '^[a-f0-9]{64}$' }, length: count, encoding: { const: 'utf16le-js-string' } } },
    references: { type: 'array', maxItems: MANAGED_REFERENCE_MAX_OCCURRENCES,
      items: { type: 'object', additionalProperties: false, required: ['kind', 'value', 'source', 'owner'],
        properties: { kind: { enum: MANAGED_REFERENCE_KINDS }, value: name, source: sourceRange, owner } } },
    coverage: { type: 'object', additionalProperties: false,
      required: ['state', 'observed', 'retained', 'omitted', 'unattributed'],
      properties: { state: { const: 'partial' }, observed: count,
        retained: { ...count, maximum: MANAGED_REFERENCE_MAX_OCCURRENCES }, omitted: count, unattributed: count } }
  }
};
