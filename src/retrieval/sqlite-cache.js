import fsSync from 'node:fs';
import { LRUCache } from 'lru-cache';
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
  const resolvedMax = Number.isFinite(Number(maxEntries)) ? Math.floor(Number(maxEntries)) : DEFAULT_SQLITE_CACHE_MAX_ENTRIES;
  const resolvedTtlMs = Number.isFinite(Number(ttlMs)) ? Math.max(0, Number(ttlMs)) : DEFAULT_SQLITE_CACHE_TTL_MS;
  if (!resolvedMax || resolvedMax <= 0) {
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
  const entries = new LRUCache({
    max: resolvedMax,
    ttl: resolvedTtlMs > 0 ? resolvedTtlMs : undefined,
    allowStale: false,
    updateAgeOnGet: true,
    dispose: (entry, key, reason) => {
      try {
        entry?.db?.close?.();
      } catch {}
      if (typeof onEvict === 'function') {
        onEvict({ key, entry, reason });
      }
      if (reason === 'evict' || reason === 'expire') {
        incCacheEviction({ cache: 'sqlite' });
      }
      setCacheSize({ cache: 'sqlite', value: entries.size });
    }
  });

  const get = (dbPath) => {
    const entry = entries.get(dbPath);
    if (!entry) return null;
    const signature = fileSignature(dbPath);
    if (!signature || signature !== entry.signature) {
      entries.delete(dbPath);
      return null;
    }
    return entry.db || null;
  };

  const set = (dbPath, db) => {
    const signature = fileSignature(dbPath);
    entries.set(dbPath, { db, signature });
    setCacheSize({ cache: 'sqlite', value: entries.size });
  };

  const close = (dbPath) => {
    const entry = entries.get(dbPath);
    if (!entry) return;
    entries.delete(dbPath);
    setCacheSize({ cache: 'sqlite', value: entries.size });
  };

  const closeAll = () => {
    entries.clear();
    setCacheSize({ cache: 'sqlite', value: entries.size });
  };

  return {
    get,
    set,
    close,
    closeAll,
    size: () => entries.size
  };
}
