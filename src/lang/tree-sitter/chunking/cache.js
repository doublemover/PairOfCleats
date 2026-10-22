import { withGeneratedCacheMetadata } from '../../../shared/generated-artifact-cache.js';
import fs from 'node:fs';
import path from 'node:path';
import { buildLocalCacheKey } from '../../../shared/cache-key.js';
import { atomicWriteJsonSync } from '../../../shared/io/atomic-write.js';
import { treeSitterState } from '../state.js';
import { TREE_SITTER_CHUNK_VERSION } from '../config.js';
import { createHash } from 'node:crypto';
import { assertNoSymlinkPath } from '../../../shared/contained-file.js';

const DEFAULT_CHUNK_CACHE_MAX_ENTRIES = 64;
const CHUNK_CACHE_PERSISTENT_SCHEMA = '1.0.0';

const trimCacheEntries = (cache, maxEntries) => {
  while (cache?.size > maxEntries) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
};

const trimPersistentMemo = (maxEntries = treeSitterState.chunkCacheMaxEntries || DEFAULT_CHUNK_CACHE_MAX_ENTRIES) => {
  trimCacheEntries(treeSitterState.persistentChunkCacheMemo, maxEntries);
  trimCacheEntries(treeSitterState.persistentChunkCacheMisses, maxEntries);
};

const rememberPersistentMiss = (key) => {
  const misses = treeSitterState.persistentChunkCacheMisses;
  misses?.delete?.(key);
  misses?.add?.(key);
  trimPersistentMemo();
};

const rememberPersistentChunks = (key, chunks) => {
  const memo = treeSitterState.persistentChunkCacheMemo;
  memo?.delete?.(key);
  memo?.set?.(key, chunks);
  trimPersistentMemo();
};

/**
 * Build stable cache signature from tree-sitter chunking controls.
 * @param {object} options
 * @param {string} resolvedId
 * @returns {object}
 */
const buildChunkCacheSignature = (options, resolvedId) => {
  const config = options?.treeSitter || {};
  const perLanguage = config.byLanguage?.[resolvedId] || {};
  const adaptiveRaw = config.adaptive;
  const adaptive = adaptiveRaw === false || adaptiveRaw?.enabled === false
    ? false
    : adaptiveRaw && typeof adaptiveRaw === 'object'
      ? {
        denseThreshold: adaptiveRaw.denseThreshold ?? null,
        denserThreshold: adaptiveRaw.denserThreshold ?? null,
        denseScale: adaptiveRaw.denseScale ?? null,
        denserScale: adaptiveRaw.denserScale ?? null
      }
      : null;

  return {
    useQueries: config.useQueries ?? null,
    maxBytes: perLanguage.maxBytes ?? config.maxBytes ?? null,
    maxLines: perLanguage.maxLines ?? config.maxLines ?? null,
    maxParseMs: perLanguage.maxParseMs ?? config.maxParseMs ?? null,
    maxAstNodes: perLanguage.maxAstNodes ?? config.maxAstNodes ?? null,
    maxAstStack: perLanguage.maxAstStack ?? config.maxAstStack ?? null,
    maxChunkNodes: perLanguage.maxChunkNodes ?? config.maxChunkNodes ?? null,
    adaptive,
    configChunking: config.configChunking === true
  };
};

/**
 * Resolve in-memory/persistent cache key for one language + config signature.
 * @param {object} options
 * @param {string} resolvedId
 * @returns {string|null}
 */
export const resolveChunkCacheKey = (options, resolvedId) => {
  if (options?.treeSitter?.chunkCache === false) return null;
  const rawKey = options?.treeSitterCacheKey ?? options?.treeSitter?.cacheKey ?? null;
  if (rawKey == null || rawKey === '') return null;
  const base = typeof rawKey === 'string' ? rawKey : String(rawKey);
  if (!base) return null;
  return buildLocalCacheKey({
    namespace: 'tree-sitter-chunk',
    payload: {
      producerVersion: TREE_SITTER_CHUNK_VERSION,
      languageId: resolvedId,
      key: base,
      signature: buildChunkCacheSignature(options, resolvedId)
    }
  }).key;
};

/**
 * Resolve maximum number of LRU chunk entries.
 * @param {object} options
 * @returns {number}
 */
const resolveChunkCacheMaxEntries = (options) => {
  const raw = options?.treeSitter?.chunkCacheMaxEntries
    ?? options?.treeSitter?.chunkCache?.maxEntries
    ?? DEFAULT_CHUNK_CACHE_MAX_ENTRIES;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_CHUNK_CACHE_MAX_ENTRIES;
  return Math.max(1, Math.floor(parsed));
};

/**
 * Ensure process-local chunk cache map with configured capacity.
 * @param {object} options
 * @returns {{cache:Map<string,Array<object>>,maxEntries:number}}
 */
export const ensureChunkCache = (options) => {
  const maxEntries = resolveChunkCacheMaxEntries(options);
  if (!treeSitterState.chunkCache) treeSitterState.chunkCache = new Map();
  if (treeSitterState.chunkCacheMaxEntries !== maxEntries) {
    treeSitterState.chunkCache.clear();
    treeSitterState.chunkCacheMaxEntries = maxEntries;
    trimPersistentMemo(maxEntries);
  }
  return { cache: treeSitterState.chunkCache, maxEntries };
};

/**
 * Reset persistent cache memoization state when cache root changes.
 * @param {string|null} cacheRoot
 * @returns {string|null}
 */
const ensurePersistentChunkCacheRoot = (cacheRoot) => {
  if (!cacheRoot || typeof cacheRoot !== 'string') return null;
  if (treeSitterState.persistentChunkCacheRoot === cacheRoot) return cacheRoot;
  treeSitterState.persistentChunkCacheRoot = cacheRoot;
  treeSitterState.persistentChunkCacheMemo = new Map();
  treeSitterState.persistentChunkCacheMisses = new Set();
  return cacheRoot;
};

/**
 * Resolve persistent cache root directory when enabled.
 * @param {object} options
 * @returns {string|null}
 */
export const resolvePersistentChunkCacheRoot = (options) => {
  const cfg = options?.treeSitter || {};
  if (cfg.cachePersistent !== true) return null;
  const dir = typeof cfg.cachePersistentDir === 'string'
    ? cfg.cachePersistentDir.trim()
    : '';
  if (!dir) return null;
  return ensurePersistentChunkCacheRoot(path.resolve(dir));
};

/**
 * Resolve deterministic sharded file path for one persistent cache key.
 * @param {string|null} cacheRoot
 * @param {string} key
 * @returns {string|null}
 */
export const resolvePersistentChunkCachePaths = (cacheRoot, key) => {
  if (!cacheRoot || !key) return null;
  const safeKey = String(key).replace(/[^a-zA-Z0-9._-]/g, '_');
  const shard = createHash('sha256').update(String(key)).digest('hex').slice(0, 2);
  return { canonical: path.join(cacheRoot, shard, `${safeKey}.json`),
    legacy: path.join(cacheRoot, safeKey.slice(0, 2) || '00', `${safeKey}.json`) };
};
const resolvePersistentChunkCachePath = (cacheRoot, key) => resolvePersistentChunkCachePaths(cacheRoot, key)?.canonical || null;
const readPersistentPayload = (cacheRoot, filePath, key) => {
  assertNoSymlinkPath(cacheRoot, filePath);
  if (!fs.lstatSync(filePath).isFile()) return null;
  const payload = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return payload?.schemaVersion === CHUNK_CACHE_PERSISTENT_SCHEMA && payload.cacheKey === key
    && Array.isArray(payload.chunks) && payload.chunks.length ? payload : null;
};
const retireLegacyPayload = (cacheRoot, paths, key, chunks) => {
  if (paths.canonical === paths.legacy || !fs.existsSync(paths.legacy)) return;
  const old = readPersistentPayload(cacheRoot, paths.legacy, key);
  if (!old || JSON.stringify(old.chunks) !== JSON.stringify(chunks)) return;
  assertNoSymlinkPath(cacheRoot, paths.legacy);
  fs.unlinkSync(paths.legacy);
};

/**
 * Defensive clone of chunk rows for cache isolation.
 * @param {Array<object>} chunks
 * @returns {Array<object>}
 */
const cloneChunkList = (chunks) => chunks.map((chunk) => ({
  ...chunk,
  ...(chunk?.meta ? { meta: { ...chunk.meta } } : {})
}));

/**
 * Read persistent chunk cache entry with memoized hits/misses.
 * @param {string|null} cacheRoot
 * @param {string} key
 * @param {(key:string,amount?:number)=>void|null} [bumpMetric=null]
 * @returns {Array<object>|null}
 */
const readPersistentCachedChunks = (cacheRoot, key, bumpMetric = null) => {
  if (!cacheRoot || !key) return null;
  ensurePersistentChunkCacheRoot(cacheRoot);
  const memo = treeSitterState.persistentChunkCacheMemo;
  if (memo?.has(key)) {
    const chunks = memo.get(key);
    rememberPersistentChunks(key, chunks);
    if (typeof bumpMetric === 'function') bumpMetric('chunkCachePersistentHits', 1);
    return cloneChunkList(chunks);
  }
  const misses = treeSitterState.persistentChunkCacheMisses;
  if (misses?.has(key)) {
    rememberPersistentMiss(key);
    if (typeof bumpMetric === 'function') bumpMetric('chunkCachePersistentMisses', 1);
    return null;
  }
  const paths = resolvePersistentChunkCachePaths(cacheRoot, key);
  try {
    let raw = null, legacy = false;
    for (const filePath of [...new Set([paths.canonical, paths.legacy])]) {
      try { raw = readPersistentPayload(cacheRoot, filePath, key); } catch (error) {
        if (error.code !== 'ENOENT' && typeof bumpMetric === 'function') bumpMetric('chunkCachePersistentErrors', 1);
      }
      if (raw) { legacy = filePath === paths.legacy && paths.legacy !== paths.canonical; break; }
    }
    if (!raw) {
      rememberPersistentMiss(key);
      if (typeof bumpMetric === 'function') bumpMetric('chunkCachePersistentMisses', 1);
      return null;
    }
    const chunks = raw.chunks;
    try {
      if (legacy) {
        assertNoSymlinkPath(cacheRoot, paths.canonical, { allowMissing: true });
        fs.mkdirSync(path.dirname(paths.canonical), { recursive: true });
        assertNoSymlinkPath(cacheRoot, paths.canonical, { allowMissing: true });
        atomicWriteJsonSync(paths.canonical, withGeneratedCacheMetadata(raw, 'tree-sitter-chunks'), { spaces: 0, newline: false, durable: false });
      }
      retireLegacyPayload(cacheRoot, paths, key, chunks);
    } catch { if (typeof bumpMetric === 'function') bumpMetric('chunkCachePersistentMigrationErrors', 1); }
    rememberPersistentChunks(key, chunks);
    misses?.delete?.(key);
    if (typeof bumpMetric === 'function') bumpMetric('chunkCachePersistentHits', 1);
    return cloneChunkList(chunks);
  } catch {
    rememberPersistentMiss(key);
    if (typeof bumpMetric === 'function') bumpMetric('chunkCachePersistentErrors', 1);
    return null;
  }
};

/**
 * Write persistent chunk cache entry using atomic temp-file rename.
 * @param {string|null} cacheRoot
 * @param {string} key
 * @param {Array<object>} chunks
 * @param {(key:string,amount?:number)=>void|null} [bumpMetric=null]
 * @returns {void}
 */
const writePersistentCachedChunks = (cacheRoot, key, chunks, bumpMetric = null) => {
  if (!cacheRoot || !key || !Array.isArray(chunks) || !chunks.length) return;
  ensurePersistentChunkCacheRoot(cacheRoot);
  const filePath = resolvePersistentChunkCachePath(cacheRoot, key);
  if (!filePath) return;
  try {
    assertNoSymlinkPath(path.parse(path.resolve(cacheRoot)).root, cacheRoot, { allowMissing: true });
    fs.mkdirSync(cacheRoot, { recursive: true });
    assertNoSymlinkPath(cacheRoot, filePath, { allowMissing: true });
    const payload = {
      schemaVersion: CHUNK_CACHE_PERSISTENT_SCHEMA,
      cacheKey: key,
      chunks: cloneChunkList(chunks)
    };
    atomicWriteJsonSync(filePath, withGeneratedCacheMetadata(payload, 'tree-sitter-chunks'), {
      spaces: 0,
      newline: false,
      durable: false
    });
    rememberPersistentChunks(key, payload.chunks);
    treeSitterState.persistentChunkCacheMisses?.delete?.(key);
    try { retireLegacyPayload(cacheRoot, resolvePersistentChunkCachePaths(cacheRoot, key), key, payload.chunks); }
    catch { if (typeof bumpMetric === 'function') bumpMetric('chunkCachePersistentMigrationErrors', 1); }
    if (typeof bumpMetric === 'function') bumpMetric('chunkCachePersistentWrites', 1);
  } catch {
    if (typeof bumpMetric === 'function') bumpMetric('chunkCachePersistentErrors', 1);
  }
};

/**
 * Get LRU-managed in-memory cached chunks.
 * @param {Map<string,Array<object>>} cache
 * @param {string} key
 * @param {(key:string,amount?:number)=>void|null} [bumpMetric=null]
 * @returns {Array<object>|null}
 */
const getCachedChunks = (cache, key, bumpMetric = null) => {
  if (!cache?.has?.(key)) {
    if (typeof bumpMetric === 'function') bumpMetric('chunkCacheMisses', 1);
    return null;
  }
  const value = cache.get(key);
  cache.delete(key);
  cache.set(key, value);
  if (typeof bumpMetric === 'function') bumpMetric('chunkCacheHits', 1);
  return Array.isArray(value) ? cloneChunkList(value) : null;
};

/**
 * Set in-memory cache value and evict oldest entries above capacity.
 * @param {Map<string,Array<object>>} cache
 * @param {string} key
 * @param {Array<object>} chunks
 * @param {number} maxEntries
 * @param {(key:string,amount?:number)=>void|null} [bumpMetric=null]
 * @returns {void}
 */
const setCachedChunks = (cache, key, chunks, maxEntries, bumpMetric = null) => {
  if (!Array.isArray(chunks) || !chunks.length) return;
  if (typeof bumpMetric === 'function') bumpMetric('chunkCacheSets', 1);
  cache.set(key, cloneChunkList(chunks));
  while (cache.size > maxEntries) {
    const oldest = cache.keys().next().value;
    if (!oldest) break;
    cache.delete(oldest);
    if (typeof bumpMetric === 'function') bumpMetric('chunkCacheEvictions', 1);
  }
};

/**
 * Load chunks from memory cache first, then optional persistent cache.
 * @param {{cache:Map<string,Array<object>>,key:string,cacheRoot?:string|null,bumpMetric?:(key:string,amount?:number)=>void}} input
 * @returns {Array<object>|null}
 */
export const loadCachedChunks = ({ cache, key, cacheRoot = null, bumpMetric = null }) => {
  const cached = getCachedChunks(cache, key, bumpMetric);
  if (cached) return cached;
  const persistent = readPersistentCachedChunks(cacheRoot, key, bumpMetric);
  if (persistent) {
    setCachedChunks(
      cache,
      key,
      persistent,
      treeSitterState.chunkCacheMaxEntries || DEFAULT_CHUNK_CACHE_MAX_ENTRIES,
      bumpMetric
    );
    return persistent;
  }
  return null;
};

/**
 * Store chunks in memory cache and optional persistent cache.
 * @param {object} input
 * @returns {void}
 */
export const storeCachedChunks = ({
  cache,
  key,
  chunks,
  maxEntries,
  cacheRoot = null,
  bumpMetric = null
}) => {
  setCachedChunks(cache, key, chunks, maxEntries, bumpMetric);
  writePersistentCachedChunks(cacheRoot, key, chunks, bumpMetric);
};
