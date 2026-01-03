import { LRUCache } from 'lru-cache';

const BYTES_PER_MB = 1024 * 1024;

export const DEFAULT_CACHE_MB = {
  fileText: 64,
  summary: 32,
  lint: 16,
  complexity: 16,
  gitMeta: 16
};

export const DEFAULT_CACHE_TTL_MS = {
  fileText: 0,
  summary: 0,
  lint: 0,
  complexity: 0,
  gitMeta: 0
};

export const mbToBytes = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.floor(parsed * BYTES_PER_MB));
};

export const estimateStringBytes = (value) => {
  if (typeof value !== 'string') return 0;
  return Buffer.byteLength(value, 'utf8');
};

export const estimateJsonBytes = (value) => {
  try {
    return Buffer.byteLength(JSON.stringify(value), 'utf8');
  } catch {
    return 0;
  }
};

export function createCacheReporter({ enabled = false, log = null } = {}) {
  const entries = [];
  return {
    track(stats) {
      if (stats) entries.push(stats);
    },
    report() {
      if (!enabled || !log || !entries.length) return;
      log('Cache stats:');
      for (const stats of entries) {
        const sizeMb = stats.maxSizeBytes ? (stats.maxSizeBytes / BYTES_PER_MB).toFixed(1) : 'n/a';
        const ttlMs = Number.isFinite(stats.ttlMs) ? stats.ttlMs : 0;
        log(`- ${stats.name}: hits=${stats.hits}, misses=${stats.misses}, evictions=${stats.evictions}, sets=${stats.sets}, maxEntries=${stats.maxEntries ?? 'n/a'}, maxMb=${sizeMb}, ttlMs=${ttlMs}`);
      }
    }
  };
}

export function createLruCache({
  name,
  maxMb,
  ttlMs,
  maxEntries,
  sizeCalculation,
  reporter
}) {
  const entryLimit = Number.isFinite(Number(maxEntries))
    ? Math.max(0, Math.floor(Number(maxEntries)))
    : null;
  const hasEntryLimit = entryLimit !== null;
  const maxSizeBytes = hasEntryLimit ? 0 : mbToBytes(maxMb);
  const ttlValue = Number.isFinite(Number(ttlMs)) ? Math.max(0, Number(ttlMs)) : 0;

  const stats = {
    name,
    hits: 0,
    misses: 0,
    evictions: 0,
    sets: 0,
    maxEntries: hasEntryLimit ? entryLimit : null,
    maxSizeBytes,
    ttlMs: ttlValue
  };

  if (reporter && typeof reporter.track === 'function') {
    reporter.track(stats);
  }

  if ((hasEntryLimit && entryLimit > 0) || maxSizeBytes > 0) {
    const options = {
      allowStale: false,
      updateAgeOnGet: true,
      dispose: (_value, _key, reason) => {
        if (reason === 'evict') stats.evictions += 1;
      }
    };
    if (hasEntryLimit && entryLimit > 0) {
      options.max = entryLimit;
    } else {
      options.maxSize = maxSizeBytes;
      options.sizeCalculation = typeof sizeCalculation === 'function'
        ? sizeCalculation
        : estimateJsonBytes;
    }
    if (ttlValue > 0) options.ttl = ttlValue;
    const cache = new LRUCache(options);
    return {
      get(key) {
        const value = cache.get(key);
        if (value === undefined) {
          stats.misses += 1;
          return null;
        }
        stats.hits += 1;
        return value;
      },
      set(key, value) {
        stats.sets += 1;
        cache.set(key, value);
      },
      cache,
      stats
    };
  }

  return {
    get() {
      stats.misses += 1;
      return null;
    },
    set() {
      stats.sets += 1;
    },
    cache: null,
    stats
  };
}
