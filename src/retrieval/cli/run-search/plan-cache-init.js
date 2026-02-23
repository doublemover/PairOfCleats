/**
 * Resolve query-plan cache instance for run-search.
 *
 * If an in-memory cache is already provided, it is reused. Otherwise this
 * resolves disk path policy, creates the disk cache, and eagerly loads it.
 *
 * @param {object} input
 * @returns {object|null}
 */
export const resolveRunSearchPlanCache = (input) => {
  const {
    queryPlanCache = null,
    queryCacheDir,
    metricsDir,
    resolveRetrievalCachePath,
    createQueryPlanDiskCache
  } = input;

  if (queryPlanCache) {
    return queryPlanCache;
  }

  const queryPlanCachePath = resolveRetrievalCachePath({
    queryCacheDir,
    metricsDir,
    fileName: 'queryPlanCache.json'
  });
  if (!queryPlanCachePath) {
    return null;
  }

  const nextQueryPlanCache = createQueryPlanDiskCache({ path: queryPlanCachePath });
  if (typeof nextQueryPlanCache?.load === 'function') {
    nextQueryPlanCache.load();
  }
  return nextQueryPlanCache;
};
