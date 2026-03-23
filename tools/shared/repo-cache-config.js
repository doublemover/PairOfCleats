import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { LRUCache } from 'lru-cache';
import { getRepoCacheRoot, loadUserConfig, resolveRepoRoot, toRealPathSync } from './dict-utils.js';
import { createSqliteDbCache } from '../../src/retrieval/sqlite-cache.js';
import { createIndexCache } from '../../src/retrieval/index-cache.js';
import { resolveCurrentBuildRoots } from '../../src/shared/indexing/build-pointer.js';
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

export const getRepoCacheGenerationContext = (entry = null) => {
  if (!entry || typeof entry !== 'object') return {};
  return {
    buildId: typeof entry.buildId === 'string' && entry.buildId.trim() ? entry.buildId : null,
    buildRoot: typeof entry.buildRoot === 'string' && entry.buildRoot.trim() ? entry.buildRoot : null,
    activeBuildRoot: typeof entry.activeBuildRoot === 'string' && entry.activeBuildRoot.trim()
      ? entry.activeBuildRoot
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

  const buildGenerationKey = ({ buildId = null, buildRoot = null, activeRoot = null, buildRoots = null } = {}) => {
    const normalizedBuildRoots = buildRoots && typeof buildRoots === 'object'
      ? Object.fromEntries(
        Object.entries(buildRoots)
          .filter(([, value]) => typeof value === 'string' && value.trim())
          .sort(([left], [right]) => left.localeCompare(right))
      )
      : {};
    return JSON.stringify({
      buildId: typeof buildId === 'string' && buildId.trim() ? buildId : null,
      buildRoot: typeof buildRoot === 'string' && buildRoot.trim() ? buildRoot : null,
      activeRoot: typeof activeRoot === 'string' && activeRoot.trim() ? activeRoot : null,
      buildRoots: normalizedBuildRoots
    });
  };

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
      if (entry.buildGenerationKey || entry.buildId || entry.buildRoot || entry.activeBuildRoot) {
        resetRepoEntry(entry);
      }
      entry.buildId = null;
      entry.buildRoot = null;
      entry.activeBuildRoot = null;
      entry.buildGenerationKey = null;
      return;
    }
    try {
      const raw = await fsPromises.readFile(entry.buildPointerPath, 'utf8');
      const data = JSON.parse(raw) || {};
      const currentInfo = resolveCurrentBuildRoots(data, {
        repoCacheRoot: entry.repoCacheRoot,
        buildsRoot: entry.buildsRoot
      });
      const nextBuildId = typeof currentInfo.buildId === 'string' ? currentInfo.buildId : null;
      const nextBuildRoot = typeof currentInfo.buildRoot === 'string' ? currentInfo.buildRoot : null;
      const nextActiveRoot = typeof currentInfo.activeRoot === 'string' ? currentInfo.activeRoot : null;
      const nextGenerationKey = buildGenerationKey({
        buildId: nextBuildId,
        buildRoot: nextBuildRoot,
        activeRoot: nextActiveRoot,
        buildRoots: currentInfo.buildRoots
      });
      const changed = entry.buildGenerationKey !== nextGenerationKey;
      if (changed) {
        resetRepoEntry(entry);
      }
      entry.buildId = nextBuildId;
      entry.buildRoot = nextBuildRoot;
      entry.activeBuildRoot = nextActiveRoot;
      entry.buildGenerationKey = nextGenerationKey;
    } catch {
      resetRepoEntry(entry);
      entry.buildId = null;
      entry.buildRoot = null;
      entry.activeBuildRoot = null;
      entry.buildGenerationKey = null;
    }
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
