import {
  nullableNumber,
  nullableString,
  semverString
} from './primitives.js';
import {
  nodeRefSchema,
  provenanceSchema,
  truncationRecordSchema,
  warningRecordSchema,
  witnessPathSchema
} from './graph.js';

const architectureViolationSchema = {
  type: 'object',
  required: ['ruleId', 'edge'],
  properties: {
    ruleId: { type: 'string' },
    edge: {
      type: 'object',
      required: ['edgeType', 'from', 'to'],
      properties: {
        edgeType: { type: 'string' },
        from: nodeRefSchema,
        to: nodeRefSchema
      },
      additionalProperties: true
    },
    evidence: { type: ['object', 'null'] }
  },
  additionalProperties: true
};

export const ARCHITECTURE_REPORT_SCHEMA = {
  type: 'object',
  required: ['version', 'rules', 'violations', 'provenance'],
  properties: {
    version: semverString,
    provenance: provenanceSchema,
    rules: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'type', 'summary'],
        properties: {
          id: { type: 'string' },
          type: { type: 'string' },
          severity: nullableString,
          summary: { type: 'object' }
        },
        additionalProperties: true
      }
    },
    violations: { type: 'array', items: architectureViolationSchema },
    truncation: { type: ['array', 'null'], items: truncationRecordSchema },
    warnings: { type: ['array', 'null'], items: warningRecordSchema }
  },
  additionalProperties: true
};

const suggestedTestSchema = {
  type: 'object',
  required: ['testPath', 'score', 'reason'],
  properties: {
    testPath: { type: 'string' },
    score: { type: 'number' },
    reason: { type: 'string' },
    witnessPath: { anyOf: [witnessPathSchema, { type: 'null' }] }
  },
  additionalProperties: true
};

export const SUGGEST_TESTS_SCHEMA = {
  type: 'object',
  required: ['version', 'changed', 'suggestions', 'provenance'],
  properties: {
    version: semverString,
    provenance: provenanceSchema,
    changed: {
      type: 'array',
      items: { type: 'object', required: ['path'], properties: { path: { type: 'string' } }, additionalProperties: true }
    },
    suggestions: { type: 'array', items: suggestedTestSchema },
    truncation: { type: ['array', 'null'], items: truncationRecordSchema },
    warnings: { type: ['array', 'null'], items: warningRecordSchema }
  },
  additionalProperties: true
};
