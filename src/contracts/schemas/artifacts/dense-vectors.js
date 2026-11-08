const quantizedByte = { type: 'integer', minimum: 0, maximum: 255 };
const quantizationProperties = {
  quantizationVersion: { enum: [1, 2] },
  zeroPoint: quantizedByte,
  absence: { const: 'validity-mask' },
  scale: { type: 'number', exclusiveMinimum: 0 },
  minVal: { type: 'number' },
  maxVal: { type: 'number' },
  levels: { type: 'integer', minimum: 2, maximum: 256 }
};
const nullableString = { type: ['string', 'null'] };
const embeddingBindingProperties = {
  embeddingIdentity: { type: 'object', additionalProperties: true },
  embeddingGeneration: { type: 'string', pattern: '^[a-f0-9]{64}$' }
};
const nativeBindingProperties = {
  ...embeddingBindingProperties,
  backendGeneration: { type: 'string', pattern: '^\\.embeddings-backends/[a-f0-9]{64}-[a-f0-9-]{36}$' },
  variant: { enum: ['merged', 'doc', 'code'] }
};

const denseVectorArray = {
  type: 'array',
  items: quantizedByte
};

const denseVectorsSchema = {
  type: 'object',
  required: ['dims', 'vectors'],
  properties: {
    ...embeddingBindingProperties,
    dims: { type: 'integer', minimum: 1 },
    model: nullableString,
    ...quantizationProperties,
    vectors: { type: 'array', items: denseVectorArray }
  },
  additionalProperties: true
};

const denseVectorsHnswMetaSchema = {
  type: 'object',
  required: ['dims', 'count', 'space', 'm', 'efConstruction', 'efSearch'],
  properties: {
    ...nativeBindingProperties,
    version: { type: 'integer', minimum: 1 },
    generatedAt: nullableString,
    model: nullableString,
    dims: { type: 'integer', minimum: 1 },
    count: { type: 'integer', minimum: 0 },
    expectedCount: { type: 'integer', minimum: 0 },
    space: { type: 'string' },
    m: { type: 'integer', minimum: 1 },
    efConstruction: { type: 'integer', minimum: 1 },
    efSearch: { type: 'integer', minimum: 1 },
    ...quantizationProperties
  },
  additionalProperties: true
};

const denseVectorsLanceDbMetaSchema = {
  type: 'object',
  required: ['dims', 'count', 'metric', 'table', 'embeddingColumn', 'idColumn'],
  properties: {
    ...nativeBindingProperties,
    version: { type: 'integer', minimum: 1 },
    generatedAt: nullableString,
    model: nullableString,
    dims: { type: 'integer', minimum: 1 },
    count: { type: 'integer', minimum: 0 },
    expectedCount: { type: 'integer', minimum: 0 },
    metric: { type: 'string' },
    table: { type: 'string' },
    embeddingColumn: { type: 'string' },
    idColumn: { type: 'string' },
    ...quantizationProperties
  },
  additionalProperties: true
};

const denseVectorsSqliteVecMetaSchema = {
  type: 'object',
  required: ['dims', 'count', 'table'],
  properties: {
    ...embeddingBindingProperties,
    version: { type: 'integer', minimum: 1 },
    generatedAt: nullableString,
    model: nullableString,
    dims: { type: 'integer', minimum: 1 },
    count: { type: 'integer', minimum: 0 },
    table: { type: 'string' },
    embeddingColumn: nullableString,
    idColumn: nullableString,
    ...quantizationProperties
  },
  additionalProperties: true
};

const denseVectorsBinaryMetaSchema = {
  type: 'object',
  required: ['dims', 'count', 'path'],
  properties: {
    ...embeddingBindingProperties,
    schemaVersion: nullableString,
    artifact: nullableString,
    format: { type: 'string' },
    generatedAt: nullableString,
    path: { type: 'string' },
    model: nullableString,
    dims: { type: 'integer', minimum: 1 },
    count: { type: 'integer', minimum: 0 },
    bytes: { type: 'integer', minimum: 0 },
    ...quantizationProperties
  },
  additionalProperties: true
};

export const DENSE_VECTOR_ARTIFACT_SCHEMA_DEFS = {
  dense_vectors: denseVectorsSchema,
  dense_vectors_doc: denseVectorsSchema,
  dense_vectors_code: denseVectorsSchema,
  dense_vectors_binary_meta: denseVectorsBinaryMetaSchema,
  dense_vectors_doc_binary_meta: denseVectorsBinaryMetaSchema,
  dense_vectors_code_binary_meta: denseVectorsBinaryMetaSchema,
  dense_vectors_hnsw_meta: denseVectorsHnswMetaSchema,
  dense_vectors_doc_hnsw_meta: denseVectorsHnswMetaSchema,
  dense_vectors_code_hnsw_meta: denseVectorsHnswMetaSchema,
  dense_vectors_lancedb_meta: denseVectorsLanceDbMetaSchema,
  dense_vectors_doc_lancedb_meta: denseVectorsLanceDbMetaSchema,
  dense_vectors_code_lancedb_meta: denseVectorsLanceDbMetaSchema,
  dense_vectors_sqlite_vec_meta: denseVectorsSqliteVecMetaSchema
};
