import path from 'node:path';

export const CACHE_LAYER_SURFACES = Object.freeze({
  global: Object.freeze(['models', 'tooling', 'dictionaries']),
  repo: Object.freeze(['builds', 'sqlite', 'lmdb', 'embeddings', 'query-cache', 'incremental']),
  workspace: Object.freeze(['workspace_manifest', 'federated_query_cache'])
});

export const DEFAULT_CACHE_GC_POLICY = Object.freeze({
  enabled: false,
  graceDays: 7,
  maxDeletesPerRun: 5000,
  concurrentDeletes: 4
});

export const DEFAULT_CAS_DESIGN_GATE = Object.freeze({
  leaseModel: true,
  markAndSweepReachability: true,
  concurrentDeletionSafety: true,
  interruptedGcRecovery: true
});

export function describeCacheLayers({
  cacheRoot = null,
  repoCacheRoot = null,
  federationCacheRoot = null
} = {}) {
  const resolvedCacheRoot = cacheRoot ? path.resolve(cacheRoot) : null;
  const resolvedRepoCacheRoot = repoCacheRoot ? path.resolve(repoCacheRoot) : null;
  const resolvedWorkspaceRoot = federationCacheRoot
    ? path.resolve(federationCacheRoot)
    : (resolvedCacheRoot ? path.join(resolvedCacheRoot, 'federation') : null);
  return {
    global: {
      root: resolvedCacheRoot,
      surfaces: [...CACHE_LAYER_SURFACES.global]
    },
    repo: {
      root: resolvedRepoCacheRoot,
      surfaces: [...CACHE_LAYER_SURFACES.repo]
    },
    workspace: {
      root: resolvedWorkspaceRoot,
      surfaces: [...CACHE_LAYER_SURFACES.workspace]
    }
  };
}
