import fs from 'node:fs';
import { normalizePositiveInt } from '../shared/limits.js';
import { sortAndTrimEntriesByNewest } from './cache-trim.js';
import { TimestampRetention } from './timestamp-retention.js';
import { loadBoundedJsonFileSync } from '../shared/cache/json-file.js';
import { applyQueryCacheTouches, loadQueryCacheTouches } from './query-cache-touches.js';
import { forkQueryCacheSnapshot, recordQueryCacheSnapshot, estimateQueryCacheEntryBytes } from './query-cache-state.js';

const QUERY_CACHE_VERSION = 1;
const queryCacheDiskCache = new Map();
const queryCacheHotEntries = new Map();
const HOT_CACHE_MAX_ENTRIES_DEFAULT = 512;
const QUERY_CACHE_MAX_PATH_ENTRIES = 128;
const QUERY_CACHE_MAX_READ_BYTES = 8 * 1024 * 1024;
const QUERY_CACHE_CORRUPT_SUFFIX = '.corrupt';
const MEMORY_CACHE_KEY = ':memory:query-cache';
const MAX_RETAINED_QUERY_CACHE_BYTES = 16 * 1024 * 1024;
let diskCacheBytes = 0;
let hotCacheBytes = 0;
const hotValidationTimes = new WeakMap();

const trimPathCacheEntries = (cacheMap, maxEntries = QUERY_CACHE_MAX_PATH_ENTRIES, onEvict = null) => {
  if (!(cacheMap instanceof Map)) return;
  const resolvedMaxEntries = Math.max(1, Math.floor(Number(maxEntries) || QUERY_CACHE_MAX_PATH_ENTRIES));
  while (cacheMap.size > resolvedMaxEntries) {
    const oldestKey = cacheMap.keys().next()?.value;
    if (!oldestKey) break;
    onEvict?.(cacheMap.get(oldestKey));
    cacheMap.delete(oldestKey);
  }
};

const readCacheFileSignature = (cachePath) => {
  try {
    const stat = fs.statSync(cachePath, { bigint: true });
    return [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].map(String).join(':');
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

const createEmptyCache = () => recordQueryCacheSnapshot({ version: QUERY_CACHE_VERSION, entries: [] });

const normalizeLookupKey = (key, signature) => (
  key && signature ? `${key}::${signature}` : null
);

const resolveCachePathKey = (cachePath) => (
  typeof cachePath === 'string' && cachePath ? cachePath : MEMORY_CACHE_KEY
);

const normalizeHotCacheMaxEntries = (
  value,
  fallback = HOT_CACHE_MAX_ENTRIES_DEFAULT
) => {
  const fallbackEntries = normalizePositiveInt(fallback, HOT_CACHE_MAX_ENTRIES_DEFAULT);
  const normalized = normalizePositiveInt(value, fallbackEntries);
  return Math.max(1, normalized ?? HOT_CACHE_MAX_ENTRIES_DEFAULT);
};

const ensureHotCache = (cachePath, maxEntries = HOT_CACHE_MAX_ENTRIES_DEFAULT) => {
  const pathKey = resolveCachePathKey(cachePath);
  if (!pathKey) return null;
  let state = queryCacheHotEntries.get(pathKey);
  if (!state) {
    state = {
      entries: new TimestampRetention(),
      sizes: new Map(),
      bytes: 0,
      maxEntries: normalizeHotCacheMaxEntries(maxEntries, HOT_CACHE_MAX_ENTRIES_DEFAULT)
    };
    queryCacheHotEntries.set(pathKey, state);
    trimPathCacheEntries(queryCacheHotEntries, QUERY_CACHE_MAX_PATH_ENTRIES, entry => { hotCacheBytes -= entry.bytes; });
  } else if (maxEntries != null) {
    state.maxEntries = normalizeHotCacheMaxEntries(
      maxEntries,
      state.maxEntries || HOT_CACHE_MAX_ENTRIES_DEFAULT
    );
  }
  return state;
};

const clearHotCache = (cachePath) => {
  const pathKey = resolveCachePathKey(cachePath);
  if (!pathKey) return;
  hotCacheBytes -= queryCacheHotEntries.get(pathKey)?.bytes || 0;
  queryCacheHotEntries.delete(pathKey);
};

const clearDiskCache = (cachePath) => {
  const pathKey = resolveCachePathKey(cachePath);
  if (!pathKey) return;
  diskCacheBytes -= queryCacheDiskCache.get(pathKey)?.bytes || 0;
  queryCacheDiskCache.delete(pathKey);
};

const bumpCacheHealthCounter = (health, key) => {
  if (!health || typeof health !== 'object' || !key) return;
  const current = Number.isFinite(Number(health[key])) ? Number(health[key]) : 0;
  health[key] = current + 1;
};

const emitCacheWarning = (onWarning, message) => {
  if (typeof onWarning === 'function') {
    onWarning(message);
    return;
  }
  try {
    process.emitWarning(message, { code: 'QUERY_CACHE_WARNING' });
  } catch {}
};

const quarantineCorruptCacheFileSync = (cachePath, onWarning) => {
  if (!cachePath) return null;
  const quarantinePath = `${cachePath}${QUERY_CACHE_CORRUPT_SUFFIX}-${Date.now()}`;
  try {
    fs.renameSync(cachePath, quarantinePath);
    emitCacheWarning(onWarning, `[retrieval] quarantined corrupt query cache: ${quarantinePath}`);
    return quarantinePath;
  } catch (error) {
    emitCacheWarning(
      onWarning,
      `[retrieval] failed to quarantine corrupt query cache (${cachePath}): ${error?.message || error}`
    );
    return null;
  }
};

const trimHotCache = (state) => {
  if (!(state?.entries instanceof TimestampRetention)) return;
  const maxEntries = normalizeHotCacheMaxEntries(state.maxEntries, HOT_CACHE_MAX_ENTRIES_DEFAULT);
  const overflow = state.entries.size > maxEntries;
  if (overflow) state.entries.trim(maxEntries);
  if (overflow || state.reconcileSizes) {
    for (const [key, size] of state.sizes) {
      if (state.entries.get(key)) continue;
      state.sizes.delete(key); state.bytes -= size; hotCacheBytes -= size;
    }
    state.reconcileSizes = false;
  }
  while (hotCacheBytes > MAX_RETAINED_QUERY_CACHE_BYTES) {
    const oldest = queryCacheHotEntries.keys().next().value;
    if (oldest == null) break;
    clearHotCache(oldest);
  }
};

const rememberHotCacheEntry = ({
  cachePath,
  key,
  signature,
  entry,
  maxEntries = null,
  validated = false
}) => {
  const lookupKey = normalizeLookupKey(key, signature);
  if (!lookupKey || !entry) return;
  const state = ensureHotCache(cachePath, maxEntries ?? HOT_CACHE_MAX_ENTRIES_DEFAULT);
  if (!state) return;
  const resident = state.entries.get(lookupKey);
  const samePayload = resident && (entry.payloadId ? entry.payloadId === resident.payloadId : entry.payload === resident.payload);
  hotValidationTimes.set(entry, validated ? Date.now() : hotValidationTimes.get(entry) ?? (samePayload
    ? hotValidationTimes.get(resident) ?? Number(resident.ts || 0) : Number(entry.ts || 0)));
  const size = estimateQueryCacheEntryBytes(entry);
  const previousSize = state.sizes.get(lookupKey) || 0;
  state.sizes.set(lookupKey, size);
  state.bytes += size - previousSize; hotCacheBytes += size - previousSize;
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
  if (!(state?.entries instanceof TimestampRetention)) return null;
  const entry = state.entries.get(lookupKey) || null;
  if (!entry) return null;
  const freshnessMs = Number.isFinite(Number(memoryFreshMs))
    ? Math.max(0, Math.floor(Number(memoryFreshMs)))
    : 0;
  if (freshnessMs > 0) {
    const ageMs = Date.now() - Number(hotValidationTimes.get(entry) ?? entry.ts ?? 0);
    if (!Number.isFinite(ageMs) || ageMs > freshnessMs) return null;
  }
  return entry;
};

const prewarmHotCache = ({
  cachePath,
  entries,
  generation,
  hotMaxEntries = null,
  maxEntries = HOT_CACHE_MAX_ENTRIES_DEFAULT
}) => {
  const list = Array.isArray(entries) ? entries : [];
  if (!list.length) return;
  const state = ensureHotCache(cachePath, hotMaxEntries);
  if (!state) return;
  const policy = normalizeHotCacheMaxEntries(maxEntries, state.maxEntries);
  if (state.prewarmGeneration === generation && state.prewarmLimit === policy) { trimHotCache(state); return; }
  if (state.prewarmLimit != null && policy < state.prewarmLimit) {
    state.entries.trim(policy); state.reconcileSizes = true;
  }
  const sorted = sortAndTrimEntriesByNewest(
    list.filter((entry) => entry?.key && entry?.signature),
    {
      maxEntries: normalizeHotCacheMaxEntries(
        maxEntries,
        state.maxEntries || HOT_CACHE_MAX_ENTRIES_DEFAULT
      )
    }
  );
  for (const entry of sorted) {
    const lookupKey = normalizeLookupKey(entry.key, entry.signature);
    if (!lookupKey) continue;
    const resident = state.entries.get(lookupKey);
    if (!resident || Number(entry.ts || 0) > Number(resident.ts || 0)) {
      rememberHotCacheEntry({ cachePath, key: entry.key, signature: entry.signature, entry, maxEntries: state.maxEntries });
    }
    const validated = state.entries.get(lookupKey);
    if (validated && ((entry.payloadId && validated.payloadId === entry.payloadId) || entry.payload === validated.payload)) {
      hotValidationTimes.set(validated, Date.now());
    }
  }
  trimHotCache(state);
  state.prewarmGeneration = generation;
  state.prewarmLimit = policy;
};

/**
 * Load query cache data from disk.
 * @param {string} cachePath
 * @param {{
 *  prewarm?:boolean,
 *  prewarmMaxEntries?:number,
 *  onWarning?:(message:string)=>void,
 *  health?:object|null
 * }} [options]
 * @returns {{version:number,entries:Array}}
 */
export function loadQueryCache(cachePath, options = {}) {
  if (!cachePath) return createEmptyCache();
  const signature = readCacheFileSignature(cachePath);
  if (!signature) {
    clearDiskCache(cachePath);
    clearHotCache(cachePath);
    return createEmptyCache();
  }
  const cached = queryCacheDiskCache.get(cachePath);
  if (cached?.signature === signature && cached?.value) {
    const snapshot = forkQueryCacheSnapshot(cached.value);
    applyQueryCacheTouches(snapshot, loadQueryCacheTouches(cachePath));
    if (options.prewarm === true) {
      prewarmHotCache({
        cachePath,
        entries: snapshot.entries,
        generation: signature,
        hotMaxEntries: options.maxHotEntries,
        maxEntries: options.prewarmMaxEntries
      });
    }
    return snapshot;
  }
  const { data, error: readError } = loadBoundedJsonFileSync(cachePath, {
    fallback: null,
    maxBytes: QUERY_CACHE_MAX_READ_BYTES
  });
  if (
    data
    && Number(data.version) === QUERY_CACHE_VERSION
    && Array.isArray(data.entries)
  ) {
    const canonical = forkQueryCacheSnapshot(data);
    const bytes = (() => { try { return fs.statSync(cachePath).size; } catch { return QUERY_CACHE_MAX_READ_BYTES; } })();
    clearDiskCache(cachePath);
    queryCacheDiskCache.set(cachePath, { signature, value: canonical, bytes }); diskCacheBytes += bytes;
    trimPathCacheEntries(queryCacheDiskCache, QUERY_CACHE_MAX_PATH_ENTRIES, entry => { diskCacheBytes -= entry.bytes; });
    while (diskCacheBytes > MAX_RETAINED_QUERY_CACHE_BYTES) clearDiskCache(queryCacheDiskCache.keys().next().value);
    const snapshot = forkQueryCacheSnapshot(canonical);
    applyQueryCacheTouches(snapshot, loadQueryCacheTouches(cachePath));
    rebuildLookup(snapshot);
    if (options.prewarm === true) {
      prewarmHotCache({
        cachePath,
        entries: snapshot.entries,
        generation: signature,
        hotMaxEntries: options.maxHotEntries,
        maxEntries: options.prewarmMaxEntries
      });
    }
    return snapshot;
  }
  const health = options?.health && typeof options.health === 'object'
    ? options.health
    : null;
  if (readError?.code === 'ERR_JSON_FILE_TOO_LARGE') {
    bumpCacheHealthCounter(health, 'queryCacheOversized');
    emitCacheWarning(
      options?.onWarning,
      `[retrieval] query cache exceeds ${QUERY_CACHE_MAX_READ_BYTES} bytes; using empty cache.`
    );
  } else if (readError && readError?.code !== 'ENOENT') {
    bumpCacheHealthCounter(health, 'queryCacheParseOrReadFailures');
    emitCacheWarning(
      options?.onWarning,
      `[retrieval] query cache read/parse failed (${readError?.code || 'ERR_QUERY_CACHE_READ'}): ${readError?.message || readError}`
    );
  }
  if (readError && readError?.code !== 'ENOENT') {
    quarantineCorruptCacheFileSync(cachePath, options?.onWarning);
  }
  clearDiskCache(cachePath);
  clearHotCache(cachePath);
  return createEmptyCache();
}

/**
 * Prune cache entries to a maximum count.
 * @param {{entries?:Array}} cache
 * @param {number} maxEntries
 * @returns {{entries?:Array}}
 */
export function pruneQueryCache(cache, maxEntries, maxBytes = QUERY_CACHE_MAX_READ_BYTES) {
  if (!cache || !Array.isArray(cache.entries)) return cache;
  cache.entries = cache.entries
    .filter((entry) => entry && entry.key && Number.isFinite(Number(entry.ts)) && Number(entry.ts) > 0)
    .sort((a, b) => b.ts - a.ts);
  if (cache.entries.length > maxEntries) {
    cache.entries = cache.entries.slice(0, maxEntries);
  }
  let bytes = Buffer.byteLength(JSON.stringify({ version: QUERY_CACHE_VERSION, entries: [] }));
  cache.entries = cache.entries.filter(entry => {
    const size = estimateQueryCacheEntryBytes(entry) + 1;
    if (bytes + size > maxBytes) return false;
    bytes += size; return true;
  });
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
        maxEntries: options?.maxHotEntries,
        validated: true
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
    maxEntries
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
