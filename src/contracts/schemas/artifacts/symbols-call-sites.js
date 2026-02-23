const intId = { type: 'integer', minimum: 0 };
const nullableString = { type: ['string', 'null'] };
const nullableInt = { type: ['integer', 'null'], minimum: 0 };
const posInt = { type: 'integer', minimum: 1 };

const columnarEnvelope = {
  type: 'object',
  required: ['format', 'columns', 'length', 'arrays'],
  properties: {
    format: { type: 'string', const: 'columnar' },
    columns: { type: 'array', items: { type: 'string' } },
    length: intId,
    arrays: { type: 'object' },
    tables: { type: ['object', 'null'] }
  },
  additionalProperties: true
};

const symbolRefSchema = {
  type: 'object',
  required: ['v', 'targetName', 'candidates', 'status', 'resolved'],
  properties: {
    v: posInt,
    targetName: { type: 'string' },
    kindHint: nullableString,
    importHint: {
      anyOf: [
        {
          type: 'object',
          properties: {
            moduleSpecifier: nullableString,
            resolvedFile: nullableString
          },
          additionalProperties: true
        },
        { type: 'null' }
      ]
    },
    candidates: {
      type: 'array',
      items: {
        type: 'object',
        required: ['symbolId', 'chunkUid', 'symbolKey', 'kindGroup'],
        properties: {
          symbolId: { type: 'string' },
          chunkUid: { type: 'string' },
          symbolKey: { type: 'string' },
          signatureKey: nullableString,
          kindGroup: { type: 'string' }
        },
        additionalProperties: true
      }
    },
    status: { type: 'string', enum: ['resolved', 'ambiguous', 'unresolved'] },
    resolved: {
      anyOf: [
        {
          type: 'object',
          required: ['symbolId', 'chunkUid'],
          properties: {
            symbolId: { type: 'string' },
            chunkUid: { type: 'string' }
          },
          additionalProperties: true
        },
        { type: 'null' }
      ]
    }
  },
  additionalProperties: true
};

const symbolRecord = {
  type: 'object',
  required: ['v', 'symbolId', 'scopedId', 'symbolKey', 'qualifiedName', 'kindGroup', 'file', 'virtualPath', 'chunkUid'],
  properties: {
    v: posInt,
    symbolId: { type: 'string' },
    scopedId: { type: 'string' },
    scheme: nullableString,
    symbolKey: { type: 'string' },
    signatureKey: nullableString,
    chunkUid: { type: 'string' },
    virtualPath: { type: 'string' },
    segmentUid: nullableString,
    file: { type: 'string' },
    lang: nullableString,
    kind: nullableString,
    kindGroup: { type: 'string' },
    name: nullableString,
    qualifiedName: { type: 'string' },
    signature: nullableString,
    extensions: { type: 'object' }
  },
  additionalProperties: true
};

const symbolOccurrence = {
  type: 'object',
  required: ['v', 'host', 'role', 'ref'],
  properties: {
    v: posInt,
    host: {
      type: 'object',
      required: ['file', 'chunkUid'],
      properties: {
        file: { type: 'string' },
        chunkUid: { type: 'string' }
      },
      additionalProperties: true
    },
    role: { type: 'string' },
    ref: symbolRefSchema,
    range: {
      anyOf: [
        {
          type: 'object',
          required: ['start', 'end'],
          properties: {
            start: intId,
            end: intId
          },
          additionalProperties: true
        },
        { type: 'null' }
      ]
    }
  },
  additionalProperties: true
};

const symbolEdge = {
  type: 'object',
  required: ['v', 'type', 'from', 'to'],
  properties: {
    v: posInt,
    type: { type: 'string' },
    from: {
      type: 'object',
      required: ['file', 'chunkUid'],
      properties: {
        file: { type: 'string' },
        chunkUid: { type: 'string' }
      },
      additionalProperties: true
    },
    to: symbolRefSchema,
    confidence: { type: ['number', 'null'] },
    reason: nullableString
  },
  additionalProperties: true
};

const callSiteEntry = {
  type: 'object',
  required: [
    'callSiteId',
    'callerChunkUid',
    'file',
    'languageId',
    'start',
    'end',
    'startLine',
    'startCol',
    'endLine',
    'endCol',
    'calleeRaw',
    'calleeNormalized',
    'args'
  ],
  properties: {
    callSiteId: { type: 'string', pattern: '^sha1:[0-9a-f]{40}$' },
    callerChunkUid: nullableString,
    callerDocId: nullableInt,
    file: { type: 'string' },
    languageId: nullableString,
    segmentId: nullableString,
    start: intId,
    end: intId,
    startLine: posInt,
    startCol: posInt,
    endLine: posInt,
    endCol: posInt,
    calleeRaw: { type: 'string' },
    calleeNormalized: { type: 'string' },
    receiver: nullableString,
    args: { type: 'array', items: { type: 'string' } },
    kwargs: { type: ['object', 'null'] },
    confidence: { type: ['number', 'null'] },
    evidence: { type: 'array', items: { type: 'string' } },
    targetChunkUid: nullableString,
    targetDocId: nullableInt,
    targetCandidates: { type: 'array', items: { type: 'string' } },
    snippetHash: nullableString,
    extensions: { type: 'object' }
  },
  additionalProperties: true
};

export const SYMBOL_CALL_SITE_ARTIFACT_SCHEMA_DEFS = {
  symbols: {
    type: 'array',
    items: symbolRecord
  },
  symbol_occurrences: {
    anyOf: [
      { type: 'array', items: symbolOccurrence },
      columnarEnvelope
    ]
  },
  symbol_edges: {
    anyOf: [
      { type: 'array', items: symbolEdge },
      columnarEnvelope
    ]
  },
  call_sites: {
    type: 'array',
    items: callSiteEntry
  }
};
