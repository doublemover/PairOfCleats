import fs from 'node:fs';

const QUERY_CACHE_VERSION = 1;
const queryCacheDiskCache = new Map();

const readCacheFileSignature = (cachePath) => {
  try {
    const stat = fs.statSync(cachePath);
    return `${stat.size}:${stat.mtimeMs}`;
  } catch {
    return null;
  }
};

const getLookupStamp = (cache) => {
  const entries = Array.isArray(cache?.entries) ? cache.entries : [];
  const first = entries[0];
  const last = entries[entries.length - 1];
  return `${entries.length}:${first?.key || ''}:${first?.ts || ''}:${last?.key || ''}:${last?.ts || ''}`;
};

const rebuildLookup = (cache) => {
  const entries = Array.isArray(cache?.entries) ? cache.entries : [];
  const lookup = new Map();
  for (const entry of entries) {
    if (!entry?.key || !entry?.signature) continue;
    const key = `${entry.key}::${entry.signature}`;
    const existing = lookup.get(key);
    if (!existing || Number(entry.ts || 0) > Number(existing.ts || 0)) {
      lookup.set(key, entry);
    }
  }
  Object.defineProperty(cache, '__lookup', {
    value: lookup,
    enumerable: false,
    configurable: true,
    writable: true
  });
  Object.defineProperty(cache, '__lookupStamp', {
    value: getLookupStamp(cache),
    enumerable: false,
    configurable: true,
    writable: true
  });
  return lookup;
};

const getLookup = (cache) => {
  if (!cache || typeof cache !== 'object') return null;
  const stamp = getLookupStamp(cache);
  if (cache.__lookup && cache.__lookupStamp === stamp) {
    return cache.__lookup;
  }
  return rebuildLookup(cache);
};

const createEmptyCache = () => ({ version: QUERY_CACHE_VERSION, entries: [] });

/**
 * Load query cache data from disk.
 * @param {string} cachePath
 * @returns {{version:number,entries:Array}}
 */
export function loadQueryCache(cachePath) {
  if (!cachePath) return createEmptyCache();
  const signature = readCacheFileSignature(cachePath);
  if (!signature) return createEmptyCache();
  const cached = queryCacheDiskCache.get(cachePath);
  if (cached?.signature === signature && cached?.value) {
    return cached.value;
  }
  try {
    const data = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    if (data && Array.isArray(data.entries)) {
      queryCacheDiskCache.set(cachePath, { signature, value: data });
      rebuildLookup(data);
      return data;
    }
  } catch {}
  return createEmptyCache();
}

/**
 * Prune cache entries to a maximum count.
 * @param {{entries?:Array}} cache
 * @param {number} maxEntries
 * @returns {{entries?:Array}}
 */
export function pruneQueryCache(cache, maxEntries) {
  if (!cache || !Array.isArray(cache.entries)) return cache;
  cache.entries = cache.entries
    .filter((entry) => entry && entry.key && entry.ts)
    .sort((a, b) => b.ts - a.ts);
  if (cache.entries.length > maxEntries) {
    cache.entries = cache.entries.slice(0, maxEntries);
  }
  rebuildLookup(cache);
  return cache;
}

/**
 * Find the newest cache entry for key + signature.
 * @param {{entries?:Array}} cache
 * @param {string} key
 * @param {string} signature
 * @returns {object|null}
 */
export function findQueryCacheEntry(cache, key, signature) {
  if (!cache || !key || !signature) return null;
  const lookup = getLookup(cache);
  if (!lookup) return null;
  return lookup.get(`${key}::${signature}`) || null;
}

/**
 * Parse JSON when given a string; otherwise return the value.
 * @param {any} value
 * @param {any} fallback
 * @returns {any}
 */
export function parseJson(value, fallback) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return fallback;
    try {
      return JSON.parse(trimmed);
    } catch {
      return fallback;
    }
  }
  return value;
}

/**
 * Parse a field into a string array.
 * @param {any} value
 * @returns {string[]}
 */
export function parseArrayField(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith('[')) {
      const parsed = parseJson(trimmed, []);
      return Array.isArray(parsed) ? parsed : [];
    }
    return trimmed.split(/\s+/).filter(Boolean);
  }
  return [];
}
