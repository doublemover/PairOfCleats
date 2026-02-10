import fsSync from 'node:fs';
import { createLruCache } from '../shared/cache.js';
import { incCacheEviction, setCacheSize } from '../shared/metrics.js';

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

  const get = (dbPath) => {
    const entry = cacheHandle.get(dbPath);
    if (!entry) return null;
    const signature = fileSignature(dbPath);
    if (!signature || signature !== entry.signature) {
      cacheHandle.delete(dbPath);
      return null;
    }
    return entry.db || null;
  };

  const set = (dbPath, db) => {
    const signature = fileSignature(dbPath);
    cacheHandle.set(dbPath, { db, signature });
  };

  const close = (dbPath) => {
    const entry = cacheHandle.get(dbPath);
    if (!entry) return;
    cacheHandle.delete(dbPath);
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
