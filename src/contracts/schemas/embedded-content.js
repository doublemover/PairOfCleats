const integer = { type: 'integer', minimum: 0 };
const object = properties => ({ type: 'object', additionalProperties: false,
  required: Object.keys(properties), properties });

/** Exact original-source pieces. Version changes require deliberate consumer
 * admission; unknown transformations cannot acquire an exact linear map.
 */
export const EMBEDDED_CONTENT_VIEW_SCHEMA = object({
  schemaVersion: { const: 1 }, kind: { const: 'source-pieces' },
  policy: { type: 'string', minLength: 1, maxLength: 256 },
  containerStart: integer, containerEnd: integer, sourceStart: integer, sourceEnd: integer,
  length: integer, contentHash: { type: 'string', pattern: '^[a-f0-9]{64}$' },
  pieces: { type: 'array', minItems: 1, maxItems: 256,
    items: object({ start: integer, end: integer, localStart: integer, localEnd: integer }) }
});
