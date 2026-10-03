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
  required: ['testPath', 'score', 'reason', 'fidelity'],
  properties: {
    testPath: { type: 'string' },
    score: { type: 'number' },
    reason: { type: 'string' },
    witnessPath: { anyOf: [witnessPathSchema, { type: 'null' }] },
    fidelity: {
      type: 'object',
      required: ['source', 'state', 'reasonCodes', 'matchKind', 'graphDistance'],
      properties: {
        source: { type: 'string', enum: ['graph', 'heuristic'] },
        state: { type: 'string', enum: ['complete', 'partial', 'fallback'] },
        reasonCodes: { type: 'array', items: { type: 'string' } },
        matchKind: { type: 'string', enum: ['graph-distance', 'name', 'path-proximity'] },
        graphDistance: nullableNumber
      },
      additionalProperties: false
    }
  },
  additionalProperties: true
};

export const SUGGEST_TESTS_SCHEMA = {
  type: 'object',
  required: ['version', 'changed', 'suggestions', 'provenance', 'fidelity'],
  properties: {
    version: semverString,
    provenance: provenanceSchema,
    changed: {
      type: 'array',
      items: { type: 'object', required: ['path'], properties: { path: { type: 'string' } }, additionalProperties: true }
    },
    suggestions: { type: 'array', items: suggestedTestSchema },
    fidelity: {
      type: 'object',
      required: ['schemaVersion', 'source', 'state', 'reasonCodes', 'graph', 'heuristic'],
      properties: {
        schemaVersion: { type: 'number' },
        source: { type: 'string', enum: ['graph', 'heuristic', 'none'] },
        state: { type: 'string', enum: ['complete', 'partial', 'fallback', 'missing'] },
        reasonCodes: { type: 'array', items: { type: 'string' } },
        graph: {
          type: 'object',
          required: [
            'available',
            'used',
            'matchedSuggestions',
            'visitedNodes',
            'edgesVisited',
            'workUnits',
            'traversalCapsHit',
            'candidateTruncated'
          ],
          properties: {
            available: { type: 'boolean' },
            used: { type: 'boolean' },
            matchedSuggestions: { type: 'number' },
            visitedNodes: { type: 'number' },
            edgesVisited: { type: 'number' },
            workUnits: { type: 'number' },
            traversalCapsHit: { type: 'array', items: { type: 'string' } },
            candidateTruncated: { type: 'boolean' }
          },
          additionalProperties: false
        },
        heuristic: {
          type: 'object',
          required: ['used'],
          properties: {
            used: { type: 'boolean' }
          },
          additionalProperties: false
        }
      },
      additionalProperties: false
    },
    truncation: { type: ['array', 'null'], items: truncationRecordSchema },
    warnings: { type: ['array', 'null'], items: warningRecordSchema }
  },
  additionalProperties: true
};
