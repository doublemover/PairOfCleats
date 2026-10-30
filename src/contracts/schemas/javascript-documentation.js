const offset = { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
const range = { type: 'object', additionalProperties: false, required: ['start', 'end'],
  properties: { start: offset, end: offset } };
const nullableText = maxLength => ({ type: ['string', 'null'], maxLength });

/** Documentation is a bounded language metadata extension, never a new root
 * declaration field or parser-owned parameter/type authority.
 */
export const JAVASCRIPT_DOCUMENTATION_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['schemaVersion', 'dialect', 'state', 'range', 'parameters', 'returns', 'returnType', 'problems'],
  properties: {
    schemaVersion: { const: 1 }, dialect: { const: 'jsdoc' },
    state: { enum: ['absent', 'parsed', 'malformed', 'unavailable'] },
    range: { anyOf: [range, { type: 'null' }] },
    parameters: { type: 'array', maxItems: 128, items: { type: 'object', additionalProperties: false,
      required: ['name', 'type', 'optional', 'default', 'rest'], properties: {
        name: { type: 'string', minLength: 1, maxLength: 512 }, type: nullableText(8192),
        optional: { type: 'boolean' }, default: nullableText(64 * 1024), rest: { type: 'boolean' }
      } } },
    returns: { type: 'boolean' }, returnType: nullableText(8192),
    problems: { type: 'array', maxItems: 1, items: { enum: ['source-parser-unqualified',
      'comment-inventory-budget-or-identity', 'declaration-range-unavailable', 'doc-comment-byte-budget',
      'doc-comment-or-jsdoc-type-invalid'] } }
  },
  allOf: [
    { if: { properties: { state: { enum: ['absent', 'unavailable'] } } }, then: {
      properties: { range: { const: null }, parameters: { const: [] }, returns: { const: false }, returnType: { const: null } }
    } },
    { if: { properties: { state: { enum: ['parsed', 'malformed'] } } }, then: { properties: { range } } },
    { if: { properties: { state: { enum: ['parsed', 'absent'] } } }, then: { properties: { problems: { const: [] } } } },
    { if: { properties: { state: { const: 'malformed' } } }, then: { properties: {
      parameters: { const: [] }, returns: { const: false }, returnType: { const: null },
      problems: { const: ['doc-comment-or-jsdoc-type-invalid'] }
    } } }
  ]
};
