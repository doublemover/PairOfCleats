import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { deserialize as deserializeV8, serialize as serializeV8 } from 'node:v8';
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
import {
  createCacheIndex,
  mergeCacheIndex,
  normalizeCacheIndex,
  resolveNextShardIdFromShards
} from './cache/index-state.js';

const CACHE_KEY_SCHEMA_VERSION = 'embeddings-cache-v1';
const GLOBAL_CHUNK_CACHE_KEY_SCHEMA_VERSION = 'embeddings-global-chunk-cache-v1';
const DEFAULT_MAX_SHARD_BYTES = 128 * 1024 * 1024;
const CACHE_ENTRY_PREFIX_BYTES = 4;
const CHUNK_HASH_FINGERPRINT_DELIMITER = '\n';
const DEFAULT_LOCK_WAIT_MS = 5000;
const DEFAULT_LOCK_POLL_MS = 100;
const DEFAULT_LOCK_STALE_MS = 30 * 60 * 1000;
const shardReadFailureCache = new WeakMap();

/**
 * @typedef {object} CacheLockOptions
 * @property {number} [waitMs]
 * @property {number} [pollMs]
 * @property {number} [staleMs]
 * @property {(line:string)=>void} [log]
 */

/**
 * @typedef {object} CacheShardEntry
 * @property {string} shard
 * @property {number} offset
 * @property {number} length
 * @property {number} sizeBytes
 */

/**
 * Resolve on-disk lock file path for a cache directory.
 *
 * @param {string|null} cacheDir
 * @returns {string|null}
 */
const resolveCacheLockPath = (cacheDir) => (
  cacheDir ? path.join(cacheDir, 'cache.lock') : null
);

/**
 * Run a cache mutation under a cross-process file lock.
 *
 * Returns `null` when a lock cannot be acquired within timeout so callers can
 * choose a non-fatal fallback path.
 *
 * @template T
 * @param {string|null} cacheDir
 * @param {() => Promise<T>} worker
 * @param {CacheLockOptions} [options]
 * @returns {Promise<T|null>}
 */
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
 * Resolve the mode-agnostic global chunk cache directory.
 *
 * @param {string} cacheRoot
 * @param {object} identity
 * @returns {string}
 */
export const resolveGlobalChunkCacheDir = (cacheRoot, identity) => (
  path.join(resolveCacheBase(cacheRoot, identity), 'global-chunks')
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
 * Resolve the binary cache index file path.
 * @param {string|null} cacheDir
 * @returns {string|null}
 */
export const resolveCacheIndexBinaryPath = (cacheDir) => (
  cacheDir ? path.join(cacheDir, 'cache.index.v8') : null
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

/**
 * Normalize chunk hash arrays into stable string lists.
 *
 * @param {unknown} chunkHashes
 * @returns {string[]|null}
 */
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

/**
 * Read the cache index from disk, falling back to a fresh index on errors.
 * @param {string|null} cacheDir
 * @param {string|null} [identityKey]
 * @returns {Promise<object>}
 */
export const readCacheIndex = async (cacheDir, identityKey = null) => {
  const binaryPath = resolveCacheIndexBinaryPath(cacheDir);
  const indexPath = resolveCacheIndexPath(cacheDir);
  if (binaryPath && fsSync.existsSync(binaryPath)) {
    try {
      const rawBinary = await fs.readFile(binaryPath);
      const decodedBinary = decodeCacheIndexBinary(rawBinary);
      if (decodedBinary) {
        const parsedBinary = normalizeCacheIndex(decodedBinary, identityKey);
        if (identityKey && parsedBinary.identityKey && parsedBinary.identityKey !== identityKey) {
          return createCacheIndex(identityKey);
        }
        return parsedBinary;
      }
    } catch {
      // Fallback to JSON index.
    }
  }
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
  const binaryPath = resolveCacheIndexBinaryPath(cacheDir);
  if (!indexPath) return;
  await fs.mkdir(path.dirname(indexPath), { recursive: true });
  if (binaryPath) {
    await writeBinaryFileAtomic(binaryPath, encodeCacheIndexBinary(index));
  }
  await writeJsonObjectFile(indexPath, { fields: index, atomic: true });
};

/**
 * Build stable shard pointer fingerprint used for failed-read memoization.
 *
 * @param {object|null|undefined} indexEntry
 * @returns {string|null}
 */
const buildShardPointerFingerprint = (indexEntry) => {
  if (!indexEntry?.shard) return null;
  const offset = Number.isFinite(Number(indexEntry.offset)) ? Number(indexEntry.offset) : -1;
  const length = Number.isFinite(Number(indexEntry.length)) ? Number(indexEntry.length) : -1;
  return `${indexEntry.shard}:${offset}:${length}`;
};

/**
 * Get per-cache-index set of shard pointers that already failed to decode.
 *
 * @param {object|null} cacheIndex
 * @returns {Set<string>|null}
 */
const getFailedShardPointers = (cacheIndex) => {
  if (!cacheIndex || typeof cacheIndex !== 'object') return null;
  if (shardReadFailureCache.has(cacheIndex)) {
    return shardReadFailureCache.get(cacheIndex);
  }
  const failures = new Set();
  shardReadFailureCache.set(cacheIndex, failures);
  return failures;
};

/**
 * Switch one index entry from shard pointer to a standalone cache file path.
 *
 * @param {object|null} cacheIndex
 * @param {string|null} cacheKey
 * @param {string|null} entryPath
 * @returns {void}
 */
const repairShardIndexEntryToStandalonePath = (cacheIndex, cacheKey, entryPath) => {
  if (!cacheIndex || !cacheKey || !entryPath) return;
  const existing = cacheIndex?.entries?.[cacheKey];
  if (!existing || !existing.shard) return;
  cacheIndex.entries[cacheKey] = {
    ...existing,
    shard: null,
    offset: null,
    length: null,
    path: entryPath
  };
  cacheIndex.updatedAt = new Date().toISOString();
};

/**
 * Repoint one cache index entry to a standalone file path.
 *
 * Unlike shard-only repairs, this also handles stale standalone pointers when
 * fallback reads promote from primary to legacy entry paths.
 *
 * @param {object|null} cacheIndex
 * @param {string|null} cacheKey
 * @param {string|null} entryPath
 * @returns {void}
 */
const repointCacheIndexEntryPath = (cacheIndex, cacheKey, entryPath) => {
  if (!cacheIndex || !cacheKey || !entryPath) return;
  const existing = cacheIndex?.entries?.[cacheKey];
  if (!existing || existing.path === entryPath) return;
  cacheIndex.entries[cacheKey] = {
    ...existing,
    shard: null,
    offset: null,
    length: null,
    path: entryPath
  };
  cacheIndex.updatedAt = new Date().toISOString();
};

/**
 * Read one encoded payload from a shard index pointer.
 *
 * @param {string|null} cacheDir
 * @param {{shard?:string,offset?:number,length?:number}|null} shardEntry
 * @returns {Promise<object|null>}
 */
const readCacheEntryFromShard = async (cacheDir, shardEntry) => {
  const shardPath = resolveCacheShardPath(cacheDir, shardEntry?.shard);
  if (!shardPath || !fsSync.existsSync(shardPath)) return null;
  const handle = await fs.open(shardPath, 'r');
  try {
    const length = Number(shardEntry?.length) || 0;
    const offset = Number(shardEntry?.offset) || 0;
    if (!length || offset < 0) return null;
    const stat = await handle.stat();
    if (!Number.isFinite(stat?.size) || (offset + length) > stat.size) {
      return null;
    }
    const buffer = Buffer.alloc(length);
    let totalRead = 0;
    while (totalRead < length) {
      const { bytesRead } = await handle.read(
        buffer,
        totalRead,
        length - totalRead,
        offset + totalRead
      );
      if (!bytesRead) break;
      totalRead += bytesRead;
    }
    if (totalRead !== length) return null;
    try {
      return decodeEmbeddingsCache(buffer);
    } catch {
      return null;
    }
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
  const failedShardPointers = getFailedShardPointers(cacheIndex);
  const shardPointerFingerprint = buildShardPointerFingerprint(indexEntry);
  const shardFailureKey = shardPointerFingerprint && cacheKey
    ? `${cacheKey}:${shardPointerFingerprint}`
    : null;
  const shouldTryShard = Boolean(indexEntry?.shard && (!failedShardPointers || !failedShardPointers.has(shardFailureKey)));
  if (shouldTryShard) {
    const entry = await readCacheEntryFromShard(cacheDir, indexEntry);
    if (entry) {
      if (failedShardPointers && shardFailureKey) {
        failedShardPointers.delete(shardFailureKey);
      }
      return { path: resolveCacheShardPath(cacheDir, indexEntry.shard), entry, indexEntry };
    }
    if (failedShardPointers && shardFailureKey) {
      failedShardPointers.add(shardFailureKey);
    }
  }
  const primaryPath = resolveCacheEntryPath(cacheDir, cacheKey);
  if (primaryPath && fsSync.existsSync(primaryPath)) {
    try {
      repairShardIndexEntryToStandalonePath(cacheIndex, cacheKey, primaryPath);
      return { path: primaryPath, entry: await readCacheEntryFile(primaryPath) };
    } catch {
      try {
        await fs.rm(primaryPath, { force: true });
      } catch {}
    }
  }
  const legacyPath = resolveCacheEntryPath(cacheDir, cacheKey, { legacy: true });
  if (legacyPath && fsSync.existsSync(legacyPath)) {
    try {
      repairShardIndexEntryToStandalonePath(cacheIndex, cacheKey, legacyPath);
      repointCacheIndexEntryPath(cacheIndex, cacheKey, legacyPath);
      return { path: legacyPath, entry: await readCacheEntryFile(legacyPath) };
    } catch {
      try {
        await fs.rm(legacyPath, { force: true });
      } catch {}
    }
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

/**
 * Format monotonically increasing shard filename from shard id.
 *
 * @param {number} shardId
 * @returns {string}
 */
const resolveShardName = (shardId) => `shard-${String(shardId).padStart(5, '0')}.bin`;

/**
 * Allocate and register a new active shard in the cache index.
 *
 * @param {object} cacheIndex
 * @returns {string}
 */
const allocateShard = (cacheIndex) => {
  const now = new Date().toISOString();
  const configuredNextShardId = Number.isFinite(Number(cacheIndex.nextShardId))
    ? Math.max(0, Math.floor(Number(cacheIndex.nextShardId)))
    : 0;
  const derivedNextShardId = resolveNextShardIdFromShards(cacheIndex.shards || {});
  const shardId = Math.max(configuredNextShardId, derivedNextShardId);
  const shardName = resolveShardName(shardId);
  cacheIndex.nextShardId = shardId + 1;
  cacheIndex.currentShard = shardName;
  cacheIndex.shards = { ...(cacheIndex.shards || {}), [shardName]: { createdAt: now, sizeBytes: 0 } };
  return shardName;
};

/**
 * Pick current shard when space allows, otherwise rotate to a new shard.
 *
 * @param {object} cacheIndex
 * @param {number} payloadBytes
 * @param {number} [maxShardBytes]
 * @returns {string}
 */
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

/**
 * Append an encoded cache payload to the active shard and return index metadata.
 *
 * Caller must hold the cache lock while this runs.
 *
 * @param {string|null} cacheDir
 * @param {object} cacheIndex
 * @param {Buffer} buffer
 * @param {{maxShardBytes?:number,shardHandlePool?:{get:(shardPath:string)=>Promise<{handle:import('node:fs/promises').FileHandle,size:number}>}}} [options]
 * @returns {Promise<CacheShardEntry|null>}
 */
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

/**
 * Append a payload to a shard under lock protection.
 *
 * @param {string|null} cacheDir
 * @param {object} cacheIndex
 * @param {Buffer} buffer
 * @param {{lock?:CacheLockOptions,maxShardBytes?:number,shardHandlePool?:{get:(shardPath:string)=>Promise<{handle:import('node:fs/promises').FileHandle,size:number}>}}} [options]
 * @returns {Promise<CacheShardEntry|null>}
 */
const appendShardEntry = async (cacheDir, cacheIndex, buffer, options = {}) => (
  withCacheLock(cacheDir, () => appendShardEntryUnlocked(cacheDir, cacheIndex, buffer, options), options.lock)
);

/**
 * Write a cache entry, optionally appending to a shard.
 * @param {string|null} cacheDir
 * @param {string|null} cacheKey
 * @param {object} payload
 * @param {{
 *   index?:object,
 *   maxShardBytes?:number,
 *   encodedBuffer?:Buffer,
 *   lock?:CacheLockOptions,
 *   shardHandlePool?:{get:(shardPath:string)=>Promise<{handle:import('node:fs/promises').FileHandle,size:number}>}
 * }} [options]
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
  const previousFile = typeof existing.file === 'string' && existing.file
    ? existing.file
    : null;
  cacheIndex.entries = { ...(cacheIndex.entries || {}), [cacheKey]: next };
  const nextFiles = { ...(cacheIndex.files || {}) };
  if (previousFile && previousFile !== next.file && nextFiles[previousFile] === cacheKey) {
    delete nextFiles[previousFile];
  }
  if (next.file) {
    nextFiles[next.file] = cacheKey;
  }
  cacheIndex.files = nextFiles;
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

/**
 * Flush cache index changes to disk safely under concurrent builds.
 *
 * We merge the in-memory cache index into the on-disk index under a lock,
 * then optionally prune and persist atomically.
 *
 * @param {string|null} cacheDir
 * @param {object|null} cacheIndex
 * @param {{
 *   identityKey?:string|null,
 *   maxBytes?:number,
 *   maxAgeMs?:number,
 *   deleteShards?:boolean,
 *   lock?:CacheLockOptions
 * }} [options]
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
 * Build a mode-agnostic cache key for reusable global chunk payloads.
 *
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
    mode: 'global-chunk',
    schemaVersion: GLOBAL_CHUNK_CACHE_KEY_SCHEMA_VERSION,
    featureFlags: featureFlags || null,
    pathPolicy: pathPolicy || 'posix',
    extra: {
      chunkHash
    }
  });
  return `global-chunk-${keyInfo.version}-${keyInfo.digest}`;
};

/**
 * Validate a mode-agnostic global chunk cache entry.
 *
 * @param {{cached?:object,identityKey?:string,chunkHash?:string}} input
 * @returns {boolean}
 */
export const isGlobalChunkCacheValid = ({ cached, identityKey, chunkHash }) => {
  if (!cached || !chunkHash) return false;
  if (!cached.hash || cached.hash !== chunkHash) return false;
  return cached.cacheMeta?.identityKey === identityKey;
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
 * Decide whether a cache lookup can be rejected using only cache index metadata.
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
  if (!identityKey && indexIdentityKey) return true;
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
