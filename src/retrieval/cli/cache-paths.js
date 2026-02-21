import path from 'node:path';
import { getCacheRoot } from '../../shared/cache-roots.js';

const normalizeDir = (value) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return path.resolve(trimmed);
};

/**
 * Resolve the retrieval cache directory with a single fallback policy shared
 * across query-plan and query-result caches.
 *
 * @param {{queryCacheDir?:string|null,metricsDir?:string|null}} input
 * @returns {string|null}
 */
export const resolveRetrievalCacheDir = ({ queryCacheDir, metricsDir }) => (
  normalizeDir(queryCacheDir)
  || normalizeDir(metricsDir)
  || (() => {
    const cacheRoot = normalizeDir(getCacheRoot());
    return cacheRoot ? path.join(cacheRoot, 'metrics') : null;
  })()
);

/**
 * Resolve a named retrieval cache file path.
 *
 * @param {{queryCacheDir?:string|null,metricsDir?:string|null,fileName:string}} input
 * @returns {string|null}
 */
export const resolveRetrievalCachePath = ({ queryCacheDir, metricsDir, fileName }) => {
  const cacheDir = resolveRetrievalCacheDir({ queryCacheDir, metricsDir });
  if (!cacheDir) return null;
  return path.join(cacheDir, fileName);
};
