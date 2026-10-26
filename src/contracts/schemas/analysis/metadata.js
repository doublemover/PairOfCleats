import { FLOW_EVIDENCE_SCHEMA } from '../flow-evidence.js';
import { SOURCE_OUTLINE_SCHEMA } from '../source-outline.js';
import { JAVASCRIPT_CALLABLE_JOIN_SCHEMA } from '../javascript-declarations.js';
import { RECORD_SOURCE_SCHEMA } from '../../record-source.js';
import {
  metaTypes,
  nullableNumber,
  nullableString
} from './primitives.js';

const riskFlowEntry = {
  type: 'object',
  required: ['source', 'sink'],
  properties: {
    source: { type: 'string' },
    sink: { type: 'string' },
    scope: nullableString,
    severity: nullableString,
    category: nullableString,
    confidence: nullableNumber,
    ruleIds: { type: ['array', 'null'], items: { type: 'string' } },
    evidence: { type: ['object', 'null'] },
    via: nullableString
  },
  additionalProperties: true
};

export const METADATA_V2_SCHEMA = {
  type: 'object',
  required: ['chunkId', 'file'],
  properties: {
    schemaVersion: { type: ['integer', 'null'], minimum: 1 },
    chunkId: { type: 'string' },
    chunkUid: { type: 'string' },
    chunkUidAlgoVersion: nullableString,
    spanHash: nullableString,
    preHash: nullableString,
    postHash: nullableString,
    collisionOf: nullableString,
    virtualPath: nullableString,
    file: { type: 'string' },
    fileHash: nullableString,
    fileHashAlgo: nullableString,
    recordSource: RECORD_SOURCE_SCHEMA,
    segment: {
      type: ['object', 'null'],
      properties: {
        segmentId: nullableString,
        segmentUid: nullableString,
        virtualPath: nullableString,
        type: nullableString,
        languageId: nullableString,
        ext: nullableString,
        parentSegmentId: nullableString,
        start: { type: ['integer', 'null'], minimum: 0 },
        end: { type: ['integer', 'null'], minimum: 0 },
        startLine: { type: ['integer', 'null'], minimum: 0 },
        endLine: { type: ['integer', 'null'], minimum: 0 },
        embeddingContext: nullableString,
        sourceType: { type: ['string', 'null'], enum: ['pdf', 'docx', null] },
        pageStart: { type: ['integer', 'null'], minimum: 0 },
        pageEnd: { type: ['integer', 'null'], minimum: 0 },
        paragraphStart: { type: ['integer', 'null'], minimum: 0 },
        paragraphEnd: { type: ['integer', 'null'], minimum: 0 },
        headingPath: { type: ['array', 'null'], items: { type: 'string' } },
        windowIndex: { type: ['integer', 'null'], minimum: 0 },
        anchor: nullableString
      },
      additionalProperties: true
    },
    range: {
      type: ['object', 'null'],
      properties: {
        start: { type: ['integer', 'null'], minimum: 0 },
        end: { type: ['integer', 'null'], minimum: 0 },
        startLine: { type: ['integer', 'null'], minimum: 0 },
        endLine: { type: ['integer', 'null'], minimum: 0 }
      },
      additionalProperties: true
    },
    lang: nullableString,
    ext: nullableString,
    container: {
      type: ['object', 'null'],
      properties: {
        ext: nullableString,
        languageId: nullableString
      },
      additionalProperties: true
    },
    effective: {
      type: ['object', 'null'],
      properties: {
        ext: nullableString,
        languageId: nullableString
      },
      additionalProperties: true
    },
    kind: nullableString,
    name: nullableString,
    signature: nullableString,
    doc: nullableString,
    generatedBy: nullableString,
    tooling: {
      type: ['object', 'null'],
      properties: {
        tool: nullableString,
        version: nullableString,
        configHash: nullableString
      },
      additionalProperties: true
    },
    parser: {
      type: ['object', 'null'],
      properties: {
        name: nullableString,
        version: nullableString,
        mode: nullableString,
        fallbackMode: nullableString,
        reasonCode: nullableString,
        reason: nullableString,
        deterministic: { type: ['boolean', 'null'] }
      },
      additionalProperties: true
    },
    annotations: { type: ['array', 'null'], items: { type: 'string' } },
    modifiers: {
      anyOf: [
        { type: ['array', 'null'], items: { type: 'string' } },
        { type: 'object', additionalProperties: true }
      ]
    },
    params: { type: ['array', 'null'], items: { type: 'string' } },
    tags: { type: ['array', 'null'], items: { type: 'string' } },
    types: metaTypes,
    flowEvidence: FLOW_EVIDENCE_SCHEMA,
    sourceOutline: SOURCE_OUTLINE_SCHEMA,
    javascriptDeclaration: JAVASCRIPT_CALLABLE_JOIN_SCHEMA,
    yields: { type: 'boolean' }, returnsValue: { type: 'boolean' },
    throws: { type: 'array', items: { type: 'string' } }, awaits: { type: 'array', items: { type: 'string' } },
    risk: {
      type: ['object', 'null'],
      properties: {
        tags: { type: ['array', 'null'], items: { type: 'string' } },
        categories: { type: ['array', 'null'], items: { type: 'string' } },
        severity: nullableString,
        confidence: nullableNumber,
        sources: { type: ['array', 'null'], items: { type: 'object' } },
        sinks: { type: ['array', 'null'], items: { type: 'object' } },
        sanitizers: { type: ['array', 'null'], items: { type: 'object' } },
        flows: { type: ['array', 'null'], items: riskFlowEntry },
        analysisStatus: { type: ['object', 'null'] },
        ruleProvenance: { type: ['object', 'null'] }
      },
      additionalProperties: true
    }
  },
  additionalProperties: true
};
