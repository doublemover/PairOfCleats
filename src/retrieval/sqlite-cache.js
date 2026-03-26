import fsSync from 'node:fs';
import { createLruCache } from '../shared/cache/lru.js';
import { incCacheEviction, setCacheSize } from '../shared/metrics/core.js';
import { stableStringifyForSignature } from '../shared/stable-json.js';

const DEFAULT_SQLITE_CACHE_MAX_ENTRIES = 4;
const DEFAULT_SQLITE_CACHE_TTL_MS = 15 * 60 * 1000;

const fileSignature = (filePath) => {
  try {
    const stat = fsSync.statSync(filePath);
    return `${stat.size}:${stat.mtimeMs}`;
  } catch {
    return null;
  }
};

const normalizeGenerationTag = (generationTag = null) => {
  if (generationTag == null) return null;
  if (typeof generationTag === 'string') {
    const trimmed = generationTag.trim();
    return trimmed || null;
  }
  return stableStringifyForSignature(generationTag);
};

const buildCacheKey = (dbPath, generationTag = null) => (
  `${dbPath}|generation:${normalizeGenerationTag(generationTag) || 'default'}`
);

const isEntryForPath = (entry, dbPath) => entry?.dbPath === dbPath;

export function createSqliteDbCache({
  maxEntries = DEFAULT_SQLITE_CACHE_MAX_ENTRIES,
  ttlMs = DEFAULT_SQLITE_CACHE_TTL_MS,
  onEvict = null
} = {}) {
  const cacheHandle = createLruCache({
    name: 'sqlite',
    maxEntries,
    ttlMs,
    onEvict: ({ key, value, reason }) => {
      try {
        value?.db?.close?.();
      } catch {}
      if (typeof onEvict === 'function') {
        onEvict({ key, entry: value, reason });
      }
      if (reason === 'evict' || reason === 'expire') {
        incCacheEviction({ cache: 'sqlite' });
      }
      setCacheSize({ cache: 'sqlite', value: cacheHandle.size() });
    },
    onSizeChange: (size) => {
      setCacheSize({ cache: 'sqlite', value: size });
    }
  });
  if (!cacheHandle.cache) {
    return {
      get() {
        return null;
      },
      set() {},
      close() {},
      closeAll() {},
      size: () => 0
    };
  }

  const get = (dbPath, options = {}) => {
    const cacheKey = buildCacheKey(dbPath, options.generationTag);
    const entry = cacheHandle.get(cacheKey);
    if (!entry) return null;
    const signature = fileSignature(dbPath);
    if (!signature || signature !== entry.signature) {
      cacheHandle.delete(cacheKey);
      return null;
    }
    return entry.db || null;
  };

  const set = (dbPath, db, options = {}) => {
    const normalizedGenerationTag = normalizeGenerationTag(options.generationTag);
    const cacheKey = buildCacheKey(dbPath, normalizedGenerationTag);
    const signature = fileSignature(dbPath);
    for (const [existingKey, existingEntry] of cacheHandle.cache.entries()) {
      if (!isEntryForPath(existingEntry, dbPath) || existingKey === cacheKey) continue;
      cacheHandle.delete(existingKey);
    }
    cacheHandle.set(cacheKey, {
      db,
      dbPath,
      generationTag: normalizedGenerationTag,
      signature
    });
  };

  const close = (dbPath, options = {}) => {
    const normalizedGenerationTag = normalizeGenerationTag(options.generationTag);
    if (normalizedGenerationTag) {
      const cacheKey = buildCacheKey(dbPath, normalizedGenerationTag);
      if (cacheHandle.get(cacheKey)) {
        cacheHandle.delete(cacheKey);
      }
      return;
    }
    for (const [existingKey, existingEntry] of cacheHandle.cache.entries()) {
      if (!isEntryForPath(existingEntry, dbPath)) continue;
      cacheHandle.delete(existingKey);
    }
  };

  const closeAll = () => {
    cacheHandle.clear();
  };

  return {
    get,
    set,
    close,
    closeAll,
    size: cacheHandle.size
  };
}
