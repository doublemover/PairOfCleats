import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { LRUCache } from 'lru-cache';
import { getRepoCacheRoot, loadUserConfig } from '../../shared/dict-utils.js';
import { createSqliteDbCache } from '../../../src/retrieval/sqlite-cache.js';
import { createIndexCache } from '../../../src/retrieval/index-cache.js';
import { incCacheEviction, setCacheSize } from '../../../src/shared/metrics.js';

export const normalizeCacheConfig = (value, defaults) => {
  const maxEntries = Number.isFinite(Number(value?.maxEntries))
    ? Math.max(0, Math.floor(Number(value.maxEntries)))
    : defaults.maxEntries;
  const ttlMs = Number.isFinite(Number(value?.ttlMs))
    ? Math.max(0, Number(value.ttlMs))
    : defaults.ttlMs;
  return { maxEntries, ttlMs };
};

export const createRepoCacheManager = ({
  defaultRepo,
  repoCache = {},
  indexCache = {},
  sqliteCache = {}
}) => {
  const repoCacheConfig = normalizeCacheConfig(repoCache, { maxEntries: 5, ttlMs: 15 * 60 * 1000 });
  const indexCacheConfig = normalizeCacheConfig(indexCache, { maxEntries: 4, ttlMs: 15 * 60 * 1000 });
  const sqliteCacheConfig = normalizeCacheConfig(sqliteCache, { maxEntries: 4, ttlMs: 15 * 60 * 1000 });
  const repoCaches = new LRUCache({
    max: repoCacheConfig.maxEntries,
    ttl: repoCacheConfig.ttlMs > 0 ? repoCacheConfig.ttlMs : undefined,
    allowStale: false,
    updateAgeOnGet: true,
    dispose: (entry, _key, reason) => {
      try {
        entry?.indexCache?.clear?.();
        entry?.sqliteCache?.closeAll?.();
      } catch {}
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
      indexCache: createIndexCache(indexCacheConfig),
      sqliteCache: createSqliteDbCache(sqliteCacheConfig),
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
        entry.indexCache?.clear?.();
        entry.sqliteCache?.closeAll?.();
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
        entry.indexCache?.clear?.();
        entry.sqliteCache?.closeAll?.();
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
