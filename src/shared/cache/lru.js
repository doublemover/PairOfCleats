import { LRUCache } from 'lru-cache';
import { BYTES_PER_MB, estimateJsonBytes, mbToBytes } from './size.js';

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
  reporter,
  onEvict = null,
  onHit = null,
  onMiss = null,
  onSet = null,
  onDelete = null,
  onClear = null,
  onSizeChange = null
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
    let cache = null;
    const options = {
      allowStale: false,
      updateAgeOnGet: true,
      dispose: (value, key, reason) => {
        if (reason === 'evict') stats.evictions += 1;
        if (typeof onEvict === 'function') {
          onEvict({ key, value, reason });
        }
      }
    };
    if (hasEntryLimit && entryLimit > 0) {
      options.max = entryLimit;
    } else {
      options.maxSize = maxSizeBytes;
      const baseSizer = typeof sizeCalculation === 'function'
        ? sizeCalculation
        : estimateJsonBytes;
      options.sizeCalculation = (value, key) => {
        const raw = baseSizer(value, key);
        if (Number.isFinite(raw) && raw > 0) return raw;
        const message = `[cache] ${name || 'cache'} sizeCalculation returned ${raw} for key ${String(key)}`;
        console.error(message);
        throw new Error(message);
      };
    }
    if (ttlValue > 0) options.ttl = ttlValue;
    cache = new LRUCache(options);
    const reportSize = () => {
      if (typeof onSizeChange === 'function') onSizeChange(cache.size);
    };
    return {
      get(key) {
        const value = cache.get(key);
        if (value === undefined) {
          stats.misses += 1;
          if (typeof onMiss === 'function') onMiss({ key });
          return null;
        }
        stats.hits += 1;
        if (typeof onHit === 'function') onHit({ key, value });
        return value;
      },
      set(key, value) {
        stats.sets += 1;
        cache.set(key, value);
        if (typeof onSet === 'function') onSet({ key, value });
        reportSize();
      },
      delete(key) {
        cache.delete(key);
        if (typeof onDelete === 'function') onDelete({ key });
        reportSize();
      },
      clear() {
        cache.clear();
        if (typeof onClear === 'function') onClear();
        reportSize();
      },
      size: () => cache.size,
      cache,
      stats
    };
  }

  return {
    get(key) {
      stats.misses += 1;
      if (typeof onMiss === 'function') onMiss({ key });
      return null;
    },
    set(key, value) {
      stats.sets += 1;
      if (typeof onSet === 'function') onSet({ key, value });
      if (typeof onSizeChange === 'function') onSizeChange(0);
    },
    delete(key) {
      if (typeof onDelete === 'function') onDelete({ key });
      if (typeof onSizeChange === 'function') onSizeChange(0);
    },
    clear() {
      if (typeof onClear === 'function') onClear();
      if (typeof onSizeChange === 'function') onSizeChange(0);
    },
    size: () => 0,
    cache: null,
    stats
  };
}
