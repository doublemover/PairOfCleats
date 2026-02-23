export const nullableString = { type: ['string', 'null'] };
export const nullableNumber = { type: ['number', 'null'] };
export const nullableStringArray = { type: ['array', 'null'], items: { type: 'string' } };
export const nullableObjectArray = { type: ['array', 'null'], items: { type: 'object' } };
export const nullableNonNegativeInteger = { type: ['integer', 'null'], minimum: 0 };
export const semverString = { type: 'string', pattern: '^\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?$' };

/**
 * Keep nullable objects open to preserve forward-compatible contract payloads.
 *
 * @param {Record<string, unknown>} [properties]
 * @returns {{ type: string[], properties: Record<string, unknown>, additionalProperties: boolean }}
 */
export function openNullableObject(properties = {}) {
  return {
    type: ['object', 'null'],
    properties,
    additionalProperties: true
  };
}

/**
 * Build a nullable array schema for a given item schema.
 *
 * @param {Record<string, unknown>} itemSchema
 * @returns {{ type: string[], items: Record<string, unknown> }}
 */
export function nullableArrayOf(itemSchema) {
  return { type: ['array', 'null'], items: itemSchema };
}
