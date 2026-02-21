import path from 'node:path';

/**
 * Resolve the retrieval cache directory with a single fallback policy shared
 * across query-plan and query-result caches.
 *
 * @param {{queryCacheDir?:string|null,metricsDir?:string|null}} input
 * @returns {string|null}
 */
export const resolveRetrievalCacheDir = ({ queryCacheDir, metricsDir }) => (
  queryCacheDir || metricsDir || null
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

