import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { LRUCache } from 'lru-cache';
import { getRepoCacheRoot, loadUserConfig } from '../../shared/dict-utils.js';
import { createSqliteDbCache } from '../../../src/retrieval/sqlite-cache.js';
import { createIndexCache } from '../../../src/retrieval/index-cache.js';
import { incCacheEviction, setCacheSize } from '../../../src/shared/metrics.js';
import { defineCachePolicy, resolveCachePolicy } from '../../../src/shared/cache/policy.js';

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

const closeRepoCacheEntry = (entry) => {
  entry?.indexCache?.clear?.();
  entry?.sqliteCache?.closeAll?.();
};

const REPO_CACHE_POLICY_DEFAULTS = defineCachePolicy({
  name: 'api.repo',
  maxEntries: 5,
  maxBytes: null,
  ttlMs: 15 * 60 * 1000,
  invalidationTrigger: ['build-pointer-change', 'lru-eviction'],
  shutdown: closeRepoCacheEntry
});

const INDEX_CACHE_POLICY_DEFAULTS = defineCachePolicy({
  name: 'api.index',
  maxEntries: 4,
  maxBytes: null,
  ttlMs: 15 * 60 * 1000,
  invalidationTrigger: 'repo-cache-reset',
  shutdown: () => {}
});

const SQLITE_CACHE_POLICY_DEFAULTS = defineCachePolicy({
  name: 'api.sqlite',
  maxEntries: 4,
  maxBytes: null,
  ttlMs: 15 * 60 * 1000,
  invalidationTrigger: 'repo-cache-reset',
  shutdown: () => {}
});

export const createRepoCacheManager = ({
  defaultRepo,
  repoCache = {},
  indexCache = {},
  sqliteCache = {}
}) => {
  const repoCachePolicy = resolveCachePolicy(repoCache, REPO_CACHE_POLICY_DEFAULTS);
  const indexCachePolicy = resolveCachePolicy(indexCache, INDEX_CACHE_POLICY_DEFAULTS);
  const sqliteCachePolicy = resolveCachePolicy(sqliteCache, SQLITE_CACHE_POLICY_DEFAULTS);
  const repoCacheConfig = normalizeCacheConfig(repoCachePolicy, REPO_CACHE_POLICY_DEFAULTS);
  const indexCacheConfig = normalizeCacheConfig(indexCachePolicy, INDEX_CACHE_POLICY_DEFAULTS);
  const sqliteCacheConfig = normalizeCacheConfig(sqliteCachePolicy, SQLITE_CACHE_POLICY_DEFAULTS);
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

  const getRepoCaches = (repoPath) => {
    const key = repoPath || defaultRepo;
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

  const closeRepoCaches = () => {
    repoCaches.clear();
    setCacheSize({ cache: 'repo', value: repoCaches.size });
  };

  return { getRepoCaches, closeRepoCaches, refreshBuildPointer };
};
