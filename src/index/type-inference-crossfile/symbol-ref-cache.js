import { resolveSymbolRef } from './resolver.js';

const DEFAULT_SYMBOL_REF_CACHE_MAX_ENTRIES = 20000;
const DEFAULT_SYMBOL_REF_CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Build a TTL + bounded-size cache around symbol-ref resolution.
 *
 * Eviction policy:
 * 1) Trim oldest entries when max size is exceeded.
 * 2) Remove stale entries older than ttlMs.
 *
 * @param {object} [input]
 * @param {object|null} [input.fileRelations]
 * @param {object} [input.symbolIndex]
 * @param {Set<string>} [input.fileSet]
 * @param {number} [input.maxEntries]
 * @param {number} [input.ttlMs]
 * @param {()=>number} [input.nowMs]
 * @param {(input:object)=>object|null} [input.resolveSymbolRefFn]
 * @returns {(input:{targetName:string,kindHint?:string|null,fromFile?:string|null})=>object|null}
 */
export const createSymbolRefCacheResolver = ({
  fileRelations = null,
  symbolIndex = null,
  fileSet = new Set(),
  maxEntries = DEFAULT_SYMBOL_REF_CACHE_MAX_ENTRIES,
  ttlMs = DEFAULT_SYMBOL_REF_CACHE_TTL_MS,
  nowMs = () => Date.now(),
  resolveSymbolRefFn = resolveSymbolRef
} = {}) => {
  const cache = new Map();
  const resolvedMaxEntries = Number.isFinite(Number(maxEntries))
    ? Math.max(1, Math.floor(Number(maxEntries)))
    : DEFAULT_SYMBOL_REF_CACHE_MAX_ENTRIES;
  const resolvedTtlMs = Number.isFinite(Number(ttlMs))
    ? Math.max(1000, Math.floor(Number(ttlMs)))
    : DEFAULT_SYMBOL_REF_CACHE_TTL_MS;

  const pruneCache = (timestampMs) => {
    if (!cache.size) return;
    if (cache.size > resolvedMaxEntries) {
      const toEvict = cache.size - resolvedMaxEntries;
      const iter = cache.keys();
      for (let index = 0; index < toEvict; index += 1) {
        const next = iter.next();
        if (next.done) break;
        cache.delete(next.value);
      }
    }
    const cutoff = timestampMs - resolvedTtlMs;
    for (const [key, entry] of cache.entries()) {
      if (!entry || Number(entry.ts) < cutoff) {
        cache.delete(key);
      }
    }
  };

  return ({
    targetName,
    kindHint = null,
    fromFile = null
  }) => {
    const name = typeof targetName === 'string' ? targetName : null;
    if (!name) return null;
    const now = Number(nowMs());
    const timestampMs = Number.isFinite(now) ? now : Date.now();
    const cacheKey = `${fromFile || ''}\u0001${kindHint || ''}\u0001${name}`;
    const cached = cache.get(cacheKey);
    if (cached && Number(cached.ts) >= (timestampMs - resolvedTtlMs)) {
      cache.delete(cacheKey);
      cache.set(cacheKey, cached);
      return cached.value;
    }
    if (cached) {
      cache.delete(cacheKey);
    }
    const resolved = resolveSymbolRefFn({
      targetName: name,
      kindHint,
      fromFile,
      fileRelations,
      symbolIndex,
      fileSet
    });
    cache.set(cacheKey, { value: resolved || null, ts: timestampMs });
    if (cache.size > resolvedMaxEntries) {
      pruneCache(timestampMs);
    }
    return resolved || null;
  };
};
