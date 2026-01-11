export const resolveCompressionConfig = (indexingConfig = {}) => {
  const compressionConfig = indexingConfig.artifactCompression || {};
  const compressionMode = compressionConfig.mode === 'gzip' ? 'gzip' : null;
  const compressionEnabled = compressionConfig.enabled === true && compressionMode;
  const compressionKeepRaw = compressionConfig.keepRaw === true;
  const compressibleArtifacts = new Set([
    'dense_vectors_uint8',
    'dense_vectors_doc_uint8',
    'dense_vectors_code_uint8',
    'minhash_signatures',
    'token_postings',
    'field_postings',
    'field_tokens',
    'phrase_ngrams',
    'chargram_postings'
  ]);
  return {
    compressionEnabled,
    compressionMode,
    compressionKeepRaw,
    compressibleArtifacts
  };
};
