import { METADATA_V2_SCHEMA, RISK_RULES_BUNDLE_SCHEMA } from './analysis.js';

const intId = { type: 'integer', minimum: 0 };
const nullableString = { type: ['string', 'null'] };
const nullableInt = { type: ['integer', 'null'], minimum: 0 };
const nullableBool = { type: ['boolean', 'null'] };
const posInt = { type: 'integer', minimum: 1 };
const nullablePosInt = { type: ['integer', 'null'], minimum: 1 };
const semverString = { type: 'string', pattern: '^\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?$' };

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

const repoProvenanceSchema = {
  type: 'object',
  properties: {
    commit: nullableString,
    dirty: nullableBool,
    branch: nullableString,
    isRepo: { type: 'boolean' }
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
    efSearch: { type: 'integer', minimum: 1 }
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
    idColumn: { type: 'string' }
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
    idColumn: nullableString
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

export const ARTIFACT_SCHEMA_DEFS = {
  chunk_meta: {
    type: 'array',
    items: chunkMetaEntry
  },
  chunk_uid_map: {
    type: 'array',
    items: chunkUidMapRow
  },
  vfs_manifest: {
    type: 'array',
    items: vfsManifestRow
  },
  file_meta: {
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
        relations: { type: 'object' }
      },
      additionalProperties: true
    }
  },
  call_sites: {
    type: 'array',
    items: callSiteEntry
  },
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
      compatibilityKey: nullableString,
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
  chunk_uid_map_meta: buildShardedJsonlMeta('chunk_uid_map'),
  vfs_manifest_meta: buildShardedJsonlMeta('vfs_manifest'),
  file_relations_meta: buildShardedJsonlMeta('file_relations'),
  call_sites_meta: buildShardedJsonlMeta('call_sites'),
  repo_map_meta: buildShardedJsonlMeta('repo_map'),
  graph_relations_meta: buildShardedJsonlMeta('graph_relations')
};
