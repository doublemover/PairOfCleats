import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { sha1 } from '../../../src/shared/hash.js';
import { buildCacheKey as buildUnifiedCacheKey } from '../../../src/shared/cache-key.js';
import { buildEmbeddingIdentity, buildEmbeddingIdentityKey } from '../../../src/shared/embedding-identity.js';
import {
  decodeEmbeddingsCache,
  encodeEmbeddingsCache,
  getEmbeddingsCacheSuffix,
  planEmbeddingsCachePrune,
  resolveEmbeddingsCacheBase,
  resolveEmbeddingsCacheModeDir,
  resolveEmbeddingsCacheRoot
} from '../../../src/shared/embeddings-cache/index.js';
import { writeJsonObjectFile } from '../../../src/shared/json-stream.js';
import { acquireFileLock } from '../../../src/shared/locks/file-lock.js';
import { createTempPath, replaceFile } from './atomic.js';

const CACHE_INDEX_VERSION = 1;
const CACHE_KEY_SCHEMA_VERSION = 'embeddings-cache-v1';
const GLOBAL_CHUNK_CACHE_KEY_SCHEMA_VERSION = 'embeddings-global-chunk-cache-v1';
const DEFAULT_MAX_SHARD_BYTES = 128 * 1024 * 1024;
const CACHE_ENTRY_PREFIX_BYTES = 4;
const CHUNK_HASH_FINGERPRINT_DELIMITER = '\n';
const DEFAULT_LOCK_WAIT_MS = 5000;
const DEFAULT_LOCK_POLL_MS = 100;
const DEFAULT_LOCK_STALE_MS = 30 * 60 * 1000;
const GLOBAL_CHUNK_CACHE_DIR_NAME = 'global-chunks';

const resolveCacheLockPath = (cacheDir) => (
  cacheDir ? path.join(cacheDir, 'cache.lock') : null
);

const withCacheLock = async (cacheDir, worker, options = {}) => {
  const lockPath = resolveCacheLockPath(cacheDir);
  if (!lockPath) return null;
  const waitMs = Number.isFinite(Number(options.waitMs)) ? Math.max(0, Number(options.waitMs)) : DEFAULT_LOCK_WAIT_MS;
  const pollMs = Number.isFinite(Number(options.pollMs)) ? Math.max(1, Number(options.pollMs)) : DEFAULT_LOCK_POLL_MS;
  const staleMs = Number.isFinite(Number(options.staleMs)) ? Math.max(1, Number(options.staleMs)) : DEFAULT_LOCK_STALE_MS;
  const log = typeof options.log === 'function' ? options.log : null;

  const lock = await acquireFileLock({
    lockPath,
    waitMs,
    pollMs,
    staleMs,
    metadata: { scope: 'embeddings-cache' },
    onStale: () => {
      if (log) log(`[embeddings-cache] Removed stale cache lock: ${lockPath}`);
    },
    onBusy: () => {
      if (log) log(`[embeddings-cache] Cache lock timeout: ${lockPath}`);
    }
  });
  if (!lock) return null;
  try {
    return await worker();
  } finally {
    await lock.release();
  }
};

/**
 * Build an embeddings cache identity payload and key.
 * @param {object} [input]
 * @returns {{identity:object,key:string|null}}
 */
export const buildCacheIdentity = (input = {}) => {
  const identity = buildEmbeddingIdentity(input);
  const key = buildEmbeddingIdentityKey(identity);
  return { identity, key };
};

/**
 * Resolve the cache root for embeddings cache.
 * @param {{repoCacheRoot?:string,cacheDirConfig?:string,scope?:string}} input
 * @returns {string}
 */
export const resolveCacheRoot = ({ repoCacheRoot, cacheDirConfig, scope }) => (
  resolveEmbeddingsCacheRoot({ repoCacheRoot, cacheDirConfig, scope })
);

/**
 * Resolve the cache base directory for an identity.
 * @param {string} cacheRoot
 * @param {object} identity
 * @returns {string}
 */
export const resolveCacheBase = (cacheRoot, identity) => resolveEmbeddingsCacheBase({
  cacheRoot,
  provider: identity?.provider,
  modelId: identity?.modelId,
  dims: identity?.dims
});

/**
 * Resolve the mode-specific cache directory.
 * @param {string} cacheRoot
 * @param {object} identity
 * @param {string} mode
 * @returns {string}
 */
export const resolveCacheModeDir = (cacheRoot, identity, mode) => (
  resolveEmbeddingsCacheModeDir(resolveCacheBase(cacheRoot, identity), mode)
);

/**
 * Resolve the cache files directory for a mode.
 * @param {string} cacheRoot
 * @param {object} identity
 * @param {string} mode
 * @returns {string}
 */
export const resolveCacheDir = (cacheRoot, identity, mode) => (
  path.join(resolveCacheModeDir(cacheRoot, identity, mode), 'files')
);

/**
 * Resolve the mode-agnostic content-addressed chunk cache directory.
 * @param {string} cacheRoot
 * @param {object} identity
 * @returns {string}
 */
export const resolveGlobalChunkCacheDir = (cacheRoot, identity) => (
  path.join(resolveCacheBase(cacheRoot, identity), GLOBAL_CHUNK_CACHE_DIR_NAME)
);
/**
 * Resolve the cache metadata path for a mode.
 * @param {string} cacheRoot
 * @param {object} identity
 * @param {string} mode
 * @returns {string}
 */
export const resolveCacheMetaPath = (cacheRoot, identity, mode) => (
  path.join(resolveCacheModeDir(cacheRoot, identity, mode), 'cache.meta.json')
);

/**
 * Resolve the cache index file path.
 * @param {string|null} cacheDir
 * @returns {string|null}
 */
export const resolveCacheIndexPath = (cacheDir) => (
  cacheDir ? path.join(cacheDir, 'cache.index.json') : null
);

/**
 * Resolve the cache shard directory path.
 * @param {string|null} cacheDir
 * @returns {string|null}
 */
export const resolveCacheShardDir = (cacheDir) => (
  cacheDir ? path.join(cacheDir, 'shards') : null
);

/**
 * Resolve a specific cache shard path.
 * @param {string|null} cacheDir
 * @param {string|null} shardName
 * @returns {string|null}
 */
export const resolveCacheShardPath = (cacheDir, shardName) => (
  cacheDir && shardName ? path.join(resolveCacheShardDir(cacheDir), shardName) : null
);

const resolveCacheEntrySuffix = () => getEmbeddingsCacheSuffix();

/**
 * Resolve the cache entry path for a key.
 * @param {string|null} cacheDir
 * @param {string|null} cacheKey
 * @param {{legacy?:boolean}} [options]
 * @returns {string|null}
 */
export const resolveCacheEntryPath = (cacheDir, cacheKey, options = {}) => {
  if (!cacheDir || !cacheKey) return null;
  if (options.legacy) {
    return path.join(cacheDir, `${cacheKey}.json`);
  }
  return path.join(cacheDir, `${cacheKey}${resolveCacheEntrySuffix()}`);
};

/**
 * Read and decode a cache entry file.
 * @param {string|null} filePath
 * @returns {Promise<object|null>}
 */
export const readCacheEntryFile = async (filePath) => {
  if (!filePath) return null;
  if (filePath.endsWith('.json')) {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  }
  const raw = await fs.readFile(filePath);
  return decodeEmbeddingsCache(raw);
};

/**
 * Encode an embeddings cache payload.
 * @param {object} payload
 * @param {object} [options]
 * @returns {Promise<Buffer>}
 */
export const encodeCacheEntryPayload = async (payload, options = {}) => (
  encodeEmbeddingsCache(payload, options)
);

const normalizeChunkHashes = (chunkHashes) => (
  Array.isArray(chunkHashes)
    ? chunkHashes.map((hash) => (typeof hash === 'string' ? hash : ''))
    : null
);

/**
 * Build a compact, stable fingerprint for chunk hash lists.
 * @param {string[]|null|undefined} chunkHashes
 * @returns {string|null}
 */
export const buildChunkHashesFingerprint = (chunkHashes) => {
  const normalized = normalizeChunkHashes(chunkHashes);
  if (!normalized || !normalized.length) return null;
  return sha1(normalized.join(CHUNK_HASH_FINGERPRINT_DELIMITER));
};

/**
 * Create a reusable shard append handle pool for a flush window.
 * @returns {{get:(shardPath:string)=>Promise<{handle:import('node:fs/promises').FileHandle,size:number}>,close:()=>Promise<void>}}
 */
export const createShardAppendHandlePool = () => {
  const handles = new Map();
  return {
    async get(shardPath) {
      let entry = handles.get(shardPath) || null;
      if (!entry) {
        const handle = await fs.open(shardPath, 'a');
        const stat = await handle.stat();
        entry = { handle, size: stat.size };
        handles.set(shardPath, entry);
      }
      return entry;
    },
    async close() {
      for (const entry of handles.values()) {
        try {
          await entry.handle.close();
        } catch {}
      }
      handles.clear();
    }
  };
};

const createCacheIndex = (identityKey) => {
  const now = new Date().toISOString();
  return {
    version: CACHE_INDEX_VERSION,
    identityKey: identityKey || null,
    createdAt: now,
    updatedAt: now,
    nextShardId: 0,
    currentShard: null,
    entries: {},
    files: {},
    shards: {}
  };
};

const normalizeCacheIndex = (index, identityKey) => {
  if (!index || typeof index !== 'object') return createCacheIndex(identityKey);
  if (index.version !== CACHE_INDEX_VERSION) return createCacheIndex(identityKey);
  const normalized = { ...index };
  normalized.identityKey = normalized.identityKey || identityKey || null;
  normalized.entries = { ...(normalized.entries || {}) };
  normalized.files = { ...(normalized.files || {}) };
  normalized.shards = { ...(normalized.shards || {}) };
  normalized.nextShardId = Number.isFinite(Number(normalized.nextShardId))
    ? Math.max(0, Math.floor(Number(normalized.nextShardId)))
    : Object.keys(normalized.shards).length;
  return normalized;
};

/**
 * Read the cache index from disk, falling back to a fresh index on errors.
 * @param {string|null} cacheDir
 * @param {string|null} [identityKey]
 * @returns {Promise<object>}
 */
export const readCacheIndex = async (cacheDir, identityKey = null) => {
  const indexPath = resolveCacheIndexPath(cacheDir);
  if (!indexPath || !fsSync.existsSync(indexPath)) return createCacheIndex(identityKey);
  try {
    const raw = await fs.readFile(indexPath, 'utf8');
    const parsed = normalizeCacheIndex(JSON.parse(raw), identityKey);
    if (identityKey && parsed.identityKey && parsed.identityKey !== identityKey) {
      return createCacheIndex(identityKey);
    }
    return parsed;
  } catch {
    return createCacheIndex(identityKey);
  }
};

/**
 * Persist the cache index to disk.
 * @param {string|null} cacheDir
 * @param {object} index
 * @returns {Promise<void>}
 */
export const writeCacheIndex = async (cacheDir, index) => {
  const indexPath = resolveCacheIndexPath(cacheDir);
  if (!indexPath) return;
  await fs.mkdir(path.dirname(indexPath), { recursive: true });
  await writeJsonObjectFile(indexPath, { fields: index, atomic: true });
};

const readCacheEntryFromShard = async (cacheDir, shardEntry) => {
  const shardPath = resolveCacheShardPath(cacheDir, shardEntry?.shard);
  if (!shardPath || !fsSync.existsSync(shardPath)) return null;
  const handle = await fs.open(shardPath, 'r');
  try {
    const length = Number(shardEntry?.length) || 0;
    const offset = Number(shardEntry?.offset) || 0;
    if (!length || offset < 0) return null;
    const buffer = Buffer.allocUnsafe(length);
    await handle.read(buffer, 0, length, offset);
    return decodeEmbeddingsCache(buffer);
  } finally {
    await handle.close();
  }
};

/**
 * Read a cache entry from shards or standalone files.
 * @param {string|null} cacheDir
 * @param {string|null} cacheKey
 * @param {object|null} [cacheIndex]
 * @returns {Promise<{path:string|null,entry:object|null,indexEntry?:object}>}
 */
export const readCacheEntry = async (cacheDir, cacheKey, cacheIndex = null) => {
  const indexEntry = cacheIndex?.entries?.[cacheKey];
  if (indexEntry?.shard) {
    const entry = await readCacheEntryFromShard(cacheDir, indexEntry);
    if (entry) {
      return { path: resolveCacheShardPath(cacheDir, indexEntry.shard), entry, indexEntry };
    }
  }
  const primaryPath = resolveCacheEntryPath(cacheDir, cacheKey);
  if (primaryPath && fsSync.existsSync(primaryPath)) {
    return { path: primaryPath, entry: await readCacheEntryFile(primaryPath) };
  }
  const legacyPath = resolveCacheEntryPath(cacheDir, cacheKey, { legacy: true });
  if (legacyPath && fsSync.existsSync(legacyPath)) {
    return { path: legacyPath, entry: await readCacheEntryFile(legacyPath) };
  }
  return { path: primaryPath, entry: null };
};

/**
 * Update last access metadata for a cache key.
 * @param {object|null} cacheIndex
 * @param {string|null} cacheKey
 * @returns {object|null}
 */
export const updateCacheIndexAccess = (cacheIndex, cacheKey) => {
  if (!cacheIndex || !cacheKey) return null;
  const entry = cacheIndex.entries?.[cacheKey];
  if (!entry) return null;
  entry.lastAccessAt = new Date().toISOString();
  entry.hits = Number.isFinite(Number(entry.hits)) ? Number(entry.hits) + 1 : 1;
  cacheIndex.entries[cacheKey] = entry;
  cacheIndex.updatedAt = entry.lastAccessAt;
  return entry;
};

const resolveShardName = (shardId) => `shard-${String(shardId).padStart(5, '0')}.bin`;

const allocateShard = (cacheIndex) => {
  const now = new Date().toISOString();
  const shardId = Number.isFinite(Number(cacheIndex.nextShardId))
    ? Math.max(0, Math.floor(Number(cacheIndex.nextShardId)))
    : Object.keys(cacheIndex.shards || {}).length;
  const shardName = resolveShardName(shardId);
  cacheIndex.nextShardId = shardId + 1;
  cacheIndex.currentShard = shardName;
  cacheIndex.shards = { ...(cacheIndex.shards || {}), [shardName]: { createdAt: now, sizeBytes: 0 } };
  return shardName;
};

const selectShardForWrite = (cacheIndex, payloadBytes, maxShardBytes) => {
  const resolvedMax = Number.isFinite(Number(maxShardBytes))
    ? Math.max(1, Math.floor(Number(maxShardBytes)))
    : DEFAULT_MAX_SHARD_BYTES;
  const currentName = cacheIndex.currentShard;
  const currentMeta = currentName ? cacheIndex.shards?.[currentName] : null;
  const currentSize = Number.isFinite(Number(currentMeta?.sizeBytes)) ? Number(currentMeta.sizeBytes) : 0;
  if (!currentName || !currentMeta) {
    return allocateShard(cacheIndex);
  }
  if (currentSize + payloadBytes + CACHE_ENTRY_PREFIX_BYTES > resolvedMax) {
    return allocateShard(cacheIndex);
  }
  return currentName;
};

const appendShardEntryUnlocked = async (cacheDir, cacheIndex, buffer, options = {}) => {
  const shardDir = resolveCacheShardDir(cacheDir);
  if (!shardDir) return null;
  await fs.mkdir(shardDir, { recursive: true });
  const shardName = selectShardForWrite(cacheIndex, buffer.length, options.maxShardBytes);
  const shardPath = resolveCacheShardPath(cacheDir, shardName);
  const prefix = Buffer.allocUnsafe(CACHE_ENTRY_PREFIX_BYTES);
  prefix.writeUInt32LE(buffer.length, 0);
  const payload = Buffer.concat([prefix, buffer]);
  const handlePool = options.shardHandlePool;
  if (handlePool && typeof handlePool.get === 'function') {
    const pooled = await handlePool.get(shardPath);
    /**
     * The lock is acquired per append call (not per pool lifetime), so another process may
     * append between writes. Refresh size each time so returned offsets stay aligned with disk.
     */
    const stat = await pooled.handle.stat();
    const offset = stat.size;
    await pooled.handle.write(payload, 0, payload.length, offset);
    pooled.size = offset + payload.length;
    const shardMeta = cacheIndex.shards?.[shardName] || { createdAt: new Date().toISOString(), sizeBytes: 0 };
    shardMeta.sizeBytes = pooled.size;
    cacheIndex.shards[shardName] = shardMeta;
    return {
      shard: shardName,
      offset: offset + CACHE_ENTRY_PREFIX_BYTES,
      length: buffer.length,
      sizeBytes: payload.length
    };
  }
  const handle = await fs.open(shardPath, 'a');
  try {
    const stat = await handle.stat();
    const offset = stat.size;
    await handle.write(payload, 0, payload.length, offset);
    const totalBytes = payload.length;
    const shardMeta = cacheIndex.shards?.[shardName] || { createdAt: new Date().toISOString(), sizeBytes: 0 };
    shardMeta.sizeBytes = offset + totalBytes;
    cacheIndex.shards[shardName] = shardMeta;
    return {
      shard: shardName,
      offset: offset + CACHE_ENTRY_PREFIX_BYTES,
      length: buffer.length,
      sizeBytes: totalBytes
    };
  } finally {
    await handle.close();
  }
};

const appendShardEntry = async (cacheDir, cacheIndex, buffer, options = {}) => (
  withCacheLock(cacheDir, () => appendShardEntryUnlocked(cacheDir, cacheIndex, buffer, options), options.lock)
);

/**
 * Write a cache entry, optionally appending to a shard.
 * @param {string|null} cacheDir
 * @param {string|null} cacheKey
 * @param {object} payload
 * @param {{index?:object,maxShardBytes?:number}} [options]
 * @returns {Promise<object|null>}
 */
export const writeCacheEntry = async (cacheDir, cacheKey, payload, options = {}) => {
  const targetPath = resolveCacheEntryPath(cacheDir, cacheKey);
  if (!targetPath) return null;
  const tempPath = createTempPath(targetPath);
  try {
    const buffer = Buffer.isBuffer(options.encodedBuffer)
      ? options.encodedBuffer
      : await encodeEmbeddingsCache(payload, options);
    if (options.index) {
      const shardEntry = await appendShardEntry(cacheDir, options.index, buffer, options);
      if (shardEntry) return shardEntry;
    }
    await fs.writeFile(tempPath, buffer);
    await replaceFile(tempPath, targetPath);
    return { path: targetPath, sizeBytes: buffer.length };
  } catch (err) {
    try {
      await fs.rm(tempPath, { force: true });
    } catch {}
    throw err;
  }
};

/**
 * Upsert a cache index entry for a payload.
 * @param {object|null} cacheIndex
 * @param {string|null} cacheKey
 * @param {object} payload
 * @param {object|null} [shardEntry]
 * @returns {object|null}
 */
export const upsertCacheIndexEntry = (cacheIndex, cacheKey, payload, shardEntry = null) => {
  if (!cacheIndex || !cacheKey || !payload) return null;
  const now = new Date().toISOString();
  const existing = cacheIndex.entries?.[cacheKey] || {};
  const hasShard = Boolean(shardEntry?.shard);
  const hasStandalonePath = Boolean(shardEntry?.path);
  const chunkHashesFingerprint = payload.chunkHashesFingerprint
    || buildChunkHashesFingerprint(payload.chunkHashes)
    || existing.chunkHashesFingerprint
    || null;
  const chunkHashesCount = Number.isFinite(Number(payload.chunkHashesCount))
    ? Number(payload.chunkHashesCount)
    : (
      Array.isArray(payload.chunkHashes)
        ? payload.chunkHashes.length
        : (Number.isFinite(Number(existing.chunkHashesCount)) ? Number(existing.chunkHashesCount) : null)
    );
  const chunkCount = Number.isFinite(Number(payload.chunkCount))
    ? Number(payload.chunkCount)
    : (
      Array.isArray(payload.codeVectors)
        ? payload.codeVectors.length
        : (Number.isFinite(Number(existing.chunkCount)) ? Number(existing.chunkCount) : null)
    );
  const next = {
    key: cacheKey,
    file: payload.file || existing.file || null,
    hash: payload.hash || existing.hash || null,
    chunkSignature: payload.chunkSignature || existing.chunkSignature || null,
    shard: hasShard ? shardEntry.shard : (hasStandalonePath ? null : (existing.shard || null)),
    path: hasStandalonePath ? shardEntry.path : (hasShard ? null : (existing.path || null)),
    offset: hasShard
      ? (Number.isFinite(Number(shardEntry?.offset)) ? Number(shardEntry.offset) : null)
      : (hasStandalonePath ? null : (existing.offset || null)),
    length: hasShard
      ? (Number.isFinite(Number(shardEntry?.length)) ? Number(shardEntry.length) : null)
      : (hasStandalonePath ? null : (existing.length || null)),
    sizeBytes: Number.isFinite(Number(shardEntry?.sizeBytes))
      ? Number(shardEntry.sizeBytes)
      : existing.sizeBytes || null,
    chunkCount,
    chunkHashesFingerprint,
    chunkHashesCount,
    createdAt: existing.createdAt || now,
    lastAccessAt: now,
    hits: Number.isFinite(Number(existing.hits)) ? Number(existing.hits) : 0
  };
  cacheIndex.entries = { ...(cacheIndex.entries || {}), [cacheKey]: next };
  if (next.file) {
    cacheIndex.files = { ...(cacheIndex.files || {}), [next.file]: cacheKey };
  }
  cacheIndex.updatedAt = now;
  return next;
};

/**
 * Prune cache entries from disk based on size/age caps.
 * @param {string|null} cacheDir
 * @param {object|null} cacheIndex
 * @param {{maxBytes?:number,maxAgeMs?:number}} [options]
 * @returns {Promise<{removedKeys:string[],removedShards:string[],changed:boolean}>}
 */
export const pruneCacheIndex = async (cacheDir, cacheIndex, options = {}) => {
  if (!cacheDir || !cacheIndex) return { removedKeys: [], removedShards: [], changed: false };
  const maxBytes = Number.isFinite(Number(options.maxBytes)) ? Math.max(0, Number(options.maxBytes)) : 0;
  const maxAgeMs = Number.isFinite(Number(options.maxAgeMs)) ? Math.max(0, Number(options.maxAgeMs)) : 0;
  const deleteShards = options.deleteShards !== false;
  if (!maxBytes && !maxAgeMs) return { removedKeys: [], removedShards: [], changed: false };
  const plan = planEmbeddingsCachePrune({
    entries: cacheIndex.entries || {},
    maxBytes,
    maxAgeMs,
    now: Date.now()
  });
  if (!plan.removeKeys.length) return { removedKeys: [], removedShards: [], changed: false };
  const removeSet = new Set(plan.removeKeys);
  for (const key of plan.removeKeys) {
    if (deleteShards) {
      const cachePath = resolveCacheEntryPath(cacheDir, key);
      if (cachePath) {
        try {
          await fs.rm(cachePath, { force: true });
        } catch {}
      }
      const legacyPath = resolveCacheEntryPath(cacheDir, key, { legacy: true });
      if (legacyPath) {
        try {
          await fs.rm(legacyPath, { force: true });
        } catch {}
      }
    }
    delete cacheIndex.entries?.[key];
  }
  if (cacheIndex.files) {
    for (const [file, key] of Object.entries(cacheIndex.files)) {
      if (removeSet.has(key)) delete cacheIndex.files[file];
    }
  }
  const shardUsage = {};
  for (const entry of Object.values(cacheIndex.entries || {})) {
    if (entry?.shard) {
      shardUsage[entry.shard] = (shardUsage[entry.shard] || 0) + 1;
    }
  }
  const removedShards = [];
  for (const shardName of Object.keys(cacheIndex.shards || {})) {
    if (shardUsage[shardName]) continue;
    const shardPath = resolveCacheShardPath(cacheDir, shardName);
    if (deleteShards && shardPath) {
      try {
        await fs.rm(shardPath, { force: true });
      } catch {}
    }
    removedShards.push(shardName);
    delete cacheIndex.shards[shardName];
    if (cacheIndex.currentShard === shardName) {
      cacheIndex.currentShard = null;
    }
  }
  cacheIndex.updatedAt = new Date().toISOString();
  return { removedKeys: plan.removeKeys, removedShards, changed: true };
};

const parseIsoMillis = (value) => {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const resolveLatestIso = (a, b) => {
  const aMs = parseIsoMillis(a);
  const bMs = parseIsoMillis(b);
  if (aMs && bMs) return aMs >= bMs ? a : b;
  if (aMs) return a;
  if (bMs) return b;
  return a || b || null;
};

const resolveEarliestIso = (a, b) => {
  const aMs = parseIsoMillis(a);
  const bMs = parseIsoMillis(b);
  if (aMs && bMs) return aMs <= bMs ? a : b;
  if (aMs) return a;
  if (bMs) return b;
  return a || b || null;
};

const mergeCacheIndexEntry = (existing = {}, incoming = {}) => {
  const merged = { ...existing };
  for (const [key, value] of Object.entries(incoming)) {
    if (value == null) continue;
    merged[key] = value;
  }
  const hasIncomingShard = Boolean(incoming.shard);
  const hasIncomingPath = Boolean(incoming.path);

  merged.key = incoming.key || existing.key || merged.key || null;
  merged.file = incoming.file || existing.file || merged.file || null;
  merged.hash = incoming.hash || existing.hash || merged.hash || null;
  merged.chunkSignature = incoming.chunkSignature || existing.chunkSignature || merged.chunkSignature || null;
  merged.shard = hasIncomingShard
    ? incoming.shard
    : (hasIncomingPath ? null : (existing.shard || merged.shard || null));
  merged.path = hasIncomingPath
    ? incoming.path
    : (hasIncomingShard ? null : (existing.path || merged.path || null));
  merged.offset = hasIncomingShard
    ? (Number.isFinite(Number(incoming.offset)) ? Number(incoming.offset) : null)
    : (hasIncomingPath
      ? null
      : (Number.isFinite(Number(existing.offset)) ? Number(existing.offset) : merged.offset || null));
  merged.length = hasIncomingShard
    ? (Number.isFinite(Number(incoming.length)) ? Number(incoming.length) : null)
    : (hasIncomingPath
      ? null
      : (Number.isFinite(Number(existing.length)) ? Number(existing.length) : merged.length || null));
  merged.sizeBytes = Number.isFinite(Number(incoming.sizeBytes))
    ? Number(incoming.sizeBytes)
    : (Number.isFinite(Number(existing.sizeBytes)) ? Number(existing.sizeBytes) : merged.sizeBytes || null);
  merged.chunkCount = Number.isFinite(Number(incoming.chunkCount))
    ? Number(incoming.chunkCount)
    : (Number.isFinite(Number(existing.chunkCount)) ? Number(existing.chunkCount) : merged.chunkCount || null);

  merged.createdAt = resolveEarliestIso(existing.createdAt, incoming.createdAt) || merged.createdAt || null;
  merged.lastAccessAt = resolveLatestIso(existing.lastAccessAt, incoming.lastAccessAt) || merged.lastAccessAt || null;
  merged.hits = Math.max(
    Number.isFinite(Number(existing.hits)) ? Number(existing.hits) : 0,
    Number.isFinite(Number(incoming.hits)) ? Number(incoming.hits) : 0
  );

  return merged;
};

const mergeCacheIndex = (base, incoming) => {
  if (!base || typeof base !== 'object') return base;
  if (!incoming || typeof incoming !== 'object') return base;

  base.entries = { ...(base.entries || {}) };
  base.files = { ...(base.files || {}) };
  base.shards = { ...(base.shards || {}) };

  for (const [key, entry] of Object.entries(incoming.entries || {})) {
    const existing = base.entries[key] || null;
    base.entries[key] = existing ? mergeCacheIndexEntry(existing, entry) : entry;
  }

  for (const [file, key] of Object.entries(incoming.files || {})) {
    if (!file || !key) continue;
    base.files[file] = key;
  }

  for (const [shardName, shardMeta] of Object.entries(incoming.shards || {})) {
    const existing = base.shards[shardName] || null;
    if (!existing) {
      base.shards[shardName] = shardMeta;
      continue;
    }
    const createdAt = resolveEarliestIso(existing.createdAt, shardMeta?.createdAt);
    const sizeBytes = Math.max(
      Number.isFinite(Number(existing.sizeBytes)) ? Number(existing.sizeBytes) : 0,
      Number.isFinite(Number(shardMeta?.sizeBytes)) ? Number(shardMeta.sizeBytes) : 0
    );
    base.shards[shardName] = { ...existing, ...shardMeta, createdAt, sizeBytes };
  }

  const baseNext = Number.isFinite(Number(base.nextShardId)) ? Number(base.nextShardId) : 0;
  const incomingNext = Number.isFinite(Number(incoming.nextShardId)) ? Number(incoming.nextShardId) : 0;
  base.nextShardId = Math.max(baseNext, incomingNext);

  if (incoming.currentShard) {
    base.currentShard = incoming.currentShard;
  }

  base.updatedAt = resolveLatestIso(base.updatedAt, incoming.updatedAt) || new Date().toISOString();
  if (!base.createdAt) base.createdAt = incoming.createdAt || base.updatedAt;
  if (!base.identityKey) base.identityKey = incoming.identityKey || null;

  return base;
};

/**
 * Flush cache index changes to disk safely under concurrent builds.
 *
 * We merge the in-memory cache index into the on-disk index under a lock,
 * then optionally prune and persist atomically.
 *
 * @param {string|null} cacheDir
 * @param {object|null} cacheIndex
 * @param {{identityKey?:string|null,maxBytes?:number,maxAgeMs?:number,deleteShards?:boolean,lock?:object}} [options]
 * @returns {Promise<{removedKeys:string[],removedShards:string[],changed:boolean,locked:boolean}>}
 */
export const flushCacheIndex = async (cacheDir, cacheIndex, options = {}) => {
  if (!cacheDir || !cacheIndex) {
    return { removedKeys: [], removedShards: [], changed: false, locked: false };
  }
  const identityKey = options.identityKey || cacheIndex.identityKey || null;
  const lockResult = await withCacheLock(cacheDir, async () => {
    const onDisk = await readCacheIndex(cacheDir, identityKey);
    mergeCacheIndex(onDisk, cacheIndex);
    const pruneResult = await pruneCacheIndex(cacheDir, onDisk, {
      maxBytes: options.maxBytes,
      maxAgeMs: options.maxAgeMs,
      deleteShards: options.deleteShards
    });
    await writeCacheIndex(cacheDir, onDisk);
    for (const key of Object.keys(cacheIndex)) {
      delete cacheIndex[key];
    }
    Object.assign(cacheIndex, onDisk);
    return pruneResult;
  }, options.lock);

  if (!lockResult) {
    return { removedKeys: [], removedShards: [], changed: false, locked: false };
  }

  return { ...lockResult, locked: true };
};
/**
 * Build a stable cache key for an embedding payload.
 * @param {{file?:string,hash?:string,signature?:string,identityKey?:string}} input
 * @returns {string|null}
 */
export const buildCacheKey = ({
  file,
  hash,
  signature,
  identityKey,
  repoId,
  mode,
  featureFlags,
  pathPolicy
}) => {
  if (!hash) return null;
  const keyInfo = buildUnifiedCacheKey({
    repoHash: repoId || null,
    buildConfigHash: identityKey || null,
    mode: mode || null,
    schemaVersion: CACHE_KEY_SCHEMA_VERSION,
    featureFlags: featureFlags || null,
    pathPolicy: pathPolicy || 'posix',
    extra: {
      file: file || null,
      hash,
      signature: signature || null
    }
  });
  return keyInfo.key;
};

/**
 * Build a stable mode-agnostic key for content-addressed chunk payload cache entries.
 * @param {{chunkHash?:string,identityKey?:string,featureFlags?:string[]|null,pathPolicy?:string}} input
 * @returns {string|null}
 */
export const buildGlobalChunkCacheKey = ({
  chunkHash,
  identityKey,
  featureFlags,
  pathPolicy
}) => {
  if (!chunkHash) return null;
  const keyInfo = buildUnifiedCacheKey({
    repoHash: null,
    buildConfigHash: identityKey || null,
    mode: null,
    schemaVersion: GLOBAL_CHUNK_CACHE_KEY_SCHEMA_VERSION,
    featureFlags: featureFlags || null,
    pathPolicy: pathPolicy || 'posix',
    extra: {
      chunkHash
    }
  });
  return keyInfo.digest;
};

/**
 * Validate a cached entry against the current signature and identity.
 * @param {{cached?:object,signature?:string,identityKey?:string,hash?:string}} input
 * @returns {boolean}
 */
export const isCacheValid = ({ cached, signature, identityKey, hash }) => {
  if (!cached || cached.chunkSignature !== signature) return false;
  if (hash && cached.hash && cached.hash !== hash) return false;
  return cached.cacheMeta?.identityKey === identityKey;
};

/**
 * Validate a global content-addressed chunk cache entry.
 * @param {{cached?:object,identityKey?:string,chunkHash?:string}} input
 * @returns {boolean}
 */
export const isGlobalChunkCacheValid = ({ cached, identityKey, chunkHash }) => {
  if (!cached) return false;
  if (chunkHash && cached.hash !== chunkHash) return false;
  if (!identityKey) return Boolean(cached.cacheMeta?.identityKey);
  return cached.cacheMeta?.identityKey === identityKey;
};

/**
 * Read cache metadata from disk.
 * @param {string} cacheRoot
 * @param {object} identity
 * @param {string} mode
 * @returns {object|null}
 */
export const readCacheMeta = (cacheRoot, identity, mode) => {
  const metaPath = resolveCacheMetaPath(cacheRoot, identity, mode);
  if (!metaPath || !fsSync.existsSync(metaPath)) return null;
  try {
    const raw = fsSync.readFileSync(metaPath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

/**
 * Write cache metadata to disk.
 * @param {string} cacheRoot
 * @param {object} identity
 * @param {string} mode
 * @param {object} meta
 * @returns {Promise<void>}
 */
export const writeCacheMeta = async (cacheRoot, identity, mode, meta) => {
  const metaPath = resolveCacheMetaPath(cacheRoot, identity, mode);
  if (!metaPath) return;
  await fs.mkdir(path.dirname(metaPath), { recursive: true });
  await writeJsonObjectFile(metaPath, { fields: meta, atomic: true });
};

/**
 * Decide whether a cache lookup can be rejected using only cache.index.json metadata.
 * This avoids reading shard payloads or standalone cache entry files for known mismatches.
 *
 * Note: when no index entry exists we must not fast-reject, because legacy standalone cache
 * entries may exist without an index entry.
 *
 * @param {{
 *  cacheIndex?:object|null,
 *  cacheKey?:string|null,
 *  identityKey?:string|null,
 *  fileHash?:string|null,
 *  chunkSignature?:string|null
 * }} input
 * @returns {boolean}
 */
export const shouldFastRejectCacheLookup = ({
  cacheIndex,
  cacheKey,
  identityKey,
  fileHash,
  chunkSignature,
  chunkHashesFingerprint
} = {}) => {
  if (!cacheIndex || typeof cacheIndex !== 'object') return false;
  if (!cacheKey) return false;
  const indexEntry = cacheIndex?.entries?.[cacheKey] || null;
  if (!indexEntry) return false;

  const indexIdentityKey = cacheIndex?.identityKey || null;
  if (identityKey && indexIdentityKey && indexIdentityKey !== identityKey) return true;
  if (fileHash && indexEntry?.hash && indexEntry.hash !== fileHash) return true;
  if (chunkSignature && indexEntry?.chunkSignature && indexEntry.chunkSignature !== chunkSignature) return true;
  if (
    chunkHashesFingerprint
    && indexEntry?.chunkHashesFingerprint
    && indexEntry.chunkHashesFingerprint !== chunkHashesFingerprint
  ) {
    return true;
  }

  return false;
};
