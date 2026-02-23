import {
  nullableNumber,
  nullableString,
  openNullableObject
} from './common.js';

export const nodeRefSchema = {
  anyOf: [
    {
      type: 'object',
      required: ['type', 'chunkUid'],
      properties: {
        type: { const: 'chunk' },
        chunkUid: { type: 'string', minLength: 1 }
      },
      additionalProperties: true
    },
    {
      type: 'object',
      required: ['type', 'symbolId'],
      properties: {
        type: { const: 'symbol' },
        symbolId: { type: 'string', minLength: 1 }
      },
      additionalProperties: true
    },
    {
      type: 'object',
      required: ['type', 'path'],
      properties: {
        type: { const: 'file' },
        path: { type: 'string', minLength: 1 }
      },
      additionalProperties: true
    }
  ]
};

export const candidateRefSchema = {
  type: 'object',
  properties: {
    chunkUid: nullableString,
    symbolId: nullableString,
    path: nullableString,
    symbolKey: nullableString,
    kindGroup: nullableString,
    signatureKey: nullableString,
    confidence: nullableNumber
  },
  additionalProperties: true
};

export const referenceEnvelopeSchema = {
  type: 'object',
  required: ['v', 'status', 'candidates', 'resolved'],
  properties: {
    v: { type: 'integer' },
    status: { enum: ['resolved', 'ambiguous', 'unresolved'] },
    targetName: nullableString,
    kindHint: nullableString,
    importHint: openNullableObject({
      moduleSpecifier: nullableString,
      resolvedFile: nullableString
    }),
    candidates: { type: 'array', items: candidateRefSchema },
    resolved: { anyOf: [candidateRefSchema, { type: 'null' }] },
    reason: nullableString,
    confidence: nullableNumber
  },
  additionalProperties: true
};

/**
 * Analysis entrypoints accept either a resolved node ref or a deferred envelope.
 */
export const seedRefSchema = { anyOf: [nodeRefSchema, referenceEnvelopeSchema] };
