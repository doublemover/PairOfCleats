import { LRUCache } from 'lru-cache';

const BYTES_PER_MB = 1024 * 1024;

export const DEFAULT_CACHE_MB = {
  fileText: 64,
  summary: 32,
  formatFull: 16,
  formatShort: 16,
  lint: 16,
  complexity: 16,
  gitMeta: 16
};

export const DEFAULT_CACHE_TTL_MS = {
  fileText: 0,
  summary: 0,
  formatFull: 0,
  formatShort: 0,
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
  const size = Buffer.byteLength(value, 'utf8');
  return size > 0 ? size : 1;
};

export const estimateFileTextBytes = (value) => {
  if (value == null) return 0;
  let size = 0;
  if (typeof value === 'string') size = estimateStringBytes(value);
  else if (Buffer.isBuffer(value)) size = value.length;
  else if (value && typeof value === 'object') {
    if (Buffer.isBuffer(value.buffer)) size = value.buffer.length;
    else if (Buffer.isBuffer(value.data)) size = value.data.length;
    else if (typeof value.text === 'string') size = estimateStringBytes(value.text);
  }
  if (!Number.isFinite(size) || size <= 0) {
    size = estimateJsonBytes(value);
  }
  return Number.isFinite(size) && size > 0 ? size : 1;
};

export const estimateJsonBytes = (value) => {
  const MAX_DEPTH = 4;
  const MAX_SAMPLE = 200;
  const seen = new WeakSet();
  const estimateValue = (entry, depth) => {
    if (entry == null) return 4;
    const type = typeof entry;
    if (type === 'string') return Buffer.byteLength(entry, 'utf8');
    if (type === 'number' || type === 'boolean') return 8;
    if (type !== 'object') return 0;
    if (seen.has(entry)) return 0;
    seen.add(entry);
    if (depth >= MAX_DEPTH) return 8;
    if (Array.isArray(entry)) {
      const len = entry.length;
      const sampleCount = Math.min(len, MAX_SAMPLE);
      let sum = 2;
      for (let i = 0; i < sampleCount; i += 1) {
        sum += estimateValue(entry[i], depth + 1) + 1;
      }
      if (sampleCount && len > sampleCount) {
        sum = Math.round(sum * (len / sampleCount));
      }
      return sum;
    }
    const keys = Object.keys(entry);
    const sampleCount = Math.min(keys.length, MAX_SAMPLE);
    let sum = 2;
    for (let i = 0; i < sampleCount; i += 1) {
      const key = keys[i];
      sum += Buffer.byteLength(key, 'utf8') + 4;
      sum += estimateValue(entry[key], depth + 1) + 1;
    }
    if (sampleCount && keys.length > sampleCount) {
      sum = Math.round(sum * (keys.length / sampleCount));
    }
    return sum;
  };
  try {
    return estimateValue(value, 0);
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
        // Loud warning + hard failure so we never silently spin on invalid sizes.
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
