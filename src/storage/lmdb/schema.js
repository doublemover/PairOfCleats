export const LMDB_SCHEMA_VERSION = 1;

export const LMDB_META_KEYS = {
  schemaVersion: 'meta:schemaVersion',
  createdAt: 'meta:createdAt',
  mode: 'meta:mode',
  artifacts: 'meta:artifacts',
  chunkCount: 'meta:chunkCount',
  sourceIndex: 'meta:sourceIndex'
};

export const LMDB_ARTIFACT_KEYS = {
  chunkMeta: 'artifact:chunk_meta',
  tokenPostings: 'artifact:token_postings',
  fileMeta: 'artifact:file_meta',
  fileRelations: 'artifact:file_relations',
  repoMap: 'artifact:repo_map',
  filterIndex: 'artifact:filter_index',
  fieldPostings: 'artifact:field_postings',
  fieldTokens: 'artifact:field_tokens',
  phraseNgrams: 'artifact:phrase_ngrams',
  chargramPostings: 'artifact:chargram_postings',
  minhashSignatures: 'artifact:minhash_signatures',
  denseVectors: 'artifact:dense_vectors_uint8',
  denseVectorsDoc: 'artifact:dense_vectors_doc_uint8',
  denseVectorsCode: 'artifact:dense_vectors_code_uint8',
  denseHnswMeta: 'artifact:dense_vectors_hnsw_meta',
  indexState: 'artifact:index_state'
};

export const LMDB_ARTIFACT_LIST = Object.values(LMDB_ARTIFACT_KEYS);
