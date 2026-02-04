import path from 'node:path';
import { getCacheRoot } from '../cache-roots.js';

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
  if (cacheDirConfig) return path.resolve(cacheDirConfig);
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
  dims
} = {}) => {
  const providerKey = sanitizeSegment(provider, 'provider');
  const modelKey = sanitizeSegment(modelId, 'model');
  const dimsKey = Number.isFinite(Number(dims)) ? `${Math.floor(Number(dims))}d` : 'dims-unknown';
  return path.join(cacheRoot || '', providerKey, modelKey, dimsKey);
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
