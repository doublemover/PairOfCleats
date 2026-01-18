export const LMDB_SCHEMA_VERSION = 1;

// LMDB invariants:
// - meta:schemaVersion must match LMDB_SCHEMA_VERSION.
// - meta:mode must match the index mode (code/prose).
// - meta:artifacts lists stored artifact keys.
// - artifact:chunk_meta and artifact:token_postings are required for a usable store.
export const LMDB_META_KEYS = {
  schemaVersion: 'meta:schemaVersion',
  createdAt: 'meta:createdAt',
  mode: 'meta:mode',
  artifacts: 'meta:artifacts',
  artifactManifest: 'meta:artifactManifest',
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
export const LMDB_REQUIRED_ARTIFACT_KEYS = [
  LMDB_ARTIFACT_KEYS.chunkMeta,
  LMDB_ARTIFACT_KEYS.tokenPostings
];
export const LMDB_OPTIONAL_ARTIFACT_KEYS = LMDB_ARTIFACT_LIST.filter(
  (key) => !LMDB_REQUIRED_ARTIFACT_KEYS.includes(key)
);

export const getExpectedLmdbArtifactKeys = () => ({
  required: [...LMDB_REQUIRED_ARTIFACT_KEYS],
  optional: [...LMDB_OPTIONAL_ARTIFACT_KEYS]
});
