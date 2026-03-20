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

export const COMPOSITE_CONTEXT_PACK_SCHEMA = {
  type: 'object',
  required: ['version', 'seed', 'primary', 'provenance'],
  properties: {
    version: semverString,
    seed: seedRefSchema,
    provenance: provenanceSchema,
    primary: {
      type: 'object',
      required: ['ref', 'file', 'excerpt'],
      properties: {
        ref: nodeRefSchema,
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
        excerptHash: nullableString,
        provenance: { type: ['object', 'null'], additionalProperties: true }
      },
      additionalProperties: true
    },
    graph: { anyOf: [GRAPH_CONTEXT_PACK_SCHEMA, { type: 'null' }] },
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
      additionalProperties: false
    },
    truncation: { type: ['array', 'null'], items: truncationRecordSchema },
    warnings: { type: ['array', 'null'], items: warningRecordSchema },
    stats: { type: ['object', 'null'], additionalProperties: true }
  },
  additionalProperties: true
};
