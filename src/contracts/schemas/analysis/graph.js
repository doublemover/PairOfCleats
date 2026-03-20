import {
  nullableNumber,
  nullableString,
  semverString
} from './primitives.js';

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

const candidateRefSchema = {
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

const referenceEnvelopeSchema = {
  type: 'object',
  required: ['v', 'status', 'candidates', 'resolved'],
  properties: {
    v: { type: 'integer' },
    status: { enum: ['resolved', 'ambiguous', 'unresolved'] },
    targetName: nullableString,
    kindHint: nullableString,
    importHint: {
      type: ['object', 'null'],
      properties: {
        moduleSpecifier: nullableString,
        resolvedFile: nullableString
      },
      additionalProperties: true
    },
    candidates: { type: 'array', items: candidateRefSchema },
    resolved: { anyOf: [candidateRefSchema, { type: 'null' }] },
    reason: nullableString,
    confidence: nullableNumber
  },
  additionalProperties: true
};

export const truncationRecordSchema = {
  type: 'object',
  required: ['scope', 'cap', 'limit'],
  properties: {
    scope: {
      enum: [
        'graph',
        'impact',
        'types',
        'risk',
        'ranking',
        'apiContracts',
        'architecture',
        'suggestTests'
      ]
    },
    cap: {
      enum: [
        'maxDepth',
        'maxFanoutPerNode',
        'maxNodes',
        'maxEdges',
        'maxPaths',
        'maxCandidates',
        'maxWorkUnits',
        'maxWallClockMs',
        'maxSymbols',
        'maxCallsPerSymbol',
        'maxWarnings',
        'maxViolations',
        'maxEdgesExamined',
        'maxSuggestions',
        'maxSeeds',
        'maxFlows',
        'maxStepsPerFlow',
        'maxCallSitesPerStep',
        'maxRiskBytes',
        'maxRiskTokens'
      ]
    },
    limit: { anyOf: [{ type: 'number' }, { type: 'object' }] },
    observed: { anyOf: [{ type: 'number' }, { type: 'object' }, { type: 'null' }] },
    omitted: { anyOf: [{ type: 'number' }, { type: 'object' }, { type: 'null' }] },
    at: {
      type: ['object', 'null'],
      properties: {
        node: nullableString,
        edge: nullableString
      },
      additionalProperties: true
    },
    note: nullableString
  },
  additionalProperties: true
};

export const warningRecordSchema = {
  type: 'object',
  required: ['code', 'message'],
  properties: {
    code: { type: 'string' },
    message: { type: 'string' },
    data: { type: ['object', 'null'] }
  },
  additionalProperties: true
};

export const provenanceSchema = {
  type: 'object',
  required: ['generatedAt', 'capsUsed'],
  properties: {
    generatedAt: { type: 'string' },
    indexCompatKey: { type: 'string', minLength: 1 },
    indexSignature: { type: 'string', minLength: 1 },
    capsUsed: { type: 'object', additionalProperties: true },
    repo: nullableString,
    indexDir: nullableString
  },
  anyOf: [
    {
      required: ['indexCompatKey'],
      properties: { indexCompatKey: { type: 'string', minLength: 1 } }
    },
    {
      required: ['indexSignature'],
      properties: { indexSignature: { type: 'string', minLength: 1 } }
    }
  ],
  additionalProperties: true
};

export const seedRefSchema = { anyOf: [nodeRefSchema, referenceEnvelopeSchema] };

const graphNodeSchema = {
  type: 'object',
  required: ['ref'],
  properties: {
    ref: nodeRefSchema,
    distance: { type: 'number' },
    label: nullableString,
    file: nullableString,
    kind: nullableString,
    name: nullableString,
    signature: nullableString,
    confidence: nullableNumber
  },
  additionalProperties: true
};

const graphEdgeSchema = {
  type: 'object',
  required: ['edgeType', 'from', 'to'],
  properties: {
    edgeType: { type: 'string' },
    graph: nullableString,
    from: { anyOf: [nodeRefSchema, referenceEnvelopeSchema] },
    to: { anyOf: [nodeRefSchema, referenceEnvelopeSchema] },
    confidence: nullableNumber,
    evidence: { type: ['object', 'null'] }
  },
  additionalProperties: true
};

export const witnessPathSchema = {
  type: 'object',
  required: ['to', 'distance', 'nodes'],
  properties: {
    to: nodeRefSchema,
    distance: { type: 'number' },
    nodes: { type: 'array', items: nodeRefSchema },
    edges: {
      type: ['array', 'null'],
      items: {
        type: 'object',
        required: ['from', 'to', 'edgeType'],
        properties: {
          from: nodeRefSchema,
          to: nodeRefSchema,
          edgeType: { type: 'string' }
        },
        additionalProperties: true
      }
    },
    confidence: nullableNumber,
    partial: { type: 'boolean' },
    unresolvedAt: { type: ['array', 'null'], items: { type: 'number' } }
  },
  additionalProperties: true
};

export const GRAPH_CONTEXT_PACK_SCHEMA = {
  type: 'object',
  required: ['version', 'seed', 'nodes', 'edges', 'provenance'],
  properties: {
    version: semverString,
    seed: seedRefSchema,
    provenance: provenanceSchema,
    nodes: { type: 'array', items: graphNodeSchema },
    edges: { type: 'array', items: graphEdgeSchema },
    paths: { type: ['array', 'null'], items: witnessPathSchema },
    truncation: { type: ['array', 'null'], items: truncationRecordSchema },
    warnings: { type: ['array', 'null'], items: warningRecordSchema },
    stats: { type: ['object', 'null'], additionalProperties: true }
  },
  additionalProperties: true
};

const impactedNodeSchema = {
  type: 'object',
  required: ['ref', 'distance'],
  properties: {
    ref: nodeRefSchema,
    distance: { type: 'number' },
    confidence: nullableNumber,
    witnessPath: { anyOf: [witnessPathSchema, { type: 'null' }] },
    partial: { type: 'boolean' }
  },
  additionalProperties: true
};

export const GRAPH_IMPACT_SCHEMA = {
  type: 'object',
  required: ['version', 'seed', 'direction', 'depth', 'impacted', 'provenance'],
  properties: {
    version: semverString,
    seed: seedRefSchema,
    direction: { enum: ['upstream', 'downstream'] },
    depth: { type: 'number' },
    impacted: { type: 'array', items: impactedNodeSchema },
    truncation: { type: ['array', 'null'], items: truncationRecordSchema },
    warnings: { type: ['array', 'null'], items: warningRecordSchema },
    provenance: provenanceSchema,
    stats: { type: ['object', 'null'], additionalProperties: true }
  },
  additionalProperties: true
};
