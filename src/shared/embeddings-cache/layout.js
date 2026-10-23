import path from 'node:path';
import { getCacheRoot, resolveVersionedCacheRoot } from '../cache-roots.js';
import { buildEmbeddingIdentityKey } from '../embedding-identity.js';

const sanitizeSegment = (value, fallback) => {
  const raw = typeof value === 'string' && value.trim() ? value.trim() : fallback;
  if (!raw) return fallback || 'unknown';
  const normalized = raw.replace(/[^a-zA-Z0-9._-]+/g, '_');
  return normalized || fallback || 'unknown';
};

/**
 * Resolve the embeddings cache root directory.
 * @param {{repoCacheRoot?:string,cacheDirConfig?:string,scope?:string}} [options]
 * @returns {string}
 */
export const resolveEmbeddingsCacheRoot = ({ repoCacheRoot, cacheDirConfig, scope } = {}) => {
  if (cacheDirConfig) return resolveVersionedCacheRoot(path.resolve(cacheDirConfig));
  const resolvedScope = typeof scope === 'string' ? scope.trim().toLowerCase() : '';
  if (resolvedScope === 'global') {
    return path.join(getCacheRoot(), 'embeddings');
  }
  return path.join(repoCacheRoot || '', 'embeddings');
};

/**
 * Resolve the cache base directory for a provider/model/dims tuple.
 * @param {{cacheRoot?:string,provider?:string,modelId?:string,dims?:number}} [options]
 * @returns {string}
 */
export const resolveEmbeddingsCacheBase = ({
  cacheRoot,
  provider,
  modelId,
  dims,
  identity = null
} = {}) => {
  const providerKey = sanitizeSegment(provider, 'provider');
  const modelKey = sanitizeSegment(modelId, 'model');
  const dimsKey = Number.isFinite(Number(dims)) ? `${Math.floor(Number(dims))}d` : 'dims-unknown';
  const labels = path.join(cacheRoot || '', providerKey, modelKey, dimsKey);
  return identity && typeof identity === 'object'
    ? path.join(labels, 'profiles-v3', buildEmbeddingIdentityKey(identity)) : labels;
};

/** Adoption descriptor for shared storage inventory/migration/lifecycle owners.
 * Legacy bytes are a read-only compatibility tier, never a write destination.
 */
export const resolveEmbeddingCacheProfile = ({ cacheRoot, identity }) => {
  const labels = { cacheRoot, provider: identity?.provider, modelId: identity?.modelId, dims: identity?.dims };
  const legacy = resolveEmbeddingsCacheBase(labels);
  return Object.freeze({ category: 'derived-embedding-cache', layoutVersion: 3,
    identityKey: buildEmbeddingIdentityKey(identity), rebuildable: true,
    canonical: resolveEmbeddingsCacheBase({ ...labels, identity }),
    prior: path.join(legacy, 'profiles-v2', buildEmbeddingIdentityKey(identity)),
    legacy,
    migration: 'identity-validated-read-only-fallback',
    lifecycleOwner: 'existing-embedding-shard-index-and-shared-storage-policy' });
};

/**
 * Resolve the cache directory for a specific mode.
 * @param {string} baseDir
 * @param {string} mode
 * @returns {string}
 */
export const resolveEmbeddingsCacheModeDir = (baseDir, mode) => {
  const modeKey = sanitizeSegment(mode, 'mode');
  return path.join(baseDir || '', modeKey);
};
