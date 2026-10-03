import {
  createUnavailableFileMeta,
  hasFileMetaIdentity,
  normalizeFileMeta
} from '../../file-meta.js';
import { toUniqueRepoPosixFiles } from '../../paths.js';

export { createUnavailableFileMeta, normalizeFileMeta } from '../../file-meta.js';

export const toUniquePosixFiles = (filesPosix = [], repoRoot = null) => toUniqueRepoPosixFiles(filesPosix, {
  repoRoot,
  rejectEscape: Boolean(repoRoot)
});

let gitMetaPrefetchCache = new Map();
let gitMetaPrefetchInFlight = new Map();

const pruneGitMetaPrefetchCache = (config) => {
  if (!config || config.prefetchCacheMaxEntries <= 0) {
    gitMetaPrefetchCache.clear();
    gitMetaPrefetchInFlight.clear();
    return;
  }
  const ttlMs = Number.isFinite(Number(config.prefetchCacheTtlMs)) && Number(config.prefetchCacheTtlMs) > 0
    ? Math.floor(Number(config.prefetchCacheTtlMs))
    : 0;
  if (ttlMs > 0) {
    const now = Date.now();
    for (const [key, entry] of gitMetaPrefetchCache) {
      const updatedAt = Number(entry?.updatedAt) || 0;
      if (updatedAt > 0 && now - updatedAt <= ttlMs) continue;
      gitMetaPrefetchCache.delete(key);
      gitMetaPrefetchInFlight.delete(key);
    }
  }
  while (gitMetaPrefetchCache.size > config.prefetchCacheMaxEntries) {
    const oldestKey = gitMetaPrefetchCache.keys().next()?.value;
    if (!oldestKey) break;
    gitMetaPrefetchCache.delete(oldestKey);
    gitMetaPrefetchInFlight.delete(oldestKey);
  }
};

export const getGitMetaPrefetchEntry = (freshnessGuard, config) => {
  const key = freshnessGuard?.key || null;
  if (!key) return null;
  pruneGitMetaPrefetchCache(config);
  const entry = gitMetaPrefetchCache.get(key);
  if (!entry) return null;
  entry.updatedAt = Date.now();
  gitMetaPrefetchCache.delete(key);
  gitMetaPrefetchCache.set(key, entry);
  return entry;
};

export const createGitMetaPrefetchEntry = (freshnessGuard) => ({
  key: freshnessGuard?.key || null,
  guard: freshnessGuard ? { ...freshnessGuard } : null,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  fileMetaByPath: Object.create(null),
  knownFiles: new Set()
});

export const setGitMetaPrefetchEntry = (freshnessGuard, entry, config) => {
  const key = freshnessGuard?.key || null;
  if (!key || !entry || config.prefetchCacheMaxEntries <= 0) return;
  entry.updatedAt = Date.now();
  gitMetaPrefetchCache.set(key, entry);
  pruneGitMetaPrefetchCache(config);
};

export const runGitMetaPrefetchTask = async (freshnessGuard, task) => {
  const key = freshnessGuard?.key || null;
  if (!key) return task();
  const inFlight = gitMetaPrefetchInFlight.get(key);
  if (inFlight) return inFlight;
  const promise = (async () => {
    try {
      return await task();
    } finally {
      gitMetaPrefetchInFlight.delete(key);
    }
  })();
  gitMetaPrefetchInFlight.set(key, promise);
  return promise;
};

export const mergeGitMetaPrefetchEntry = ({ entry, filesPosix, fileMetaByPath }) => {
  if (!entry) return;
  for (const filePosix of Array.isArray(filesPosix) ? filesPosix : []) {
    const normalized = toPosix(filePosix);
    if (!normalized) continue;
    const meta = fileMetaByPath && typeof fileMetaByPath === 'object' && fileMetaByPath[normalized]
      ? normalizeFileMeta(fileMetaByPath[normalized])
      : createUnavailableFileMeta();
    entry.fileMetaByPath[normalized] = meta;
    entry.knownFiles.add(normalized);
  }
  entry.updatedAt = Date.now();
};

export const upsertGitMetaPrefetch = ({ freshnessGuard, config, filesPosix, fileMetaByPath }) => {
  const key = freshnessGuard?.key || null;
  if (!key || config.prefetchCacheMaxEntries <= 0) return null;
  const entry = getGitMetaPrefetchEntry(freshnessGuard, config) || createGitMetaPrefetchEntry(freshnessGuard);
  mergeGitMetaPrefetchEntry({ entry, filesPosix, fileMetaByPath });
  setGitMetaPrefetchEntry(freshnessGuard, entry, config);
  return entry;
};

export const readGitMetaPrefetchValue = ({ freshnessGuard, config, filePosix }) => {
  const entry = getGitMetaPrefetchEntry(freshnessGuard, config);
  if (!entry?.knownFiles?.has(filePosix)) return null;
  const meta = normalizeFileMeta(entry.fileMetaByPath[filePosix] || null);
  return hasFileMetaIdentity(meta)
    ? meta
    : { ok: false, reason: 'unavailable' };
};

export const buildGitMetaBatchResponseFromEntry = ({ entry, filesPosix, diagnostics = null }) => {
  const fileMetaByPath = Object.create(null);
  for (const filePosix of filesPosix) {
    const cached = entry?.fileMetaByPath?.[filePosix];
    fileMetaByPath[filePosix] = cached
      ? normalizeFileMeta(cached)
      : createUnavailableFileMeta();
  }
  return diagnostics
    ? { fileMetaByPath, diagnostics }
    : { fileMetaByPath };
};
