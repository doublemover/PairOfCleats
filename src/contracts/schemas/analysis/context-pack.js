import { SEMANTIC_CONTEXT_SCHEMA, SEMANTIC_CONTEXT_FEDERATION_SCHEMA } from '../semantic-context.js';
import { CONTEXT_TASK_POLICY_SCHEMA, CONTEXT_EDIT_UNIT_SCHEMA } from '../context-task.js';
import { CONTEXT_TOKEN_ACCOUNTING_SCHEMA } from '../context-token-budget.js';
import { CONTEXT_EVIDENCE_SET_SCHEMA } from '../context-evidence-selection.js';
import {
  CONTEXT_PACK_RISK_CONTRACT_VERSION,
  CONTEXT_PACK_RISK_SCHEMA_VERSION
} from '../../context-pack-risk-contract.js';
import { nullableString, semverString } from './primitives.js';
import {
  GRAPH_CONTEXT_PACK_SCHEMA,
  nodeRefSchema,
  provenanceSchema,
  seedRefSchema,
  truncationRecordSchema,
  warningRecordSchema
} from './graph.js';
import {
  riskAnalysisStatusSchema,
  riskAnchorSchema,
  riskCapsSchema,
  riskFederationSchema,
  riskFiltersSchema,
  riskFlowSummarySchema,
  riskGuidanceSchema,
  riskPartialFlowSummarySchema,
  riskProvenanceSchema,
  riskStatsSchema,
  riskSummarySchema,
  riskSupportSchema,
  typeFactSchema
} from './risk.js';

const includedSemanticEvidence = state => ({
  if: { type: 'object', required: ['semantic'], properties: {
    semantic: { type: 'object', required: ['status'], properties: { status: { const: state } } }
  } },
  then: { type: 'object', properties: { evidence: {
    type: 'object', required: ['semantic', 'complete'], properties: {
      semantic: { type: 'object', properties: { included: { const: true }, state: { const: state } } },
      complete: { const: false }
    }
  } } }
});

export const COMPOSITE_CONTEXT_PACK_SCHEMA = {
  type: 'object',
  required: ['version', 'seed', 'primary', 'provenance', 'evidence'],
  dependencies: { renderedContext: ['tokenAccounting'], tokenAccounting: ['renderedContext'],
    evidenceSelection: ['renderedContext', 'tokenAccounting', 'graph'] },
  properties: {
    version: semverString,
    renderedContext: { type: 'string', maxLength: 131072 },
    tokenAccounting: CONTEXT_TOKEN_ACCOUNTING_SCHEMA,
    evidenceSelection: CONTEXT_EVIDENCE_SET_SCHEMA,
    seed: seedRefSchema,
    provenance: provenanceSchema,
    primary: {
      type: 'object',
      required: ['ref', 'file', 'excerpt'],
      properties: {
        ref: { anyOf: [nodeRefSchema, { type: 'null' }] },
        file: nullableString,
        range: {
          type: ['object', 'null'],
          properties: {
            startLine: { type: 'number' },
            endLine: { type: 'number' }
          },
          additionalProperties: true
        },
        excerpt: { type: 'string' },
        unit: CONTEXT_EDIT_UNIT_SCHEMA,
        excerptHash: nullableString,
        evidence: { type: ['object', 'null'], additionalProperties: true },
        provenance: { type: ['object', 'null'], additionalProperties: true }
      },
      additionalProperties: true
    },
    graph: { anyOf: [GRAPH_CONTEXT_PACK_SCHEMA, { type: 'null' }] },
    semantic: SEMANTIC_CONTEXT_SCHEMA,
    semanticFederation: SEMANTIC_CONTEXT_FEDERATION_SCHEMA,
    types: {
      type: ['object', 'null'],
      properties: {
        facts: { type: 'array', items: typeFactSchema }
      },
      additionalProperties: true
    },
    risk: {
      type: ['object', 'null'],
      required: ['version', 'contractVersion'],
      properties: {
        version: { type: ['integer', 'null'], const: CONTEXT_PACK_RISK_SCHEMA_VERSION },
        contractVersion: { type: ['string', 'null'], const: CONTEXT_PACK_RISK_CONTRACT_VERSION },
        status: {
          type: 'string',
          enum: ['ok', 'disabled', 'missing', 'summary_only', 'degraded']
        },
        reason: nullableString,
        degraded: { type: ['boolean', 'null'] },
        anchor: riskAnchorSchema,
        filters: riskFiltersSchema,
        summary: riskSummarySchema,
        support: riskSupportSchema,
        guidance: riskGuidanceSchema,
        federation: riskFederationSchema,
        stats: riskStatsSchema,
        analysisStatus: riskAnalysisStatusSchema,
        caps: riskCapsSchema,
        truncation: { type: ['array', 'null'], items: truncationRecordSchema },
        provenance: riskProvenanceSchema,
        flows: { type: 'array', items: riskFlowSummarySchema }
        ,
        partialFlows: { type: 'array', items: riskPartialFlowSummarySchema }
      },
      additionalProperties: true
    },
    evidence: {
      type: 'object',
      required: ['schemaVersion'],
      properties: {
        schemaVersion: { type: 'number' },
        selection: { type: 'object', additionalProperties: false, required: ['included', 'state', 'heuristic'],
          properties: { included: { const: true }, state: { enum: ['selected', 'partial'] }, heuristic: { const: true } } },
        policy: {
          type: 'object',
          required: ['strictEvidence'],
          properties: {
            strictEvidence: { type: 'boolean' },
            taskPolicy: CONTEXT_TASK_POLICY_SCHEMA
          },
          additionalProperties: false
        },
        primary: {
          type: 'object',
          required: [
            'state',
            'source',
            'fileBacked',
            'substituted',
            'missing',
            'truncated',
            'truncatedBytes',
            'truncatedTokens',
            'warningCodes'
          ],
          properties: {
            state: { type: 'string', enum: ['file-backed', 'fallback', 'missing'] },
            source: { type: 'string' },
            sourceIdentity: {
              anyOf: [{ type: 'null' }, {
                type: 'object', required: ['policy', 'currentHash', 'indexedHash', 'drift'],
                properties: {
                  policy: { const: 'working-tree-preview' },
                  currentHash: { type: 'string' },
                  indexedHash: { type: ['string', 'null'] },
                  drift: { enum: ['unchanged', 'changed', 'unknown'] }
                }, additionalProperties: false
              }]
            },
            fileBacked: { type: 'boolean' },
            substituted: { type: 'boolean' },
            missing: { type: 'boolean' },
            truncated: { type: 'boolean' },
            truncatedBytes: { type: 'boolean' },
            truncatedTokens: { type: 'boolean' },
            warningCodes: { type: 'array', items: { type: 'string' } }
          },
          additionalProperties: false
        },
        types: {
          type: 'object',
          required: ['included', 'state', 'count', 'truncated', 'warningCodes'],
          properties: {
            included: { type: 'boolean' },
            state: { type: 'string', enum: ['complete', 'partial', 'missing', 'omitted'] },
            count: { type: 'number' },
            truncated: { type: 'boolean' },
            warningCodes: { type: 'array', items: { type: 'string' } }
          },
          additionalProperties: false
        },
        semantic: {
          type: 'object',
          required: ['included', 'state'],
          properties: {
            included: { type: 'boolean' },
            state: { enum: ['partial', 'unavailable', 'omitted'] },
            truncated: { type: 'boolean' },
            warningCodes: { type: 'array', items: { type: 'string' } }
          },
          additionalProperties: false
        },
        complete: { type: 'boolean' }
      },
      additionalProperties: true
    },
    truncation: { type: ['array', 'null'], items: truncationRecordSchema },
    warnings: { type: ['array', 'null'], items: warningRecordSchema },
    stats: { type: ['object', 'null'], additionalProperties: true }
  },
  additionalProperties: true,
  // Keep direct schema consumers and the runtime validator on the same
  // inclusion contract after optional response-budget omission.
  allOf: [
    {
      if: { type: 'object', required: ['evidenceSelection'], properties: { evidenceSelection: {} } },
      then: { type: 'object', properties: {
        graph: { type: 'object' },
        evidence: { type: 'object', required: ['selection', 'policy'], properties: {
          selection: { type: 'object' },
          policy: { type: 'object', required: ['taskPolicy'], properties: {
            taskPolicy: { type: 'object', required: ['task'], properties: { task: { const: 'edit-safe' } } }
          } }
        } }
      } }
    },
    {
      if: { type: 'object', properties: { evidence: { type: 'object', required: ['policy'], properties: {
        policy: { type: 'object', required: ['taskPolicy'], properties: {
          taskPolicy: { type: 'object', required: ['task'], properties: { task: { const: 'edit-safe' } } }
        } }
      } } } },
      then: { type: 'object', properties: {
        primary: { type: 'object', required: ['unit', 'evidence'], properties: { unit: CONTEXT_EDIT_UNIT_SCHEMA,
          evidence: { type: 'object', required: ['fileBacked', 'missing', 'substituted', 'truncated', 'sourceIdentity'], properties: {
            fileBacked: { const: true }, missing: { const: false }, substituted: { const: false }, truncated: { const: false },
            truncatedBytes: { const: false }, truncatedTokens: { const: false },
            sourceIdentity: { type: 'object', required: ['drift'], properties: { drift: { const: 'unchanged' } } }
          } } } }
      } }
    },
    {
      if: { type: 'object', properties: { primary: { type: 'object', required: ['unit'], properties: { unit: {} } } } },
      then: { type: 'object', properties: { evidence: { type: 'object', required: ['policy'], properties: {
        policy: { type: 'object', required: ['taskPolicy'], properties: {
          taskPolicy: { type: 'object', properties: { task: { const: 'edit-safe' } } }
        } }
      } } } }
    },
    ...['partial', 'unavailable'].map(includedSemanticEvidence),
    {
      if: { type: 'object', not: { required: ['semantic'], properties: { semantic: {} } } },
      then: { type: 'object', properties: { evidence: { type: 'object', properties: {
        semantic: { type: 'object', properties: { included: { const: false }, state: { const: 'omitted' } } }
      } } } }
    },
    {
      if: { type: 'object', properties: { evidence: { type: 'object', required: ['semantic'], properties: { semantic: {} } } } },
      then: { type: 'object', properties: { evidence: { type: 'object', required: ['complete'], properties: { complete: { const: false } } } } }
    }
  ]
};
