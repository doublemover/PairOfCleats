/** Bounded parser facts; display spelling never establishes a literal's type. */
export const LITERAL_EVIDENCE_VERSION = 1;
export const MAX_LITERAL_REPRESENTATION = 4096;
export const LITERAL_EVIDENCE_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['version', 'kind', 'valueState', 'scalar', 'range', 'rawPreview', 'rawTruncated'],
  properties: {
    version: { const: LITERAL_EVIDENCE_VERSION },
    kind: { enum: ['string', 'number', 'boolean', 'null', 'bigint', 'regexp', 'unsupported'] },
    valueState: { enum: ['qualified', 'unavailable'] },
    scalar: { anyOf: [{ type: 'null' }, { type: 'object', additionalProperties: false,
      required: ['type', 'representation'], properties: {
        type: { enum: ['string', 'number', 'boolean', 'null', 'bigint'] },
        representation: { type: 'string', maxLength: MAX_LITERAL_REPRESENTATION }
      } }] },
    range: { anyOf: [{ type: 'null' }, { type: 'object', additionalProperties: false,
      required: ['start', 'end'], properties: {
        start: { type: 'integer', minimum: 0 }, end: { type: 'integer', minimum: 0 }
      } }] },
    rawPreview: { type: 'string', maxLength: 80 }, rawTruncated: { type: 'boolean' }
  }
};

export const literalEvidenceProjectionErrors = evidence => {
  if (!evidence || evidence.version !== LITERAL_EVIDENCE_VERSION) return ['literal evidence version is unavailable'];
  const errors = [];
  if (evidence.range && (!Number.isSafeInteger(evidence.range.start) || !Number.isSafeInteger(evidence.range.end)
    || evidence.range.start < 0 || evidence.range.end < evidence.range.start)) errors.push('literal range is invalid');
  if (!['qualified', 'unavailable'].includes(evidence.valueState)) errors.push('literal value state is invalid');
  if (evidence.valueState === 'unavailable' && evidence.scalar !== null) errors.push('unavailable literal cannot supply a scalar');
  if (evidence.valueState === 'qualified' && (evidence.scalar?.type !== evidence.kind
    || !['string', 'number', 'boolean', 'null', 'bigint'].includes(evidence.kind)
    || typeof evidence.scalar?.representation !== 'string'
    || evidence.scalar.representation.length > MAX_LITERAL_REPRESENTATION)) errors.push('qualified literal scalar differs from its kind');
  return errors;
};

export const literalEvidenceType = evidence => {
  if (literalEvidenceProjectionErrors(evidence).length) return null;
  // Overflow numbers remain numbers even when no finite scalar is admitted.
  return ['string', 'number', 'boolean', 'null', 'bigint'].includes(evidence.kind)
    ? evidence.kind : null;
};
