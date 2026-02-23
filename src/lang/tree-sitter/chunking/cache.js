import fs from 'node:fs';
import path from 'node:path';
import { buildLocalCacheKey } from '../../../shared/cache-key.js';
import { treeSitterState } from '../state.js';

const DEFAULT_CHUNK_CACHE_MAX_ENTRIES = 64;
const CHUNK_CACHE_PERSISTENT_SCHEMA = '1.0.0';

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

export const resolveChunkCacheKey = (options, resolvedId) => {
  if (options?.treeSitter?.chunkCache === false) return null;
  const rawKey = options?.treeSitterCacheKey ?? options?.treeSitter?.cacheKey ?? null;
  if (rawKey == null || rawKey === '') return null;
  const base = typeof rawKey === 'string' ? rawKey : String(rawKey);
  if (!base) return null;
  return buildLocalCacheKey({
    namespace: 'tree-sitter-chunk',
    payload: {
      languageId: resolvedId,
      key: base,
      signature: buildChunkCacheSignature(options, resolvedId)
    }
  }).key;
};

const resolveChunkCacheMaxEntries = (options) => {
  const raw = options?.treeSitter?.chunkCacheMaxEntries
    ?? options?.treeSitter?.chunkCache?.maxEntries
    ?? DEFAULT_CHUNK_CACHE_MAX_ENTRIES;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_CHUNK_CACHE_MAX_ENTRIES;
  return Math.max(1, Math.floor(parsed));
};

export const ensureChunkCache = (options) => {
  const maxEntries = resolveChunkCacheMaxEntries(options);
  if (!treeSitterState.chunkCache) treeSitterState.chunkCache = new Map();
  if (treeSitterState.chunkCacheMaxEntries !== maxEntries) {
    treeSitterState.chunkCache.clear();
    treeSitterState.chunkCacheMaxEntries = maxEntries;
  }
  return { cache: treeSitterState.chunkCache, maxEntries };
};

const ensurePersistentChunkCacheRoot = (cacheRoot) => {
  if (!cacheRoot || typeof cacheRoot !== 'string') return null;
  if (treeSitterState.persistentChunkCacheRoot === cacheRoot) return cacheRoot;
  treeSitterState.persistentChunkCacheRoot = cacheRoot;
  treeSitterState.persistentChunkCacheMemo = new Map();
  treeSitterState.persistentChunkCacheMisses = new Set();
  return cacheRoot;
};

export const resolvePersistentChunkCacheRoot = (options) => {
  const cfg = options?.treeSitter || {};
  if (cfg.cachePersistent !== true) return null;
  const dir = typeof cfg.cachePersistentDir === 'string'
    ? cfg.cachePersistentDir.trim()
    : '';
  if (!dir) return null;
  return ensurePersistentChunkCacheRoot(path.resolve(dir));
};

const resolvePersistentChunkCachePath = (cacheRoot, key) => {
  if (!cacheRoot || !key) return null;
  const safeKey = String(key).replace(/[^a-zA-Z0-9._-]/g, '_');
  const shard = safeKey.slice(0, 2) || '00';
  return path.join(cacheRoot, shard, `${safeKey}.json`);
};

const cloneChunkList = (chunks) => chunks.map((chunk) => ({
  ...chunk,
  ...(chunk?.meta ? { meta: { ...chunk.meta } } : {})
}));

const readPersistentCachedChunks = (cacheRoot, key, bumpMetric = null) => {
  if (!cacheRoot || !key) return null;
  const memo = treeSitterState.persistentChunkCacheMemo;
  if (memo?.has(key)) {
    if (typeof bumpMetric === 'function') bumpMetric('chunkCachePersistentHits', 1);
    return cloneChunkList(memo.get(key));
  }
  const misses = treeSitterState.persistentChunkCacheMisses;
  if (misses?.has(key)) {
    if (typeof bumpMetric === 'function') bumpMetric('chunkCachePersistentMisses', 1);
    return null;
  }
  const filePath = resolvePersistentChunkCachePath(cacheRoot, key);
  if (!filePath || !fs.existsSync(filePath)) {
    misses?.add?.(key);
    if (typeof bumpMetric === 'function') bumpMetric('chunkCachePersistentMisses', 1);
    return null;
  }
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!raw || raw.schemaVersion !== CHUNK_CACHE_PERSISTENT_SCHEMA || raw.cacheKey !== key) {
      misses?.add?.(key);
      if (typeof bumpMetric === 'function') bumpMetric('chunkCachePersistentMisses', 1);
      return null;
    }
    const chunks = Array.isArray(raw.chunks) ? raw.chunks : null;
    if (!chunks || !chunks.length) {
      misses?.add?.(key);
      if (typeof bumpMetric === 'function') bumpMetric('chunkCachePersistentMisses', 1);
      return null;
    }
    memo?.set?.(key, chunks);
    misses?.delete?.(key);
    if (typeof bumpMetric === 'function') bumpMetric('chunkCachePersistentHits', 1);
    return cloneChunkList(chunks);
  } catch {
    misses?.add?.(key);
    if (typeof bumpMetric === 'function') bumpMetric('chunkCachePersistentErrors', 1);
    return null;
  }
};

const writePersistentCachedChunks = (cacheRoot, key, chunks, bumpMetric = null) => {
  if (!cacheRoot || !key || !Array.isArray(chunks) || !chunks.length) return;
  const filePath = resolvePersistentChunkCachePath(cacheRoot, key);
  if (!filePath) return;
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.${process.pid}.tmp`;
    const payload = {
      schemaVersion: CHUNK_CACHE_PERSISTENT_SCHEMA,
      cacheKey: key,
      chunks: cloneChunkList(chunks)
    };
    fs.writeFileSync(tempPath, JSON.stringify(payload), 'utf8');
    fs.renameSync(tempPath, filePath);
    treeSitterState.persistentChunkCacheMemo?.set?.(key, payload.chunks);
    treeSitterState.persistentChunkCacheMisses?.delete?.(key);
    if (typeof bumpMetric === 'function') bumpMetric('chunkCachePersistentWrites', 1);
  } catch {
    if (typeof bumpMetric === 'function') bumpMetric('chunkCachePersistentErrors', 1);
  }
};

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
