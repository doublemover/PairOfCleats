import path from 'node:path';
import { getCacheRoot } from '../cache-roots.js';

const sanitizeSegment = (value, fallback) => {
  const raw = typeof value === 'string' && value.trim() ? value.trim() : fallback;
  if (!raw) return fallback || 'unknown';
  const normalized = raw.replace(/[^a-zA-Z0-9._-]+/g, '_');
  return normalized || fallback || 'unknown';
};

export const resolveEmbeddingsCacheRoot = ({ repoCacheRoot, cacheDirConfig, scope } = {}) => {
  if (cacheDirConfig) return path.resolve(cacheDirConfig);
  const resolvedScope = typeof scope === 'string' ? scope.trim().toLowerCase() : '';
  if (resolvedScope === 'global') {
    return path.join(getCacheRoot(), 'embeddings');
  }
  return path.join(repoCacheRoot || '', 'embeddings');
};

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

export const resolveEmbeddingsCacheModeDir = (baseDir, mode) => {
  const modeKey = sanitizeSegment(mode, 'mode');
  return path.join(baseDir || '', modeKey);
};
