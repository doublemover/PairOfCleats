import { tryRequire } from '../../../shared/optional-deps.js';

const resolveCompressionMode = (rawMode) => {
  const normalized = typeof rawMode === 'string' ? rawMode.trim().toLowerCase() : 'auto';
  if (normalized === 'none') return null;
  if (normalized === 'gzip') return 'gzip';
  const zstdAvailable = tryRequire('@mongodb-js/zstd').ok;
  if (normalized === 'zstd') return zstdAvailable ? 'zstd' : 'gzip';
  if (normalized === 'auto' || !normalized) return zstdAvailable ? 'zstd' : 'gzip';
  return null;
};

export const resolveCompressionConfig = (indexingConfig = {}) => {
  const compressionConfig = indexingConfig.artifactCompression || {};
  const compressionMode = resolveCompressionMode(compressionConfig.mode);
  const compressionEnabled = compressionConfig.enabled === true && compressionMode;
  const compressionKeepRaw = compressionConfig.keepRaw === true;
  const compressionGzipOptions = compressionConfig.gzipOptions
    && typeof compressionConfig.gzipOptions === 'object'
    ? { ...compressionConfig.gzipOptions }
    : null;
  const compressibleArtifacts = new Set([
    'chunk_meta',
    'file_relations',
    'repo_map',
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
    compressionGzipOptions,
    compressibleArtifacts
  };
};
