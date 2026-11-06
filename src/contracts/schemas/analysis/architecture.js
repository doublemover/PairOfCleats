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
import { ARCHITECTURE_REPORT_VERSION } from '../../architecture-evidence.js';

const nullable = schema => ({ anyOf: [schema, { type: 'null' }] });
const object = properties => ({ type: 'object', required: Object.keys(properties), properties, additionalProperties: false });
const hash = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const ordinal = { type: 'integer', minimum: 0 };
const shortText = { type: 'string', minLength: 1, maxLength: 256 };
const selectorExplanation = nullable(object({ digest: hash, anyOf: { type: 'array', maxItems: 8, items: shortText },
  noneOf: { type: 'array', maxItems: 8, items: shortText }, truncated: { type: 'boolean' } }));
const endpointEvidence = object({ ref: nodeRefSchema, path: nullable({ type: 'string', minLength: 1, maxLength: 32768 }),
  label: nullable(shortText), labelTruncated: { type: 'boolean' }, availability: { enum: ['source-path', 'identity-only'] } });
export const ARCHITECTURE_VIOLATION_EVIDENCE_SCHEMA = object({
  schemaVersion: { const: 1 }, edgeId: hash, relation: { enum: ['call', 'import'] },
  from: endpointEvidence, to: endpointEvidence,
  index: object({ indexSignature: nullableString, indexCompatKey: nullableString, indexDir: nullableString,
    generation: { type: 'null' }, generationAvailability: { const: 'not-provided' } }),
  policyDigest: hash, ruleId: { type: 'string', minLength: 1 }, ruleIndex: ordinal,
  selectors: object({ from: selectorExplanation, to: selectorExplanation }),
  layers: nullable(object({ fromOrdinal: ordinal, toOrdinal: ordinal, fromName: nullable(shortText), toName: nullable(shortText),
    selection: { const: 'first-match-in-policy-order' } })),
  availability: { const: 'observed-static-relationship' }, executionProven: { const: false }
});
const architecturePolicySchema = object({ schemaVersion: { const: 1 }, rulesVersion: { const: 1 }, digest: hash,
  algorithm: { const: 'sha256' }, normalization: { const: 'ordered-admitted-policy-v1' },
  pathNormalization: { const: 'repo-relative-path-v1' }, layerSelection: { const: 'first-match' } });

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
    policy: architecturePolicySchema,
    execution: object({ schemaVersion: { const: 1 }, scope: { const: 'policy-and-graph-evaluation' },
      excluded: { const: ['input-loading', 'rendering'] },
      work: object(Object.fromEntries(['policyCompilations', 'policyCompilationHits', 'graphPreparations', 'graphPreparationHits',
        'adjacencyAdmissionEntries', 'adjacencyAdmissionHits', 'adjacencySelectionEntries', 'adjacencyMaterializedEntries',
        'selectorCalls', 'predicateCalls', 'policyMatchHits', 'policyMatchEvictions', 'policyMatchBytesHighWater', 'evidenceProjections',
        'pathNormalizationCalls', 'pathNormalizationHits']
        .map(name => [name, ordinal]))),
      phaseMs: { type: 'object', required: ['policyAdmission', 'policyCompilation', 'evidenceProjection', 'edgeEvaluationInclusive'],
        properties: Object.fromEntries(['policyAdmission', 'policyCompilation', 'graphPreparation', 'evidenceProjection', 'edgeEvaluationInclusive']
          .map(name => [name, { type: 'number', minimum: 0 }])), additionalProperties: false },
      totalMs: { type: 'number', minimum: 0 } }),
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
    summary: {
      type: 'object', required: ['detectedViolations', 'retainedViolations', 'omittedViolations', 'edgesExamined', 'complete'],
      properties: {
        detectedViolations: { type: 'integer', minimum: 0 }, retainedViolations: { type: 'integer', minimum: 0 },
        omittedViolations: { type: 'integer', minimum: 0 }, edgesExamined: { type: 'integer', minimum: 0 }, complete: { type: 'boolean' }
      }, additionalProperties: false
    },
    truncation: { type: ['array', 'null'], items: truncationRecordSchema },
    warnings: { type: ['array', 'null'], items: warningRecordSchema }
  },
  allOf: [{ if: { required: ['version'], properties: { version: { const: ARCHITECTURE_REPORT_VERSION } } }, then: {
    required: ['policy', 'execution', 'summary'], properties: {
      policy: architecturePolicySchema, execution: { type: 'object' }, summary: { type: 'object' },
      rules: { type: 'array', items: { type: 'object', properties: {
        type: { enum: ['forbiddenCall', 'forbiddenImport', 'layering'] }, summary: object({ violations: ordinal })
      } } },
      violations: { type: 'array', items: { type: 'object',
        required: ['evidence'], properties: { evidence: object({ note: nullableString, details: ARCHITECTURE_VIOLATION_EVIDENCE_SCHEMA }) }
      } } }
  } }],
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

const suggestionCount = { type: 'integer', minimum: 0 };
const suggestionExecutionSchema = {
  type: 'object', additionalProperties: false,
  required: ['schemaVersion', 'scope', 'clock', 'excluded', 'limitMs', 'elapsedMs', 'preparationElapsedMs', 'state',
    'phaseAtStop', 'completedPhases', 'observed', 'settlement', 'interruptibility', 'overrunMs'],
  properties: {
    schemaVersion: { const: 1 }, scope: { const: 'suggestion-computation' }, clock: { const: 'monotonic' },
    excluded: { const: ['configuration-and-input-loading', 'graph-artifact-preparation', 'rendering-and-serialization'] },
    limitMs: suggestionCount, elapsedMs: { type: 'number', minimum: 0 },
    preparationElapsedMs: { type: ['number', 'null'], minimum: 0 },
    state: { enum: ['complete', 'deadline-limited'] }, phaseAtStop: { type: ['string', 'null'] },
    completedPhases: { type: 'array', uniqueItems: true, items: { type: 'string' } },
    observed: { type: 'object', additionalProperties: false,
      required: ['directoryOpens', 'directoryReads', 'directoryCloses', 'inventoryEntries', 'graphNodes', 'graphEdges',
        'neighborReads', 'candidateChecks', 'fallbackChecks', 'witnessLinks'],
      properties: Object.fromEntries(['directoryOpens', 'directoryReads', 'directoryCloses', 'inventoryEntries', 'graphNodes',
        'graphEdges', 'neighborReads', 'candidateChecks', 'fallbackChecks', 'witnessLinks'].map(key => [key, suggestionCount])) },
    settlement: { const: 'confirmed' }, interruptibility: { const: 'cooperative-between-synchronous-operations-and-sorts' },
    overrunMs: { type: 'number', minimum: 0 }
  }
};

export const SUGGEST_TESTS_SCHEMA = {
  type: 'object',
  required: ['version', 'changed', 'suggestions', 'provenance', 'fidelity'],
  properties: {
    version: semverString,
    execution: suggestionExecutionSchema,
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
