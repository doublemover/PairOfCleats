import { METADATA_V2_SCHEMA, RISK_RULES_BUNDLE_SCHEMA } from './analysis.js';

const intId = { type: 'integer', minimum: 0 };
const nullableString = { type: ['string', 'null'] };
const nullableInt = { type: ['integer', 'null'], minimum: 0 };
const nullableBool = { type: ['boolean', 'null'] };
const posInt = { type: 'integer', minimum: 1 };
const nullablePosInt = { type: ['integer', 'null'], minimum: 1 };
const semverString = { type: 'string', pattern: '^\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?$' };
const modeName = { type: 'string', enum: ['code', 'prose', 'extracted-prose', 'records'] };
const modeList = { type: 'array', items: modeName };
const snapshotIdString = { type: 'string', pattern: '^snap-[A-Za-z0-9._-]+$' };
const diffIdString = { type: 'string', pattern: '^diff_[A-Za-z0-9._-]+$' };

const snapshotSummaryEntry = {
  type: 'object',
  required: ['snapshotId', 'createdAt', 'kind', 'tags', 'hasFrozen'],
  properties: {
    snapshotId: snapshotIdString,
    createdAt: { type: 'string' },
    kind: { type: 'string', enum: ['pointer', 'frozen'] },
    tags: { type: 'array', items: { type: 'string' } },
    label: nullableString,
    hasFrozen: { type: 'boolean' }
  },
  additionalProperties: true
};

const snapshotPointerSchema = {
  type: 'object',
  required: ['buildRootsByMode', 'buildIdByMode'],
  properties: {
    buildRootsByMode: {
      type: 'object',
      additionalProperties: { type: 'string' }
    },
    buildIdByMode: {
      type: 'object',
      additionalProperties: { type: 'string' }
    }
  },
  additionalProperties: false
};

const snapshotGitProvenanceSchema = {
  type: ['object', 'null'],
  properties: {
    branch: nullableString,
    commit: nullableString,
    dirty: nullableBool
  },
  additionalProperties: false
};

const snapshotProvenanceSchema = {
  type: ['object', 'null'],
  properties: {
    repoId: nullableString,
    repoRootHash: nullableString,
    git: snapshotGitProvenanceSchema,
    toolVersionByMode: {
      type: ['object', 'null'],
      additionalProperties: nullableString
    },
    configHashByMode: {
      type: ['object', 'null'],
      additionalProperties: nullableString
    }
  },
  additionalProperties: true
};

const diffRefSchema = {
  type: 'object',
  properties: {
    snapshotId: nullableString,
    buildId: nullableString,
    indexRootRef: nullableString,
    ref: nullableString
  },
  additionalProperties: true
};

const diffManifestEntry = {
  type: 'object',
  required: ['id', 'createdAt', 'from', 'to', 'modes', 'summaryPath'],
  properties: {
    id: diffIdString,
    createdAt: { type: 'string' },
    from: diffRefSchema,
    to: diffRefSchema,
    modes: modeList,
    summaryPath: { type: 'string' },
    eventsPath: nullableString,
    truncated: { type: 'boolean' },
    maxEvents: nullableInt,
    maxBytes: nullableInt,
    compat: {
      type: ['object', 'null'],
      additionalProperties: true
    }
  },
  additionalProperties: true
};

const chunkMetaEntry = {
  type: 'object',
  required: ['id', 'start', 'end'],
  properties: {
    id: intId,
    fileId: nullableInt,
    start: intId,
    end: intId,
    startLine: nullableInt,
    endLine: nullableInt,
    kind: nullableString,
    name: nullableString,
    ext: nullableString,
    metaV2: {
      anyOf: [METADATA_V2_SCHEMA, { type: 'null' }]
    }
  },
  additionalProperties: true
};

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

const postingEntry = {
  type: 'array',
  minItems: 2,
  maxItems: 2,
  items: [intId, intId]
};

const postingsList = {
  type: 'array',
  items: { type: 'array', items: postingEntry }
};

const vocabArray = {
  type: 'array',
  items: { type: 'string' }
};

const docLengthsArray = {
  type: 'array',
  items: intId
};

const graphNode = {
  type: 'object',
  required: ['id', 'out', 'in'],
  properties: {
    id: { type: 'string' },
    file: nullableString,
    name: nullableString,
    kind: nullableString,
    chunkId: nullableString,
    out: { type: 'array', items: { type: 'string' } },
    in: { type: 'array', items: { type: 'string' } }
  },
  additionalProperties: true
};

const graphPayload = {
  type: 'object',
  required: ['nodeCount', 'edgeCount', 'nodes'],
  properties: {
    nodeCount: intId,
    edgeCount: intId,
    nodes: { type: 'array', items: graphNode }
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

const idPostingList = {
  type: 'array',
  items: { type: 'array', items: intId }
};

const denseVectorArray = {
  type: 'array',
  items: intId
};

const pieceEntry = {
  type: 'object',
  required: ['type', 'name', 'format', 'path'],
  properties: {
    type: { type: 'string' },
    name: { type: 'string' },
    format: { type: 'string' },
    path: { type: 'string' },
    bytes: nullableInt,
    checksum: nullableString,
    statError: nullableString,
    checksumError: nullableString,
    compression: nullableString,
    count: nullableInt,
    dims: nullableInt,
    schemaVersion: semverString,
    extensions: { type: 'object' }
  },
  additionalProperties: false
};

const repoHeadSchema = {
  type: ['object', 'null'],
  properties: {
    commitId: nullableString,
    changeId: nullableString,
    branch: nullableString,
    bookmarks: { type: ['array', 'null'], items: { type: 'string' } },
    author: nullableString,
    timestamp: nullableString
  },
  additionalProperties: false
};

const repoProvenanceSchema = {
  type: 'object',
  properties: {
    provider: { type: ['string', 'null'], enum: ['git', 'jj', 'none', null] },
    root: nullableString,
    head: repoHeadSchema,
    dirty: nullableBool,
    bookmarks: { type: ['array', 'null'], items: { type: 'string' } },
    detectedBy: nullableString,
    isRepo: nullableBool,
    commit: nullableString,
    branch: nullableString
  },
  additionalProperties: false
};

const toolInfoSchema = {
  type: 'object',
  properties: {
    version: { type: 'string' }
  },
  additionalProperties: false
};

const fileListBucket = {
  type: 'object',
  required: ['count', 'sample'],
  properties: {
    count: intId,
    sample: { type: 'array', items: { type: 'object' } }
  },
  additionalProperties: true
};

const fileListsSchema = {
  type: 'object',
  required: ['generatedAt', 'scanned', 'skipped'],
  properties: {
    generatedAt: { type: 'string' },
    scanned: fileListBucket,
    skipped: fileListBucket,
    extensions: { type: 'object' }
  },
  additionalProperties: false
};

const extractionReportExtractor = {
  type: ['object', 'null'],
  properties: {
    name: nullableString,
    version: nullableString,
    target: nullableString
  },
  additionalProperties: false
};

const extractionReportFile = {
  type: 'object',
  required: [
    'file',
    'sourceType',
    'status',
    'reason',
    'extractor',
    'sourceBytesHash',
    'sourceBytesHashAlgo',
    'normalizationPolicy',
    'chunkerVersion',
    'extractionConfigDigest',
    'extractionIdentityHash',
    'unitCounts',
    'warnings'
  ],
  properties: {
    file: { type: 'string' },
    sourceType: { type: 'string', enum: ['pdf', 'docx'] },
    status: { type: 'string', enum: ['ok', 'skipped'] },
    reason: nullableString,
    extractor: extractionReportExtractor,
    sourceBytesHash: nullableString,
    sourceBytesHashAlgo: nullableString,
    normalizationPolicy: nullableString,
    chunkerVersion: nullableString,
    extractionConfigDigest: { type: 'string' },
    extractionIdentityHash: nullableString,
    unitCounts: {
      anyOf: [
        {
          type: 'object',
          required: ['pages', 'paragraphs', 'totalUnits'],
          properties: {
            pages: intId,
            paragraphs: intId,
            totalUnits: intId
          },
          additionalProperties: false
        },
        { type: 'null' }
      ]
    },
    warnings: { type: 'array', items: { type: 'string' } }
  },
  additionalProperties: false
};

const extractionReportSchema = {
  type: 'object',
  required: [
    'schemaVersion',
    'mode',
    'generatedAt',
    'chunkerVersion',
    'extractionConfigDigest',
    'counts',
    'extractors',
    'files'
  ],
  properties: {
    schemaVersion: posInt,
    mode: { type: 'string', const: 'extracted-prose' },
    generatedAt: { type: 'string' },
    chunkerVersion: { type: 'string' },
    extractionConfigDigest: { type: 'string' },
    counts: {
      type: 'object',
      required: ['total', 'ok', 'skipped', 'byReason'],
      properties: {
        total: intId,
        ok: intId,
        skipped: intId,
        byReason: { type: 'object', additionalProperties: intId }
      },
      additionalProperties: false
    },
    extractors: {
      type: 'array',
      items: {
        type: 'object',
        required: ['name', 'version', 'target'],
        properties: {
          name: nullableString,
          version: nullableString,
          target: nullableString
        },
        additionalProperties: false
      }
    },
    files: { type: 'array', items: extractionReportFile }
  },
  additionalProperties: false
};

const lexiconRelationFilterCategoryCounts = {
  type: 'object',
  required: ['keywords', 'literals', 'builtins', 'types'],
  properties: {
    keywords: intId,
    literals: intId,
    builtins: intId,
    types: intId
  },
  additionalProperties: false
};

const lexiconRelationFilterReportFile = {
  type: 'object',
  required: [
    'file',
    'languageId',
    'droppedCalls',
    'droppedUsages',
    'droppedCallDetails',
    'droppedCallDetailsWithRange',
    'droppedTotal',
    'droppedCallsByCategory',
    'droppedUsagesByCategory'
  ],
  properties: {
    file: { type: 'string' },
    languageId: nullableString,
    droppedCalls: intId,
    droppedUsages: intId,
    droppedCallDetails: intId,
    droppedCallDetailsWithRange: intId,
    droppedTotal: intId,
    droppedCallsByCategory: lexiconRelationFilterCategoryCounts,
    droppedUsagesByCategory: lexiconRelationFilterCategoryCounts
  },
  additionalProperties: false
};

const lexiconRelationFilterReportSchema = {
  type: 'object',
  required: ['schemaVersion', 'mode', 'totals', 'files'],
  properties: {
    schemaVersion: posInt,
    mode: modeName,
    totals: {
      type: 'object',
      required: [
        'files',
        'droppedCalls',
        'droppedUsages',
        'droppedCallDetails',
        'droppedCallDetailsWithRange',
        'droppedTotal'
      ],
      properties: {
        files: intId,
        droppedCalls: intId,
        droppedUsages: intId,
        droppedCallDetails: intId,
        droppedCallDetailsWithRange: intId,
        droppedTotal: intId
      },
      additionalProperties: false
    },
    files: {
      type: 'array',
      items: lexiconRelationFilterReportFile
    }
  },
  additionalProperties: false
};

const shardedJsonlPart = {
  type: 'object',
  required: ['path', 'records', 'bytes'],
  properties: {
    path: { type: 'string' },
    records: intId,
    bytes: intId,
    checksum: nullableString,
    extensions: { type: 'object' }
  },
  additionalProperties: false
};

const baseShardedJsonlMeta = {
  type: 'object',
  required: [
    'schemaVersion',
    'artifact',
    'format',
    'generatedAt',
    'compression',
    'totalRecords',
    'totalBytes',
    'maxPartRecords',
    'maxPartBytes',
    'targetMaxBytes',
    'parts'
  ],
  properties: {
    schemaVersion: semverString,
    artifact: { type: 'string' },
    format: { type: 'string', enum: ['jsonl-sharded'] },
    generatedAt: { type: 'string' },
    compression: { type: 'string', enum: ['none', 'gzip', 'zstd'] },
    totalRecords: intId,
    totalBytes: intId,
    maxPartRecords: intId,
    maxPartBytes: intId,
    targetMaxBytes: nullableInt,
    parts: { type: 'array', items: shardedJsonlPart },
    extensions: { type: 'object' }
  },
  additionalProperties: false
};

const buildShardedJsonlMeta = (artifact) => ({
  ...baseShardedJsonlMeta,
  properties: {
    ...baseShardedJsonlMeta.properties,
    artifact: { type: 'string', const: artifact }
  }
});

const denseVectorsSchema = {
  type: 'object',
  required: ['dims', 'vectors'],
  properties: {
    dims: { type: 'integer', minimum: 1 },
    model: nullableString,
    scale: { type: 'number' },
    minVal: { type: 'number' },
    maxVal: { type: 'number' },
    levels: { type: 'integer', minimum: 2 },
    vectors: { type: 'array', items: denseVectorArray }
  },
  additionalProperties: true
};

const denseVectorsHnswMetaSchema = {
  type: 'object',
  required: ['dims', 'count', 'space', 'm', 'efConstruction', 'efSearch'],
  properties: {
    version: { type: 'integer', minimum: 1 },
    generatedAt: nullableString,
    model: nullableString,
    dims: { type: 'integer', minimum: 1 },
    count: { type: 'integer', minimum: 0 },
    space: { type: 'string' },
    m: { type: 'integer', minimum: 1 },
    efConstruction: { type: 'integer', minimum: 1 },
    efSearch: { type: 'integer', minimum: 1 },
    scale: { type: 'number' },
    minVal: { type: 'number' },
    maxVal: { type: 'number' },
    levels: { type: 'integer', minimum: 2 }
  },
  additionalProperties: true
};

const denseVectorsLanceDbMetaSchema = {
  type: 'object',
  required: ['dims', 'count', 'metric', 'table', 'embeddingColumn', 'idColumn'],
  properties: {
    version: { type: 'integer', minimum: 1 },
    generatedAt: nullableString,
    model: nullableString,
    dims: { type: 'integer', minimum: 1 },
    count: { type: 'integer', minimum: 0 },
    metric: { type: 'string' },
    table: { type: 'string' },
    embeddingColumn: { type: 'string' },
    idColumn: { type: 'string' },
    scale: { type: 'number' },
    minVal: { type: 'number' },
    maxVal: { type: 'number' },
    levels: { type: 'integer', minimum: 2 }
  },
  additionalProperties: true
};

const denseVectorsSqliteVecMetaSchema = {
  type: 'object',
  required: ['dims', 'count', 'table'],
  properties: {
    version: { type: 'integer', minimum: 1 },
    generatedAt: nullableString,
    model: nullableString,
    dims: { type: 'integer', minimum: 1 },
    count: { type: 'integer', minimum: 0 },
    table: { type: 'string' },
    embeddingColumn: nullableString,
    idColumn: nullableString,
    scale: { type: 'number' },
    minVal: { type: 'number' },
    maxVal: { type: 'number' },
    levels: { type: 'integer', minimum: 2 }
  },
  additionalProperties: true
};

const importResolutionGraphSchema = {
  type: 'object',
  required: ['generatedAt', 'nodes', 'edges', 'stats'],
  properties: {
    generatedAt: { type: 'string' },
    toolVersion: nullableString,
    importScanMode: nullableString,
    stats: {
      type: 'object',
      properties: {
        files: intId,
        edges: intId,
        resolved: intId,
        external: intId,
        unresolved: intId,
        truncatedEdges: { type: 'boolean' },
        truncatedNodes: { type: 'boolean' },
        warningSuppressed: intId
      },
      additionalProperties: true
    },
    nodes: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'type'],
        properties: {
          id: { type: 'string' },
          type: { type: 'string' }
        },
        additionalProperties: true
      }
    },
    edges: {
      type: 'array',
      items: {
        type: 'object',
        required: ['from', 'to', 'rawSpecifier', 'resolvedType'],
        properties: {
          from: { type: 'string' },
          to: { type: ['string', 'null'] },
          rawSpecifier: { type: 'string' },
          kind: { type: 'string' },
          resolvedType: { type: 'string' },
          resolvedPath: nullableString,
          packageName: nullableString,
          tsconfigPath: nullableString,
          tsPathPattern: nullableString
        },
        additionalProperties: true
      }
    },
    warnings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          importer: nullableString,
          specifier: nullableString,
          reason: nullableString
        },
        additionalProperties: true
      }
    }
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

const evidenceRef = {
  type: 'object',
  required: ['file', 'startLine', 'startCol', 'endLine', 'endCol', 'snippetHash'],
  properties: {
    file: { type: 'string' },
    startLine: posInt,
    startCol: posInt,
    endLine: posInt,
    endCol: posInt,
    snippetHash: nullableString
  },
  additionalProperties: true
};

const riskSignalSummary = {
  type: 'object',
  required: ['ruleId', 'ruleName', 'ruleType', 'category', 'severity', 'confidence', 'tags', 'evidence'],
  properties: {
    ruleId: { type: 'string' },
    ruleName: { type: 'string' },
    ruleType: { type: 'string' },
    category: nullableString,
    severity: nullableString,
    confidence: { type: ['number', 'null'] },
    tags: { type: 'array', items: { type: 'string' } },
    evidence: { type: 'array', items: evidenceRef }
  },
  additionalProperties: true
};

const riskLocalFlowSummary = {
  type: 'object',
  required: ['sourceRuleId', 'sinkRuleId', 'category', 'severity', 'confidence', 'evidence'],
  properties: {
    sourceRuleId: { type: 'string' },
    sinkRuleId: { type: 'string' },
    category: nullableString,
    severity: nullableString,
    confidence: { type: ['number', 'null'] },
    evidence: { type: 'array', items: evidenceRef }
  },
  additionalProperties: true
};

const riskSummaryRow = {
  type: 'object',
  required: ['schemaVersion', 'chunkUid', 'file', 'signals', 'totals', 'truncated'],
  properties: {
    schemaVersion: posInt,
    chunkUid: { type: 'string' },
    file: { type: 'string' },
    languageId: nullableString,
    symbol: {
      type: 'object',
      required: ['name', 'kind', 'signature'],
      properties: {
        name: nullableString,
        kind: nullableString,
        signature: nullableString
      },
      additionalProperties: true
    },
    signals: {
      type: 'object',
      required: ['sources', 'sinks', 'sanitizers', 'localFlows'],
      properties: {
        sources: { type: 'array', items: riskSignalSummary },
        sinks: { type: 'array', items: riskSignalSummary },
        sanitizers: { type: 'array', items: riskSignalSummary },
        localFlows: { type: 'array', items: riskLocalFlowSummary }
      },
      additionalProperties: true
    },
    taintHints: {
      type: 'object',
      required: ['taintedIdentifiers'],
      properties: {
        taintedIdentifiers: { type: 'array', items: { type: 'string' } }
      },
      additionalProperties: true
    },
    totals: {
      type: 'object',
      required: ['sources', 'sinks', 'sanitizers', 'localFlows'],
      properties: {
        sources: intId,
        sinks: intId,
        sanitizers: intId,
        localFlows: intId
      },
      additionalProperties: true
    },
    truncated: {
      type: 'object',
      required: ['sources', 'sinks', 'sanitizers', 'localFlows', 'evidence'],
      properties: {
        sources: { type: 'boolean' },
        sinks: { type: 'boolean' },
        sanitizers: { type: 'boolean' },
        localFlows: { type: 'boolean' },
        evidence: { type: 'boolean' }
      },
      additionalProperties: true
    }
  },
  additionalProperties: true
};

const riskFlowRow = {
  type: 'object',
  required: ['schemaVersion', 'flowId', 'source', 'sink', 'path', 'confidence', 'notes'],
  properties: {
    schemaVersion: posInt,
    flowId: { type: 'string', pattern: '^sha1:[0-9a-f]{40}$' },
    source: {
      type: 'object',
      required: ['chunkUid', 'ruleId', 'ruleName', 'ruleType', 'category', 'severity', 'confidence'],
      properties: {
        chunkUid: { type: 'string' },
        ruleId: { type: 'string' },
        ruleName: { type: 'string' },
        ruleType: { type: 'string' },
        category: nullableString,
        severity: nullableString,
        confidence: { type: ['number', 'null'] }
      },
      additionalProperties: true
    },
    sink: {
      type: 'object',
      required: ['chunkUid', 'ruleId', 'ruleName', 'ruleType', 'category', 'severity', 'confidence'],
      properties: {
        chunkUid: { type: 'string' },
        ruleId: { type: 'string' },
        ruleName: { type: 'string' },
        ruleType: { type: 'string' },
        category: nullableString,
        severity: nullableString,
        confidence: { type: ['number', 'null'] }
      },
      additionalProperties: true
    },
    path: {
      type: 'object',
      required: ['chunkUids', 'callSiteIdsByStep'],
      properties: {
        chunkUids: { type: 'array', items: { type: 'string' } },
        callSiteIdsByStep: {
          type: 'array',
          items: { type: 'array', items: { type: 'string' } }
        }
      },
      additionalProperties: true
    },
    confidence: { type: 'number' },
    notes: {
      type: 'object',
      required: ['strictness', 'sanitizerPolicy', 'hopCount', 'sanitizerBarriersHit', 'capsHit'],
      properties: {
        strictness: { type: 'string' },
        sanitizerPolicy: { type: 'string' },
        hopCount: intId,
        sanitizerBarriersHit: intId,
        capsHit: { type: 'array', items: { type: 'string' } }
      },
      additionalProperties: true
    }
  },
  additionalProperties: true
};

const riskInterproceduralStats = {
  type: 'object',
  required: [
    'schemaVersion',
    'generatedAt',
    'mode',
    'status',
    'effectiveConfig',
    'counts',
    'callSiteSampling',
    'capsHit',
    'timingMs'
  ],
  properties: {
    schemaVersion: posInt,
    generatedAt: { type: 'string' },
    mode: { type: 'string' },
    status: { type: 'string' },
    reason: nullableString,
    effectiveConfig: { type: 'object', additionalProperties: true },
    counts: { type: 'object', additionalProperties: true },
    callSiteSampling: { type: 'object', additionalProperties: true },
    capsHit: { type: 'array', items: { type: 'string' } },
    timingMs: { type: 'object', additionalProperties: true },
    artifacts: { type: 'object', additionalProperties: true },
    droppedRecords: { type: 'array', items: { type: 'object' } }
  },
  additionalProperties: true
};

const vfsManifestRow = {
  type: 'object',
  required: [
    'schemaVersion',
    'virtualPath',
    'docHash',
    'containerPath',
    'containerExt',
    'containerLanguageId',
    'languageId',
    'effectiveExt',
    'segmentUid',
    'segmentStart',
    'segmentEnd'
  ],
  properties: {
    schemaVersion: { type: 'string' },
    virtualPath: { type: 'string' },
    docHash: { type: 'string' },
    containerPath: { type: 'string' },
    containerExt: nullableString,
    containerLanguageId: nullableString,
    languageId: { type: 'string' },
    effectiveExt: { type: 'string' },
    segmentUid: nullableString,
    segmentId: nullableString,
    segmentStart: intId,
    segmentEnd: intId,
    lineStart: nullableInt,
    lineEnd: nullableInt,
    extensions: { type: 'object' }
  },
  additionalProperties: false
};

const vfsPathMapRow = {
  type: 'object',
  required: [
    'schemaVersion',
    'virtualPath',
    'hashVirtualPath',
    'containerPath',
    'segmentUid',
    'segmentStart',
    'segmentEnd',
    'effectiveExt',
    'languageId',
    'docHash'
  ],
  properties: {
    schemaVersion: { type: 'string' },
    virtualPath: { type: 'string' },
    hashVirtualPath: { type: 'string' },
    containerPath: { type: 'string' },
    segmentUid: nullableString,
    segmentStart: intId,
    segmentEnd: intId,
    effectiveExt: { type: 'string' },
    languageId: { type: 'string' },
    docHash: { type: 'string' }
  },
  additionalProperties: false
};

const vfsManifestIndexRow = {
  type: 'object',
  required: ['schemaVersion', 'virtualPath', 'offset', 'bytes'],
  properties: {
    schemaVersion: { type: 'string' },
    virtualPath: { type: 'string' },
    offset: intId,
    bytes: intId
  },
  additionalProperties: false
};

const vfsManifestBloom = {
  type: 'object',
  required: ['schemaVersion', 'algorithm', 'bits', 'hashes', 'count', 'bytes'],
  properties: {
    schemaVersion: { type: 'string' },
    algorithm: { type: 'string' },
    bits: intId,
    hashes: intId,
    count: intId,
    bytes: { type: 'string' }
  },
  additionalProperties: false
};

const chunkUidMapRow = {
  type: 'object',
  required: ['docId', 'chunkUid', 'chunkId', 'file', 'start', 'end'],
  properties: {
    docId: intId,
    chunkUid: { type: 'string' },
    chunkId: { type: 'string' },
    file: { type: 'string' },
    segmentUid: nullableString,
    segmentId: nullableString,
    start: intId,
    end: intId,
    extensions: { type: 'object' }
  },
  additionalProperties: false
};

export const MANIFEST_ONLY_ARTIFACT_NAMES = [
  'dense_vectors_hnsw',
  'dense_vectors_doc_hnsw',
  'dense_vectors_code_hnsw',
  'dense_vectors_lancedb',
  'dense_vectors_doc_lancedb',
  'dense_vectors_code_lancedb',
  'chunk_meta_binary_columnar',
  'chunk_meta_binary_columnar_offsets',
  'chunk_meta_binary_columnar_lengths',
  'chunk_meta_binary_columnar_meta',
  'call_sites_offsets',
  'chunk_meta_offsets',
  'chunk_meta_cold_offsets',
  'graph_relations_offsets',
  'token_postings_binary_columnar',
  'token_postings_binary_columnar_offsets',
  'token_postings_binary_columnar_lengths',
  'token_postings_binary_columnar_meta',
  'token_postings_offsets',
  'symbol_edges_offsets',
  'symbol_occurrences_offsets',
  'symbols_offsets',
  'symbol_occurrences_by_file',
  'symbol_occurrences_by_file_offsets',
  'symbol_occurrences_by_file_meta',
  'symbol_edges_by_file',
  'symbol_edges_by_file_offsets',
  'symbol_edges_by_file_meta',
  'minhash_signatures_packed',
  'minhash_signatures_packed_meta'
];

export const ARTIFACT_SCHEMA_DEFS = {
  chunk_meta: {
    anyOf: [
      { type: 'array', items: chunkMetaEntry },
      columnarEnvelope
    ]
  },
  chunk_meta_cold: {
    type: 'array',
    items: {
      type: 'object',
      required: ['id'],
      properties: {
        id: intId,
        metaV2: {
          anyOf: [METADATA_V2_SCHEMA, { type: 'null' }]
        }
      },
      additionalProperties: true
    }
  },
  chunk_uid_map: {
    type: 'array',
    items: chunkUidMapRow
  },
  vfs_manifest: {
    type: 'array',
    items: vfsManifestRow
  },
  vfs_path_map: {
    type: 'array',
    items: vfsPathMapRow
  },
  vfs_manifest_index: {
    type: 'array',
    items: vfsManifestIndexRow
  },
  vfs_manifest_bloom: vfsManifestBloom,
  file_meta: {
    anyOf: [
      {
        type: 'array',
        items: {
          type: 'object',
          required: ['id', 'file'],
          properties: {
            id: intId,
            file: { type: 'string' },
            ext: nullableString,
            encoding: nullableString,
            encodingFallback: { type: ['boolean', 'null'] },
            encodingConfidence: { type: ['number', 'null'] }
          },
          additionalProperties: true
        }
      },
      columnarEnvelope
    ]
  },
  repo_map: {
    type: 'array',
    items: {
      type: 'object',
      required: ['file', 'name'],
      properties: {
        file: { type: 'string' },
        name: { type: 'string' },
        kind: nullableString,
        signature: nullableString,
        exported: { type: ['boolean', 'null'] }
      },
      additionalProperties: true
    }
  },
  file_relations: {
    type: 'array',
    items: {
      type: 'object',
      required: ['file', 'relations'],
      properties: {
        file: { type: 'string' },
        relations: { type: 'object' },
        importBindings: { type: 'object' }
      },
      additionalProperties: true
    }
  },
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
  },
  vocab_order: {
    type: 'object',
    properties: {
      fields: { type: 'object' },
      vocab: { type: 'object' }
    },
    additionalProperties: true
  },
  api_contracts: {
    type: 'array',
    items: {
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
              arity: { type: ['number', 'null'] },
              args: { type: ['array', 'null'], items: { type: 'string' } },
              callSiteId: nullableString,
              file: nullableString,
              startLine: { type: ['number', 'null'] },
              confidence: { type: ['number', 'null'] }
            },
            additionalProperties: true
          }
        },
        warnings: { type: ['array', 'null'], items: { type: 'object' } },
        truncation: { type: ['array', 'null'], items: { type: 'object' } }
      },
      additionalProperties: true
    }
  },
  risk_summaries: {
    type: 'array',
    items: riskSummaryRow
  },
  risk_flows: {
    type: 'array',
    items: riskFlowRow
  },
  risk_interprocedural_stats: riskInterproceduralStats,
  token_postings: {
    type: 'object',
    required: ['vocab', 'postings', 'docLengths'],
    properties: {
      vocab: vocabArray,
      postings: postingsList,
      docLengths: docLengthsArray,
      avgDocLen: { type: 'number' },
      totalDocs: { type: 'integer' }
    },
    additionalProperties: true
  },
  token_postings_meta: {
    type: 'object',
    required: ['format', 'shardSize', 'vocabCount', 'parts'],
    properties: {
      avgDocLen: { type: 'number' },
      totalDocs: intId,
      format: { type: 'string' },
      shardSize: intId,
      vocabCount: intId,
      parts: { type: 'array', items: { type: 'string' } },
      compression: nullableString,
      docLengths: docLengthsArray,
      extensions: { type: 'object' }
    },
    additionalProperties: false
  },
  field_postings: {
    type: 'object',
    required: ['fields'],
    properties: {
      fields: {
        type: 'object',
        additionalProperties: {
          type: 'object',
          required: ['vocab', 'postings', 'docLengths'],
          properties: {
            vocab: vocabArray,
            postings: postingsList,
            docLengths: docLengthsArray,
            avgDocLen: { type: 'number' },
            totalDocs: { type: 'integer' }
          },
          additionalProperties: true
        }
      }
    },
    additionalProperties: true
  },
  field_tokens: {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        name: { type: 'array', items: { type: 'string' } },
        signature: { type: 'array', items: { type: 'string' } },
        doc: { type: 'array', items: { type: 'string' } },
        comment: { type: 'array', items: { type: 'string' } },
        body: { type: 'array', items: { type: 'string' } }
      },
      additionalProperties: true
    }
  },
  minhash_signatures: {
    type: 'object',
    required: ['signatures'],
    properties: {
      signatures: {
        type: 'array',
        items: { type: 'array', items: intId }
      }
    },
    additionalProperties: true
  },
  dense_vectors: denseVectorsSchema,
  dense_vectors_doc: denseVectorsSchema,
  dense_vectors_code: denseVectorsSchema,
  dense_vectors_hnsw_meta: denseVectorsHnswMetaSchema,
  dense_vectors_doc_hnsw_meta: denseVectorsHnswMetaSchema,
  dense_vectors_code_hnsw_meta: denseVectorsHnswMetaSchema,
  dense_vectors_lancedb_meta: denseVectorsLanceDbMetaSchema,
  dense_vectors_doc_lancedb_meta: denseVectorsLanceDbMetaSchema,
  dense_vectors_code_lancedb_meta: denseVectorsLanceDbMetaSchema,
  dense_vectors_sqlite_vec_meta: denseVectorsSqliteVecMetaSchema,
  phrase_ngrams: {
    type: 'object',
    required: ['vocab', 'postings'],
    properties: {
      vocab: vocabArray,
      postings: idPostingList
    },
    additionalProperties: true
  },
  chargram_postings: {
    type: 'object',
    required: ['vocab', 'postings'],
    properties: {
      vocab: vocabArray,
      postings: idPostingList
    },
    additionalProperties: true
  },
  filter_index: {
    type: 'object',
    required: ['fileById', 'fileChunksById'],
    properties: {
      fileChargramN: { type: 'integer', minimum: 2 },
      fileById: { type: 'array', items: { type: 'string' } },
      fileChunksById: idPostingList,
      byExt: { type: 'object' },
      byLang: { type: 'object' },
      byKind: { type: 'object' },
      byAuthor: { type: 'object' },
      byChunkAuthor: { type: 'object' },
      byVisibility: { type: 'object' },
      fileChargrams: { type: 'object' }
    },
    additionalProperties: true
  },
  filelists: fileListsSchema,
  extraction_report: extractionReportSchema,
  lexicon_relation_filter_report: lexiconRelationFilterReportSchema,
  pieces_manifest: {
    type: 'object',
    required: ['version', 'artifactSurfaceVersion', 'pieces'],
    properties: {
      version: { type: 'integer' },
      artifactSurfaceVersion: semverString,
      compatibilityKey: nullableString,
      generatedAt: nullableString,
      updatedAt: nullableString,
      mode: nullableString,
      stage: nullableString,
      repoId: nullableString,
      buildId: nullableString,
      pieces: {
        type: 'array',
        items: pieceEntry
      },
      extensions: { type: 'object' }
    },
    additionalProperties: false
  },
  index_state: {
    type: 'object',
    required: ['generatedAt', 'mode', 'artifactSurfaceVersion'],
    properties: {
      generatedAt: { type: 'string' },
      updatedAt: nullableString,
      artifactSurfaceVersion: semverString,
      profile: {
        type: 'object',
        required: ['id', 'schemaVersion'],
        properties: {
          id: { type: 'string', enum: ['default', 'vector_only'] },
          schemaVersion: { type: 'number', const: 1 }
        },
        additionalProperties: false
      },
      compatibilityKey: nullableString,
      cohortKey: nullableString,
      repoId: nullableString,
      buildId: nullableString,
      mode: { type: 'string' },
      stage: nullableString,
      assembled: { type: 'boolean' },
      embeddings: { type: 'object', additionalProperties: true },
      features: { type: 'object', additionalProperties: true },
      shards: { type: 'object', additionalProperties: true },
      enrichment: { type: 'object', additionalProperties: true },
      filterIndex: { type: 'object', additionalProperties: true },
      sqlite: { type: 'object', additionalProperties: true },
      lmdb: { type: 'object', additionalProperties: true },
      artifacts: {
        type: 'object',
        required: ['schemaVersion', 'present', 'omitted', 'requiredForSearch'],
        properties: {
          schemaVersion: { type: 'number', const: 1 },
          present: {
            type: 'object',
            additionalProperties: { type: 'boolean' }
          },
          omitted: {
            type: 'array',
            items: { type: 'string' }
          },
          requiredForSearch: {
            type: 'array',
            items: { type: 'string' }
          }
        },
        additionalProperties: false
      },
      riskInterprocedural: {
        type: 'object',
        required: ['enabled', 'summaryOnly', 'emitArtifacts'],
        properties: {
          enabled: { type: 'boolean' },
          summaryOnly: { type: 'boolean' },
          emitArtifacts: { type: ['string', 'null'] }
        },
        additionalProperties: true
      },
      riskRules: {
        anyOf: [RISK_RULES_BUNDLE_SCHEMA, { type: 'null' }]
      },
      extensions: { type: 'object' }
    },
    additionalProperties: false
  },
  builds_current: {
    type: 'object',
    required: ['buildId', 'buildRoot', 'promotedAt', 'artifactSurfaceVersion'],
    properties: {
      buildId: { type: 'string' },
      buildRoot: { type: 'string' },
      buildRoots: { type: ['object', 'null'], additionalProperties: { type: 'string' } },
      buildRootsByMode: { type: ['object', 'null'], additionalProperties: { type: 'string' } },
      buildRootsByStage: { type: ['object', 'null'], additionalProperties: { type: 'string' } },
      promotedAt: { type: 'string' },
      stage: nullableString,
      modes: { type: ['array', 'null'], items: { type: 'string' } },
      configHash: nullableString,
      artifactSurfaceVersion: semverString,
      compatibilityKey: nullableString,
      tool: toolInfoSchema,
      repo: repoProvenanceSchema,
      extensions: { type: 'object' }
    },
    additionalProperties: false
  },
  snapshots_manifest: {
    type: 'object',
    required: ['version', 'updatedAt', 'snapshots', 'tags'],
    properties: {
      version: posInt,
      updatedAt: { type: 'string' },
      snapshots: {
        type: 'object',
        additionalProperties: snapshotSummaryEntry
      },
      tags: {
        type: 'object',
        additionalProperties: {
          type: 'array',
          items: snapshotIdString
        }
      }
    },
    additionalProperties: false
  },
  snapshot_record: {
    type: 'object',
    required: ['version', 'snapshotId', 'createdAt', 'kind', 'tags', 'pointer'],
    properties: {
      version: posInt,
      snapshotId: snapshotIdString,
      createdAt: { type: 'string' },
      kind: { type: 'string', enum: ['pointer', 'frozen'] },
      label: nullableString,
      notes: nullableString,
      tags: { type: 'array', items: { type: 'string' } },
      pointer: snapshotPointerSchema,
      provenance: snapshotProvenanceSchema
    },
    additionalProperties: false
  },
  snapshot_frozen: {
    type: 'object',
    required: ['version', 'snapshotId', 'frozenAt', 'method', 'frozenRoot', 'included', 'verification'],
    properties: {
      version: posInt,
      snapshotId: snapshotIdString,
      frozenAt: { type: 'string' },
      method: { type: 'string' },
      frozenRoot: { type: 'string' },
      included: {
        type: 'object',
        required: ['modes', 'sqlite', 'lmdb'],
        properties: {
          modes: modeList,
          sqlite: { type: 'boolean' },
          lmdb: { type: 'boolean' }
        },
        additionalProperties: false
      },
      verification: {
        type: 'object',
        required: ['checkedAt', 'ok'],
        properties: {
          checkedAt: { type: 'string' },
          ok: { type: 'boolean' },
          filesChecked: nullableInt,
          bytesChecked: nullableInt,
          failures: { type: ['array', 'null'], items: { type: 'string' } }
        },
        additionalProperties: true
      }
    },
    additionalProperties: false
  },
  diffs_manifest: {
    type: 'object',
    required: ['version', 'updatedAt', 'diffs'],
    properties: {
      version: posInt,
      updatedAt: { type: 'string' },
      diffs: {
        type: 'object',
        additionalProperties: diffManifestEntry
      }
    },
    additionalProperties: false
  },
  diff_inputs: {
    type: 'object',
    required: ['id', 'createdAt', 'from', 'to', 'modes', 'allowMismatch', 'identityHash'],
    properties: {
      id: diffIdString,
      createdAt: { type: 'string' },
      from: diffRefSchema,
      to: diffRefSchema,
      modes: modeList,
      allowMismatch: { type: 'boolean' },
      identityHash: { type: 'string' },
      fromConfigHash: nullableString,
      toConfigHash: nullableString,
      fromToolVersion: nullableString,
      toToolVersion: nullableString
    },
    additionalProperties: true
  },
  diff_summary: {
    type: 'object',
    required: ['id', 'createdAt', 'from', 'to', 'modes'],
    properties: {
      id: diffIdString,
      createdAt: { type: 'string' },
      from: diffRefSchema,
      to: diffRefSchema,
      modes: modeList,
      truncated: { type: 'boolean' },
      limits: {
        type: ['object', 'null'],
        additionalProperties: true
      },
      totals: {
        type: ['object', 'null'],
        additionalProperties: true
      }
    },
    additionalProperties: true
  },
  graph_relations: {
    type: 'object',
    required: ['version', 'generatedAt', 'callGraph', 'usageGraph', 'importGraph'],
    properties: {
      version: { type: 'integer', minimum: 1 },
      generatedAt: { type: 'string' },
      callGraph: graphPayload,
      usageGraph: graphPayload,
      importGraph: graphPayload
    },
    additionalProperties: true
  },
  import_resolution_graph: importResolutionGraphSchema,
  chunk_meta_meta: buildShardedJsonlMeta('chunk_meta'),
  chunk_meta_cold_meta: buildShardedJsonlMeta('chunk_meta_cold'),
  chunk_uid_map_meta: buildShardedJsonlMeta('chunk_uid_map'),
  vfs_manifest_meta: buildShardedJsonlMeta('vfs_manifest'),
  vfs_path_map_meta: buildShardedJsonlMeta('vfs_path_map'),
  file_relations_meta: buildShardedJsonlMeta('file_relations'),
  symbols_meta: buildShardedJsonlMeta('symbols'),
  symbol_occurrences_meta: buildShardedJsonlMeta('symbol_occurrences'),
  symbol_edges_meta: buildShardedJsonlMeta('symbol_edges'),
  call_sites_meta: buildShardedJsonlMeta('call_sites'),
  risk_summaries_meta: buildShardedJsonlMeta('risk_summaries'),
  risk_flows_meta: buildShardedJsonlMeta('risk_flows'),
  repo_map_meta: buildShardedJsonlMeta('repo_map'),
  graph_relations_meta: buildShardedJsonlMeta('graph_relations')
};
