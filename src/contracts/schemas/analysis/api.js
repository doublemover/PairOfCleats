import {
  nullableNumber,
  nullableString,
  semverString
} from './primitives.js';
import {
  provenanceSchema,
  truncationRecordSchema,
  warningRecordSchema
} from './graph.js';

const apiContractEntrySchema = {
  type: 'object',
  required: ['symbol', 'signature', 'observedCalls'],
  properties: {
    symbol: {
      type: 'object',
      required: ['symbolId'],
      properties: {
        symbolId: { type: 'string' },
        chunkUid: nullableString,
        file: nullableString,
        name: nullableString,
        kind: nullableString
      },
      additionalProperties: true
    },
    signature: {
      type: 'object',
      properties: {
        declared: nullableString,
        tooling: nullableString
      },
      additionalProperties: true
    },
    observedCalls: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          arity: nullableNumber,
          args: { type: ['array', 'null'], items: { type: 'string' } },
          callSiteId: nullableString,
          file: nullableString,
          startLine: nullableNumber,
          confidence: nullableNumber
        },
        additionalProperties: true
      }
    },
    warnings: { type: ['array', 'null'], items: { type: 'object' } },
    truncation: { type: ['array', 'null'], items: truncationRecordSchema }
  },
  additionalProperties: true
};

export const API_CONTRACTS_SCHEMA = {
  type: 'object',
  required: ['version', 'options', 'symbols', 'provenance'],
  properties: {
    version: semverString,
    provenance: provenanceSchema,
    options: {
      type: 'object',
      required: ['onlyExports', 'failOnWarn', 'caps'],
      properties: {
        onlyExports: { type: 'boolean' },
        failOnWarn: { type: 'boolean' },
        caps: {
          type: 'object',
          properties: {
            maxSymbols: { type: 'number' },
            maxCallsPerSymbol: { type: 'number' },
            maxWarnings: { type: 'number' }
          },
          additionalProperties: true
        }
      },
      additionalProperties: true
    },
    symbols: { type: 'array', items: apiContractEntrySchema },
    truncation: { type: ['array', 'null'], items: truncationRecordSchema },
    warnings: { type: ['array', 'null'], items: warningRecordSchema }
  },
  additionalProperties: true
};
