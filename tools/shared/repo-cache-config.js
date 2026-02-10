import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { LRUCache } from 'lru-cache';
import { getRepoCacheRoot, loadUserConfig } from './dict-utils.js';
import { createSqliteDbCache } from '../../src/retrieval/sqlite-cache.js';
import { createIndexCache } from '../../src/retrieval/index-cache.js';
import { incCacheEviction, setCacheSize } from '../../src/shared/metrics.js';
import { defineCachePolicy, resolveCachePolicy } from '../../src/shared/cache/policy.js';

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

export const createRepoCacheManager = ({
  defaultRepo,
  namespace = 'api',
  repoCache = {},
  indexCache = {},
  sqliteCache = {}
} = {}) => {
  const resolvedDefaultRepo = defaultRepo || process.cwd();
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
      buildPointerPath: path.join(repoCacheRoot, 'builds', 'current.json'),
      buildPointerMtimeMs: null
    };
  };

  const refreshBuildPointer = async (entry) => {
    if (!entry?.buildPointerPath) return;
    let stat = null;
    try {
      stat = await fsPromises.stat(entry.buildPointerPath);
    } catch {
      stat = null;
    }
    const nextMtime = stat?.mtimeMs || null;
    if (entry.buildPointerMtimeMs && entry.buildPointerMtimeMs === nextMtime) {
      return;
    }
    entry.buildPointerMtimeMs = nextMtime;
    if (!stat) {
      if (entry.buildId) {
        resetRepoEntry(entry);
      }
      entry.buildId = null;
      return;
    }
    try {
      const raw = await fsPromises.readFile(entry.buildPointerPath, 'utf8');
      const data = JSON.parse(raw) || {};
      const nextBuildId = typeof data.buildId === 'string' ? data.buildId : null;
      const changed = (entry.buildId && !nextBuildId)
        || (entry.buildId && nextBuildId && entry.buildId !== nextBuildId)
        || (!entry.buildId && nextBuildId);
      if (changed) {
        resetRepoEntry(entry);
      }
      entry.buildId = nextBuildId;
    } catch {
      entry.buildId = null;
      entry.buildPointerMtimeMs = null;
    }
  };

  const resolveRepoKey = (repoPath) => repoPath || resolvedDefaultRepo;

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
