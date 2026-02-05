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
    'chunk_uid_map',
    'vfs_manifest',
    'file_relations',
    'call_sites',
    'risk_summaries',
    'risk_flows',
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
  const overrides = {};
  if (compressionConfig.perArtifact && typeof compressionConfig.perArtifact === 'object') {
    for (const [name, value] of Object.entries(compressionConfig.perArtifact)) {
      if (!name || !value || typeof value !== 'object') continue;
      const overrideMode = resolveCompressionMode(value.mode || compressionMode);
      const overrideEnabled = typeof value.enabled === 'boolean'
        ? value.enabled && overrideMode
        : (compressionEnabled && overrideMode);
      overrides[name] = {
        enabled: Boolean(overrideEnabled),
        mode: overrideMode,
        keepRaw: typeof value.keepRaw === 'boolean' ? value.keepRaw : compressionKeepRaw
      };
    }
  }
  return {
    compressionEnabled,
    compressionMode,
    compressionKeepRaw,
    compressionGzipOptions,
    compressibleArtifacts,
    compressionOverrides: overrides
  };
};
