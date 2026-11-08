import { semverString } from './primitives.js';
import {
  provenanceSchema,
  truncationRecordSchema,
  warningRecordSchema
} from './graph.js';
import { API_CONTRACT_ENTRY_SCHEMA, API_CONTRACT_CALL_EVIDENCE_SCHEMA } from '../api-contracts.js';

const apiContractEntrySchema = { ...API_CONTRACT_ENTRY_SCHEMA,
  properties: { ...API_CONTRACT_ENTRY_SCHEMA.properties,
    truncation: { type: ['array', 'null'], items: truncationRecordSchema } } };

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
    callEvidence: API_CONTRACT_CALL_EVIDENCE_SCHEMA,
    truncation: { type: ['array', 'null'], items: truncationRecordSchema },
    warnings: { type: ['array', 'null'], items: warningRecordSchema }
  },
  additionalProperties: true
};
