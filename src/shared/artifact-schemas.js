import Ajv from 'ajv';

const ajv = new Ajv({
  allErrors: true,
  allowUnionTypes: true,
  strict: true
});

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
    ext: nullableString
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

const validators = {
  chunk_meta: ajv.compile({
    type: 'array',
    items: chunkMetaEntry
  }),
  file_meta: ajv.compile({
    type: 'array',
    items: {
      type: 'object',
      required: ['id', 'file'],
      properties: {
        id: intId,
        file: { type: 'string' },
        ext: nullableString
      },
      additionalProperties: true
    }
  }),
  repo_map: ajv.compile({
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
  }),
  file_relations: ajv.compile({
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
  }),
  token_postings: ajv.compile({
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
  }),
  field_postings: ajv.compile({
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
  }),
  field_tokens: ajv.compile({
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
  }),
  minhash_signatures: ajv.compile({
    type: 'object',
    required: ['signatures'],
    properties: {
      signatures: {
        type: 'array',
        items: { type: 'array', items: intId }
      }
    },
    additionalProperties: true
  }),
  dense_vectors: ajv.compile({
    type: 'object',
    required: ['dims', 'vectors'],
    properties: {
      dims: { type: 'integer', minimum: 1 },
      model: nullableString,
      scale: { type: 'number' },
      vectors: { type: 'array', items: denseVectorArray }
    },
    additionalProperties: true
  }),
  dense_vectors_hnsw_meta: ajv.compile({
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
  }),
  phrase_ngrams: ajv.compile({
    type: 'object',
    required: ['vocab', 'postings'],
    properties: {
      vocab: vocabArray,
      postings: idPostingList
    },
    additionalProperties: true
  }),
  chargram_postings: ajv.compile({
    type: 'object',
    required: ['vocab', 'postings'],
    properties: {
      vocab: vocabArray,
      postings: idPostingList
    },
    additionalProperties: true
  }),
  filter_index: ajv.compile({
    type: 'object',
    required: ['fileById', 'fileChunksById'],
    properties: {
      fileChargramN: { type: 'integer', minimum: 2 },
      fileById: { type: 'array', items: { type: 'string' } },
      fileChunksById: idPostingList,
      byExt: { type: 'object' },
      byKind: { type: 'object' },
      byAuthor: { type: 'object' },
      byChunkAuthor: { type: 'object' },
      byVisibility: { type: 'object' },
      fileChargrams: { type: 'object' }
    },
    additionalProperties: true
  }),
  pieces_manifest: ajv.compile({
    type: 'object',
    required: ['version', 'pieces'],
    properties: {
      version: { type: 'integer' },
      generatedAt: nullableString,
      updatedAt: nullableString,
      mode: nullableString,
      stage: nullableString,
      pieces: {
        type: 'array',
        items: {
          type: 'object',
          required: ['type', 'name', 'format', 'path'],
          properties: {
            type: { type: 'string' },
            name: { type: 'string' },
            format: { type: 'string' },
            path: { type: 'string' },
            bytes: { type: ['integer', 'null'] },
            checksum: nullableString
          },
          additionalProperties: true
        }
      }
    },
    additionalProperties: true
  }),
  index_state: ajv.compile({
    type: 'object',
    required: ['generatedAt', 'mode'],
    properties: {
      generatedAt: { type: 'string' },
      updatedAt: nullableString,
      mode: { type: 'string' },
      stage: nullableString
    },
    additionalProperties: true
  }),
  graph_relations: ajv.compile({
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
  })
};

const formatError = (error) => {
  const path = error.instancePath || '/';
  const message = error.message || 'schema error';
  return `${path} ${message}`.trim();
};

export function validateArtifact(name, data) {
  const validator = validators[name];
  if (!validator) return { ok: true, errors: [] };
  const ok = Boolean(validator(data));
  const errors = ok || !validator.errors
    ? []
    : validator.errors.map(formatError);
  return { ok, errors };
}
