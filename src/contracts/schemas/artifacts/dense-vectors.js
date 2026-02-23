const intId = { type: 'integer', minimum: 0 };
const nullableString = { type: ['string', 'null'] };

const denseVectorArray = {
  type: 'array',
  items: intId
};

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

export const DENSE_VECTOR_ARTIFACT_SCHEMA_DEFS = {
  dense_vectors: denseVectorsSchema,
  dense_vectors_doc: denseVectorsSchema,
  dense_vectors_code: denseVectorsSchema,
  dense_vectors_hnsw_meta: denseVectorsHnswMetaSchema,
  dense_vectors_doc_hnsw_meta: denseVectorsHnswMetaSchema,
  dense_vectors_code_hnsw_meta: denseVectorsHnswMetaSchema,
  dense_vectors_lancedb_meta: denseVectorsLanceDbMetaSchema,
  dense_vectors_doc_lancedb_meta: denseVectorsLanceDbMetaSchema,
  dense_vectors_code_lancedb_meta: denseVectorsLanceDbMetaSchema,
  dense_vectors_sqlite_vec_meta: denseVectorsSqliteVecMetaSchema
};
