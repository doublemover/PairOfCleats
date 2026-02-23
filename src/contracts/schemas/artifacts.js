import { METADATA_V2_SCHEMA, RISK_RULES_BUNDLE_SCHEMA } from './analysis.js';
import { DENSE_VECTOR_ARTIFACT_SCHEMA_DEFS } from './artifacts/dense-vectors.js';
import { RISK_ARTIFACT_SCHEMA_DEFS } from './artifacts/risk.js';
import { SNAPSHOT_DIFF_ARTIFACT_SCHEMA_DEFS } from './artifacts/snapshots-diffs.js';
import { SYMBOL_CALL_SITE_ARTIFACT_SCHEMA_DEFS } from './artifacts/symbols-call-sites.js';
import { VFS_ARTIFACT_SCHEMA_DEFS } from './artifacts/vfs.js';

const intId = { type: 'integer', minimum: 0 };
const nullableString = { type: ['string', 'null'] };
const nullableInt = { type: ['integer', 'null'], minimum: 0 };
const nullableBool = { type: ['boolean', 'null'] };
const posInt = { type: 'integer', minimum: 1 };
const semverString = { type: 'string', pattern: '^\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?$' };
const modeName = { type: 'string', enum: ['code', 'prose', 'extracted-prose', 'records'] };

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

const idPostingList = {
  type: 'array',
  items: { type: 'array', items: intId }
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
    tier: nullableString,
    layout: {
      type: ['object', 'null'],
      properties: {
        order: nullableInt,
        group: nullableString,
        contiguous: nullableBool
      },
      additionalProperties: false
    },
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
    operationId: nullableString,
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

const extractionReportLowYieldBailout = {
  type: 'object',
  required: [
    'enabled',
    'triggered',
    'reason',
    'qualityImpact',
    'seed',
    'warmupWindowSize',
    'warmupSampleSize',
    'sampledFiles',
    'sampledYieldedFiles',
    'sampledChunkCount',
    'observedYieldRatio',
    'minYieldRatio',
    'minYieldedFiles',
    'skippedFiles',
    'decisionAtOrderIndex',
    'decisionAt',
    'deterministic',
    'downgradedRecall'
  ],
  properties: {
    enabled: { type: 'boolean' },
    triggered: { type: 'boolean' },
    reason: nullableString,
    qualityImpact: nullableString,
    seed: nullableString,
    warmupWindowSize: intId,
    warmupSampleSize: intId,
    sampledFiles: intId,
    sampledYieldedFiles: intId,
    sampledChunkCount: intId,
    observedYieldRatio: { type: 'number' },
    minYieldRatio: { type: 'number' },
    minYieldedFiles: intId,
    skippedFiles: intId,
    decisionAtOrderIndex: nullableInt,
    decisionAt: nullableString,
    deterministic: { type: 'boolean' },
    downgradedRecall: { type: 'boolean' }
  },
  additionalProperties: false
};

const extractionReportQuality = {
  type: 'object',
  required: ['lowYieldBailout'],
  properties: {
    lowYieldBailout: extractionReportLowYieldBailout
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
    'quality',
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
    quality: extractionReportQuality,
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

const boilerplateCatalogEntry = {
  type: 'object',
  required: ['ref', 'count', 'positions', 'tags', 'sampleFiles'],
  properties: {
    ref: { type: 'string' },
    count: intId,
    positions: {
      type: 'object',
      additionalProperties: intId
    },
    tags: { type: 'array', items: { type: 'string' } },
    sampleFiles: { type: 'array', items: { type: 'string' } }
  },
  additionalProperties: false
};

const boilerplateCatalogSchema = {
  type: 'object',
  required: ['schemaVersion', 'generatedAt', 'entries'],
  properties: {
    schemaVersion: semverString,
    generatedAt: { type: 'string' },
    entries: {
      type: 'array',
      items: boilerplateCatalogEntry
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
  ...VFS_ARTIFACT_SCHEMA_DEFS,
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
  ...SYMBOL_CALL_SITE_ARTIFACT_SCHEMA_DEFS,
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
  ...RISK_ARTIFACT_SCHEMA_DEFS,
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
  ...DENSE_VECTOR_ARTIFACT_SCHEMA_DEFS,
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
  boilerplate_catalog: boilerplateCatalogSchema,
  determinism_report: {
    type: 'object',
    required: [
      'schemaVersion',
      'generatedAt',
      'mode',
      'stableHashExclusions',
      'sourceReasons',
      'normalizedStateHash'
    ],
    properties: {
      schemaVersion: { type: 'integer', minimum: 1 },
      generatedAt: { type: 'string' },
      mode: nullableString,
      stableHashExclusions: {
        type: 'array',
        items: { type: 'string' }
      },
      sourceReasons: {
        type: 'array',
        items: {
          type: 'object',
          required: ['path', 'category', 'reason', 'source'],
          properties: {
            path: { type: 'string' },
            category: { type: 'string' },
            reason: { type: 'string' },
            source: { type: 'string' }
          },
          additionalProperties: false
        }
      },
      normalizedStateHash: nullableString
    },
    additionalProperties: false
  },
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
  ...SNAPSHOT_DIFF_ARTIFACT_SCHEMA_DEFS,
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
  file_meta_meta: buildShardedJsonlMeta('file_meta'),
  chunk_meta_meta: buildShardedJsonlMeta('chunk_meta'),
  chunk_meta_cold_meta: buildShardedJsonlMeta('chunk_meta_cold'),
  chunk_uid_map_meta: buildShardedJsonlMeta('chunk_uid_map'),
  vfs_manifest_meta: buildShardedJsonlMeta('vfs_manifest'),
  vfs_path_map_meta: buildShardedJsonlMeta('vfs_path_map'),
  field_tokens_meta: buildShardedJsonlMeta('field_tokens'),
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
