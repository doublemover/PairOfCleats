import fs from 'node:fs';
import path from 'node:path';
import { LRUCache } from 'lru-cache';
import { createSqliteDbCache } from '../retrieval/sqlite-cache.js';
import { createIndexCache } from '../retrieval/index-cache.js';
import { defineCachePolicy, resolveCachePolicy } from './cache/policy.js';
import { loadUserConfig, getRepoCacheRoot, resolveRepoRoot, toRealPathSync } from './dict-utils.js';
import { readCurrentBuildGeneration } from './indexing/build-pointer.js';
import { incCacheEviction, setCacheSize } from './metrics/core.js';

export const closeRepoCacheEntry = (entry) => {
  entry?.indexCache?.clear?.();
  entry?.sqliteCache?.closeAll?.();
};

export const REPO_CACHE_POLICY_DEFAULTS = Object.freeze({
  maxEntries: 5,
  maxBytes: null,
  ttlMs: 15 * 60 * 1000,
  invalidationTrigger: ['build-pointer-change', 'lru-eviction']
});

export const INDEX_CACHE_POLICY_DEFAULTS = Object.freeze({
  maxEntries: 4,
  maxBytes: null,
  ttlMs: 15 * 60 * 1000,
  invalidationTrigger: 'repo-cache-reset'
});

export const SQLITE_CACHE_POLICY_DEFAULTS = Object.freeze({
  maxEntries: 4,
  maxBytes: null,
  ttlMs: 15 * 60 * 1000,
  invalidationTrigger: 'repo-cache-reset'
});

export const createRepoCachePolicyDefaults = ({
  namespace = 'api',
  shutdown = closeRepoCacheEntry
} = {}) => ({
  repo: defineCachePolicy({
    name: `${namespace}.repo`,
    ...REPO_CACHE_POLICY_DEFAULTS,
    shutdown
  }),
  index: defineCachePolicy({
    name: `${namespace}.index`,
    ...INDEX_CACHE_POLICY_DEFAULTS,
    shutdown: () => {}
  }),
  sqlite: defineCachePolicy({
    name: `${namespace}.sqlite`,
    ...SQLITE_CACHE_POLICY_DEFAULTS,
    shutdown: () => {}
  })
});

export const normalizeCacheConfig = (value, defaults) => {
  const policy = resolveCachePolicy(value, defaults);
  return {
    maxEntries: policy.maxEntries,
    maxBytes: policy.maxBytes,
    ttlMs: policy.ttlMs,
    invalidationTrigger: policy.invalidationTrigger,
    invalidationTriggers: policy.invalidationTriggers,
    shutdown: policy.shutdown
  };
};

export const getRepoCacheGenerationContext = (entry = null) => {
  if (!entry || typeof entry !== 'object') return {};
  return {
    buildId: typeof entry.buildId === 'string' && entry.buildId.trim() ? entry.buildId : null,
    buildRoot: typeof entry.buildRoot === 'string' && entry.buildRoot.trim() ? entry.buildRoot : null,
    activeBuildRoot: typeof entry.activeBuildRoot === 'string' && entry.activeBuildRoot.trim()
      ? entry.activeBuildRoot
      : null,
    buildGenerationKey: typeof entry.buildGenerationKey === 'string' && entry.buildGenerationKey.trim()
      ? entry.buildGenerationKey
      : null
  };
};

const hasRepoArtifacts = (repoPath) => {
  try {
    const userConfig = loadUserConfig(repoPath);
    const repoCacheRoot = getRepoCacheRoot(repoPath, userConfig);
    const buildsRoot = path.join(repoCacheRoot, 'builds');
    if (typeof repoCacheRoot !== 'string' || !repoCacheRoot.trim()) return false;
    if (fs.existsSync(path.join(buildsRoot, 'current.json'))) return true;
    for (const mode of ['code', 'prose', 'extracted-prose', 'records']) {
      try {
        if (fs.statSync(path.join(repoCacheRoot, `index-${mode}`)).isDirectory()) {
          return true;
        }
      } catch {}
    }
    return false;
  } catch {
    return false;
  }
};

export const createRepoCacheManager = ({
  defaultRepo,
  namespace = 'api',
  repoCache = {},
  indexCache = {},
  sqliteCache = {}
} = {}) => {
  const resolvedDefaultRepo = toRealPathSync(resolveRepoRoot(defaultRepo || process.cwd()));
  const defaults = createRepoCachePolicyDefaults({ namespace });

  const repoPolicy = resolveCachePolicy(repoCache, defaults.repo);
  const indexPolicy = resolveCachePolicy(indexCache, defaults.index);
  const sqlitePolicy = resolveCachePolicy(sqliteCache, defaults.sqlite);

  const repoCacheConfig = normalizeCacheConfig(repoPolicy, defaults.repo);
  const indexCacheConfig = normalizeCacheConfig(indexPolicy, defaults.index);
  const sqliteCacheConfig = normalizeCacheConfig(sqlitePolicy, defaults.sqlite);

  const resetRepoEntry = (entry) => {
    try {
      repoCacheConfig.shutdown(entry);
    } catch {}
  };

  const repoCaches = new LRUCache({
    max: repoCacheConfig.maxEntries,
    ttl: repoCacheConfig.ttlMs > 0 ? repoCacheConfig.ttlMs : undefined,
    allowStale: false,
    updateAgeOnGet: true,
    dispose: (entry, _key, reason) => {
      resetRepoEntry(entry);
      if (reason === 'evict' || reason === 'expire') {
        incCacheEviction({ cache: 'repo' });
      }
      setCacheSize({ cache: 'repo', value: repoCaches.size });
    }
  });

  const buildRepoCacheEntry = (repoPath) => {
    const userConfig = loadUserConfig(repoPath);
    const repoCacheRoot = getRepoCacheRoot(repoPath, userConfig);
    const buildsRoot = path.join(repoCacheRoot, 'builds');
    return {
      indexCache: createIndexCache({
        maxEntries: indexCacheConfig.maxEntries,
        ttlMs: indexCacheConfig.ttlMs
      }),
      sqliteCache: createSqliteDbCache({
        maxEntries: sqliteCacheConfig.maxEntries,
        ttlMs: sqliteCacheConfig.ttlMs
      }),
      lastUsed: Date.now(),
      buildId: null,
      buildRoot: null,
      activeBuildRoot: null,
      buildGenerationKey: null,
      repoCacheRoot,
      buildsRoot,
      buildPointerPath: path.join(buildsRoot, 'current.json'),
      buildPointerMtimeMs: null
    };
  };

  const refreshBuildPointer = async (entry) => {
    if (!entry?.buildPointerPath) return;
    const nextPointerState = readCurrentBuildGeneration({
      currentJsonPath: entry.buildPointerPath,
      repoCacheRoot: entry.repoCacheRoot,
      buildsRoot: entry.buildsRoot
    });
    entry.buildPointerMtimeMs = nextPointerState.currentJsonMtimeMs;
    if (!nextPointerState.currentJsonExists) {
      if (entry.buildGenerationKey || entry.buildId || entry.buildRoot || entry.activeBuildRoot) {
        resetRepoEntry(entry);
      }
      entry.buildId = null;
      entry.buildRoot = null;
      entry.activeBuildRoot = null;
      entry.buildGenerationKey = null;
      return;
    }
    if (!nextPointerState.parseOk) {
      resetRepoEntry(entry);
      entry.buildId = null;
      entry.buildRoot = null;
      entry.activeBuildRoot = null;
      entry.buildGenerationKey = null;
      return;
    }
    const changed = entry.buildGenerationKey !== nextPointerState.generationKey;
    if (changed) {
      resetRepoEntry(entry);
    }
    entry.buildId = nextPointerState.buildId;
    entry.buildRoot = nextPointerState.buildRoot;
    entry.activeBuildRoot = nextPointerState.activeRoot;
    entry.buildGenerationKey = nextPointerState.generationKey;
  };

  const resolveRepoKey = (repoPath) => {
    const candidate = path.resolve(repoPath || resolvedDefaultRepo);
    const resolvedRoot = toRealPathSync(resolveRepoRoot(candidate));
    const explicitPath = toRealPathSync(candidate);
    if (explicitPath === resolvedRoot) return resolvedRoot;
    if (hasRepoArtifacts(explicitPath)) return explicitPath;
    return resolvedRoot;
  };

  const getRepoCaches = (repoPath) => {
    const key = resolveRepoKey(repoPath);
    let entry = repoCaches.get(key);
    if (entry) {
      entry.lastUsed = Date.now();
    } else {
      entry = buildRepoCacheEntry(key);
      repoCaches.set(key, entry);
      setCacheSize({ cache: 'repo', value: repoCaches.size });
    }
    return entry;
  };

  const refreshRepoCaches = async (repoPath) => {
    if (!repoPath) return;
    const entry = repoCaches.get(resolveRepoKey(repoPath));
    if (!entry) return;
    await refreshBuildPointer(entry);
  };

  const clearRepoCaches = (repoPath) => {
    if (!repoPath) return;
    repoCaches.delete(resolveRepoKey(repoPath));
    setCacheSize({ cache: 'repo', value: repoCaches.size });
  };

  const closeRepoCaches = () => {
    repoCaches.clear();
    setCacheSize({ cache: 'repo', value: repoCaches.size });
  };

  return {
    getRepoCaches,
    refreshBuildPointer,
    refreshRepoCaches,
    clearRepoCaches,
    closeRepoCaches,
    repoCacheConfig,
    indexCacheConfig,
    sqliteCacheConfig
  };
};
