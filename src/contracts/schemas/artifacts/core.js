import { METADATA_V2_SCHEMA } from '../analysis.js';

const intId = { type: 'integer', minimum: 0 };
const nullableString = { type: ['string', 'null'] };
const nullableInt = { type: ['integer', 'null'], minimum: 0 };

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
        nodes: intId,
        edges: intId,
        resolved: intId,
        external: intId,
        unresolved: intId,
        unresolvedObserved: intId,
        unresolvedActionable: intId,
        unresolvedSuppressed: intId,
        unresolvedResolverSuppressed: intId,
        unresolvedByCategory: { type: 'object', additionalProperties: intId },
        unresolvedByReasonCode: { type: 'object', additionalProperties: intId },
        unresolvedByFailureCause: { type: 'object', additionalProperties: intId },
        unresolvedByDisposition: { type: 'object', additionalProperties: intId },
        unresolvedLiveSuppressed: intId,
        unresolvedGateSuppressed: intId,
        unresolvedLiveSuppressedCategories: { type: 'array', items: { type: 'string' } },
        truncatedEdges: intId,
        truncatedNodes: intId,
        warningSuppressed: intId,
        maxEdges: intId,
        maxNodes: intId
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
          resolutionState: nullableString,
          resolvedType: { type: 'string' },
          resolvedPath: nullableString,
          packageName: nullableString,
          tsconfigPath: nullableString,
          tsPathPattern: nullableString,
          reasonCode: nullableString,
          failureCause: nullableString,
          disposition: nullableString,
          resolverStage: nullableString
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
          reason: nullableString,
          reasonCode: nullableString,
          resolutionState: nullableString,
          failureCause: nullableString,
          disposition: nullableString,
          resolverStage: nullableString,
          category: nullableString,
          confidence: { type: ['number', 'null'] }
        },
        additionalProperties: true
      }
    }
  },
  additionalProperties: true
};

export const CORE_PRE_VFS_ARTIFACT_SCHEMA_DEFS = {
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
  }
};

export const CORE_POST_VFS_ARTIFACT_SCHEMA_DEFS = {
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
  }
};

export const CORE_POST_SYMBOL_ARTIFACT_SCHEMA_DEFS = {
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
  }
};

export const CORE_POST_RISK_ARTIFACT_SCHEMA_DEFS = {
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
  }
};

export const CORE_POST_DENSE_VECTOR_ARTIFACT_SCHEMA_DEFS = {
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
  }
};

export const CORE_POST_SNAPSHOT_ARTIFACT_SCHEMA_DEFS = {
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
  import_resolution_graph: importResolutionGraphSchema
};
