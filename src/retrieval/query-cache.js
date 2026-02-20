import fs from 'node:fs';

const QUERY_CACHE_VERSION = 1;
const queryCacheDiskCache = new Map();
const queryCacheHotEntries = new Map();
const HOT_CACHE_MAX_ENTRIES_DEFAULT = 512;

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

const normalizePositiveInt = (value, fallback = null) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(1, Math.floor(parsed));
};

const normalizeLookupKey = (key, signature) => (
  key && signature ? `${key}::${signature}` : null
);

const resolveCachePathKey = (cachePath) => (
  typeof cachePath === 'string' && cachePath ? cachePath : ''
);

const ensureHotCache = (cachePath, maxEntries = HOT_CACHE_MAX_ENTRIES_DEFAULT) => {
  const pathKey = resolveCachePathKey(cachePath);
  if (!pathKey) return null;
  let state = queryCacheHotEntries.get(pathKey);
  if (!state) {
    state = {
      entries: new Map(),
      maxEntries: normalizePositiveInt(maxEntries, HOT_CACHE_MAX_ENTRIES_DEFAULT)
    };
    queryCacheHotEntries.set(pathKey, state);
  } else if (maxEntries != null) {
    state.maxEntries = normalizePositiveInt(maxEntries, state.maxEntries || HOT_CACHE_MAX_ENTRIES_DEFAULT);
  }
  return state;
};

const trimHotCache = (state) => {
  if (!state?.entries || !(state.entries instanceof Map)) return;
  const maxEntries = normalizePositiveInt(state.maxEntries, HOT_CACHE_MAX_ENTRIES_DEFAULT);
  if (state.entries.size <= maxEntries) return;
  const sorted = Array.from(state.entries.entries()).sort((left, right) => (
    Number(right[1]?.ts || 0) - Number(left[1]?.ts || 0)
  ));
  state.entries = new Map(sorted.slice(0, maxEntries));
};

const rememberHotCacheEntry = ({
  cachePath,
  key,
  signature,
  entry,
  maxEntries = null
}) => {
  const lookupKey = normalizeLookupKey(key, signature);
  if (!lookupKey || !entry) return;
  const state = ensureHotCache(cachePath, maxEntries ?? HOT_CACHE_MAX_ENTRIES_DEFAULT);
  if (!state) return;
  state.entries.set(lookupKey, entry);
  trimHotCache(state);
};

const getHotCacheEntry = ({
  cachePath,
  key,
  signature,
  memoryFreshMs = 0
}) => {
  const lookupKey = normalizeLookupKey(key, signature);
  if (!lookupKey) return null;
  const pathKey = resolveCachePathKey(cachePath);
  if (!pathKey) return null;
  const state = queryCacheHotEntries.get(pathKey);
  if (!state?.entries || !(state.entries instanceof Map)) return null;
  const entry = state.entries.get(lookupKey) || null;
  if (!entry) return null;
  const freshnessMs = Number.isFinite(Number(memoryFreshMs))
    ? Math.max(0, Math.floor(Number(memoryFreshMs)))
    : 0;
  if (freshnessMs > 0) {
    const ageMs = Date.now() - Number(entry.ts || 0);
    if (!Number.isFinite(ageMs) || ageMs > freshnessMs) return null;
  }
  return entry;
};

const prewarmHotCache = ({
  cachePath,
  entries,
  maxEntries = HOT_CACHE_MAX_ENTRIES_DEFAULT
}) => {
  const list = Array.isArray(entries) ? entries : [];
  if (!list.length) return;
  const state = ensureHotCache(cachePath, maxEntries);
  if (!state) return;
  const sorted = list
    .filter((entry) => entry?.key && entry?.signature)
    .sort((left, right) => Number(right?.ts || 0) - Number(left?.ts || 0))
    .slice(0, normalizePositiveInt(maxEntries, HOT_CACHE_MAX_ENTRIES_DEFAULT));
  for (const entry of sorted) {
    const lookupKey = normalizeLookupKey(entry.key, entry.signature);
    if (!lookupKey) continue;
    state.entries.set(lookupKey, entry);
  }
  trimHotCache(state);
};

/**
 * Load query cache data from disk.
 * @param {string} cachePath
 * @param {{prewarm?:boolean,prewarmMaxEntries?:number}} [options]
 * @returns {{version:number,entries:Array}}
 */
export function loadQueryCache(cachePath, options = {}) {
  if (!cachePath) return createEmptyCache();
  const signature = readCacheFileSignature(cachePath);
  if (!signature) return createEmptyCache();
  const cached = queryCacheDiskCache.get(cachePath);
  if (cached?.signature === signature && cached?.value) {
    if (options.prewarm === true) {
      prewarmHotCache({
        cachePath,
        entries: cached.value.entries,
        maxEntries: normalizePositiveInt(options.prewarmMaxEntries, HOT_CACHE_MAX_ENTRIES_DEFAULT)
      });
    }
    return cached.value;
  }
  try {
    const data = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    if (data && Array.isArray(data.entries)) {
      queryCacheDiskCache.set(cachePath, { signature, value: data });
      rebuildLookup(data);
      if (options.prewarm === true) {
        prewarmHotCache({
          cachePath,
          entries: data.entries,
          maxEntries: normalizePositiveInt(options.prewarmMaxEntries, HOT_CACHE_MAX_ENTRIES_DEFAULT)
        });
      }
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
 * @param {{cachePath?:string,strategy?:'memory-first'|'disk-first',memoryFreshMs?:number,maxHotEntries?:number}} [options]
 * @returns {object|null}
 */
export function findQueryCacheEntry(cache, key, signature, options = {}) {
  if (!key || !signature) return null;
  const strategy = options?.strategy === 'memory-first'
    ? 'memory-first'
    : 'disk-first';
  const readMemory = () => getHotCacheEntry({
    cachePath: options?.cachePath,
    key,
    signature,
    memoryFreshMs: options?.memoryFreshMs
  });
  const readDisk = () => {
    if (!cache || typeof cache !== 'object') return null;
    const lookup = getLookup(cache);
    if (!lookup) return null;
    const entry = lookup.get(`${key}::${signature}`) || null;
    if (entry) {
      rememberHotCacheEntry({
        cachePath: options?.cachePath,
        key,
        signature,
        entry,
        maxEntries: normalizePositiveInt(options?.maxHotEntries, HOT_CACHE_MAX_ENTRIES_DEFAULT)
      });
    }
    return entry;
  };
  if (strategy === 'memory-first') {
    return readMemory() || readDisk();
  }
  return readDisk();
}

/**
 * Upsert a hot in-memory cache entry for memory-first query cache strategies.
 * @param {string} cachePath
 * @param {string} key
 * @param {string} signature
 * @param {object} entry
 * @param {number} [maxEntries]
 */
export function rememberQueryCacheEntry(cachePath, key, signature, entry, maxEntries = null) {
  rememberHotCacheEntry({
    cachePath,
    key,
    signature,
    entry,
    maxEntries: normalizePositiveInt(maxEntries, HOT_CACHE_MAX_ENTRIES_DEFAULT)
  });
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
