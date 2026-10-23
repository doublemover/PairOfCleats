import { createCachePhysicalStorage } from './cache/physical-storage.js';
import { EMBEDDING_CHUNK_INPUT_VERSION, hasCurrentEmbeddingChunkInput } from '../../../src/shared/embedding-chunk-input.js';
import { readEmbeddingIndex, checkpointEmbeddingIndex, appendEmbeddingIndexDelta, syncEmbeddingIndexDelta } from './cache/index-log.js';
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
import { writeJsonObjectFile } from '../../../src/shared/json-stream/json-writers.js';
import { withFileLock } from '../../../src/shared/locks/file-lock.js';
import { withEmbeddingProfileAccess } from './cache/profile-access.js';
import { withEmbeddingProfileMutation, withEmbeddingProfileMaintenance } from './cache/profile-retention.js';
export { createShardAppendHandlePool } from './cache/shard-handles.js';
import { createTempPath, replaceFile } from './atomic.js';
import {
  mergeCacheIndex,
  resolveNextShardIdFromShards
} from './cache/index-state.js';
import { resolveEmbeddingCacheProfile } from '../../../src/shared/embeddings-cache/layout.js';
import { createReferenceCacheWriter, collectReferenceProtection } from './cache/file-references.js';
import { readCacheEntries as readReferenceEntries } from './cache/batch-reader.js';
import { buildCachePhysicalSummary, compareCachePhysicalAge } from './cache/physical-summary.js';
import { assertNoSymlinkPath, verifyContainedFileHandle, readVerifiedContainedFile, withContainedFile } from '../../../src/shared/contained-file.js';
import { createContainedFileResource } from '../../../src/shared/contained-file-resource.js';

const CACHE_KEY_SCHEMA_VERSION = 'embeddings-cache-v2';
const GLOBAL_CHUNK_CACHE_KEY_SCHEMA_VERSION = 'embeddings-global-chunk-cache-v3';
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
  assertNoSymlinkPath(path.parse(path.resolve(cacheDir)).root, cacheDir, { allowMissing: true });
  const waitMs = Number.isFinite(Number(options.waitMs)) ? Math.max(0, Number(options.waitMs)) : DEFAULT_LOCK_WAIT_MS;
  const pollMs = Number.isFinite(Number(options.pollMs)) ? Math.max(1, Number(options.pollMs)) : DEFAULT_LOCK_POLL_MS;
  const staleMs = Number.isFinite(Number(options.staleMs)) ? Math.max(1, Number(options.staleMs)) : DEFAULT_LOCK_STALE_MS;
  const log = typeof options.log === 'function' ? options.log : null;

  return withEmbeddingProfileAccess(cacheDir, () => withFileLock({
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
  }, worker));
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
  dims: identity?.dims,
  identity
});
export const resolveLegacyCacheDir = (cacheRoot, identity, mode) => path.join(resolveEmbeddingCacheProfile({ cacheRoot, identity }).legacy,
  mode === 'global-chunks' ? 'global-chunks' : path.join(path.basename(resolveEmbeddingsCacheModeDir('', mode)), 'files'));
export const resolvePriorCacheDir = (cacheRoot, identity, mode) => path.join(resolveEmbeddingCacheProfile({ cacheRoot, identity }).prior,
  mode === 'global-chunks' ? 'global-chunks' : path.join(path.basename(resolveEmbeddingsCacheModeDir('', mode)), 'files'));
export const resolveCacheReadFallbacks = async (cacheRoot, identity, mode, identityKey, options = {}) => {
  const results = await Promise.allSettled([resolvePriorCacheDir(cacheRoot, identity, mode), resolveLegacyCacheDir(cacheRoot, identity, mode)]
    .map(async cacheDir => ({ cacheDir, cacheIndex: await readCacheIndex(cacheDir, identityKey, options), allowUnindexedStandalone: true })));
  const failures = results.filter(result => result.status === 'rejected').map(result => result.reason);
  if (failures.length === 1) throw failures[0];
  if (failures.length) throw new AggregateError(failures, 'Embedding fallback inventories failed.', { cause: failures[0] });
  return results.map(result => result.value);
};

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
 * Resolve binary sidecar path for cache index payload.
 * @param {string|null} cacheDir
 * @returns {string|null}
 */
export const resolveCacheIndexBinaryPath = (cacheDir) => (
  cacheDir ? path.join(cacheDir, 'cache.index.bin') : null
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
  cacheDir && /^shard-\d{5,}\.bin$/.test(shardName || '') ? path.join(resolveCacheShardDir(cacheDir), shardName) : null
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
  if (!cacheDir || !/^[A-Za-z0-9_-]{1,256}$/.test(cacheKey || '')) return null;
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
export const readCacheEntryFile = async (filePath, { maxBytes = 64 * 1024 * 1024 } = {}) => {
  if (!filePath) return null;
  const { buffer: raw } = await readVerifiedContainedFile(path.dirname(filePath), filePath, { maxBytes });
  if (filePath.endsWith('.json')) {
    return JSON.parse(raw.toString('utf8'));
  }
  return decodeEmbeddingsCache(raw, { maxBytes });
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
/**
 * Read the cache index from disk, falling back to a fresh index on errors.
 * @param {string|null} cacheDir
 * @param {string|null} [identityKey]
 * @returns {Promise<object>}
 */
export const readCacheIndex = (cacheDir, identityKey = null, options = {}) => withEmbeddingProfileAccess(cacheDir,
  () => readEmbeddingIndex(cacheDir, identityKey, options));
const readCacheIndexForUpdate = (cacheDir, identityKey = null) => readEmbeddingIndex(cacheDir, identityKey, { forUpdate: true });
export const writeCacheIndex = (directory, index) => withEmbeddingProfileMutation(directory,
  Buffer.byteLength(JSON.stringify(index)) * 3 + 4096, () => checkpointEmbeddingIndex(directory, index));

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
const readCacheEntryFromShard = async (cacheDir, shardEntry, maxBytes) => {
  const shardPath = resolveCacheShardPath(cacheDir, shardEntry?.shard);
  if (!shardPath || !fsSync.existsSync(shardPath)) return null;
  return withContainedFile(cacheDir, shardPath, async handle => {
    const length = Number(shardEntry?.length) || 0;
    const offset = Number(shardEntry?.offset) || 0;
    if (!Number.isSafeInteger(length) || length <= 0 || length > maxBytes || !Number.isSafeInteger(offset) || offset < 0) return null;
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
    handle.verify();
    try {
      return await decodeEmbeddingsCache(buffer, { maxBytes });
    } catch {
      return null;
    }
  });
};

/**
 * Read a cache entry from shards or standalone files.
 * @param {string|null} cacheDir
 * @param {string|null} cacheKey
 * @param {object|null} [cacheIndex]
 * @returns {Promise<{path:string|null,entry:object|null,indexEntry?:object}>}
 */
export const readCacheEntry = (cacheDir, cacheKey, cacheIndex = null, { maxBytes = 64 * 1024 * 1024 } = {}) => withEmbeddingProfileAccess(cacheDir,
  () => readCacheEntryUnlocked(cacheDir, cacheKey, cacheIndex, maxBytes));
const readCacheEntryUnlocked = async (cacheDir, cacheKey, cacheIndex, maxBytes) => {
  const indexEntry = cacheIndex?.entries?.[cacheKey];
  const failedShardPointers = getFailedShardPointers(cacheIndex);
  const shardPointerFingerprint = buildShardPointerFingerprint(indexEntry);
  const shardFailureKey = shardPointerFingerprint && cacheKey
    ? `${cacheKey}:${shardPointerFingerprint}`
    : null;
  const shouldTryShard = Boolean(indexEntry?.shard && (!failedShardPointers || !failedShardPointers.has(shardFailureKey)));
  if (shouldTryShard) {
    const entry = await readCacheEntryFromShard(cacheDir, indexEntry, maxBytes);
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
      return { path: primaryPath, entry: await readCacheEntryFile(primaryPath, { maxBytes }) };
    } catch (error) { if (error.cacheOwnershipPending || error instanceof AggregateError) throw error; }
  }
  const legacyPath = resolveCacheEntryPath(cacheDir, cacheKey, { legacy: true });
  if (legacyPath && fsSync.existsSync(legacyPath)) {
    try {
      repairShardIndexEntryToStandalonePath(cacheIndex, cacheKey, legacyPath);
      repointCacheIndexEntryPath(cacheIndex, cacheKey, legacyPath);
      return { path: legacyPath, entry: await readCacheEntryFile(legacyPath, { maxBytes }) };
    } catch (error) { if (error.cacheOwnershipPending || error instanceof AggregateError) throw error; }
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
const selectShardForWrite = async (cacheDir, cacheIndex, payloadBytes, maxShardBytes) => {
  const resolvedMax = Number.isFinite(Number(maxShardBytes))
    ? Math.max(1, Math.floor(Number(maxShardBytes)))
    : DEFAULT_MAX_SHARD_BYTES;
  let shardName = cacheIndex.currentShard;
  if (!shardName || !cacheIndex.shards?.[shardName]) shardName = allocateShard(cacheIndex);
  for (;;) {
    let actualSize = 0;
    try {
      const stat = await fs.stat(resolveCacheShardPath(cacheDir, shardName));
      if (!stat.isFile()) throw new Error(`Embedding cache shard is not a regular file: ${shardName}`);
      actualSize = stat.size;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    cacheIndex.shards[shardName].sizeBytes = actualSize;
    // A single oversized entry may own an otherwise empty shard, as before.
    // Never append to a full shard based on an unflushed writer's stale index.
    if (actualSize === 0 || actualSize + payloadBytes + CACHE_ENTRY_PREFIX_BYTES <= resolvedMax) return shardName;
    shardName = allocateShard(cacheIndex);
  }
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
  assertNoSymlinkPath(cacheDir, shardDir, { allowMissing: true });
  await fs.mkdir(shardDir, { recursive: true });
  const shardName = await selectShardForWrite(cacheDir, cacheIndex, buffer.length, options.maxShardBytes);
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
    if (stat.nlink !== 1) throw new Error('Embedding shard append refuses unknown physical aliases.');
    const offset = stat.size;
    await writeCacheBuffer(pooled.handle, payload, offset);
    await pooled.handle.sync();
    pooled.size = offset + payload.length;
    const shardMeta = cacheIndex.shards?.[shardName] || { createdAt: new Date().toISOString(), sizeBytes: 0 };
    shardMeta.sizeBytes = pooled.size;
    cacheIndex.shards[shardName] = shardMeta;
    return {
      storageEpoch: cacheIndex.storageEpoch || 0,
      shard: shardName,
      offset: offset + CACHE_ENTRY_PREFIX_BYTES,
      length: buffer.length,
      sizeBytes: payload.length
    };
  }
  const handle = await fs.open(shardPath, 'a');
  const owner = createContainedFileResource({ handle, sync: false });
  return owner.run(async () => {
    verifyContainedFileHandle(handle, cacheDir, shardPath);
    const stat = await handle.stat();
    if (stat.nlink !== 1) throw new Error('Embedding shard append refuses unknown physical aliases.');
    const offset = stat.size;
    await writeCacheBuffer(handle, payload, offset);
    await handle.sync();
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
  });
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
  withCacheLock(cacheDir, async () => {
    const canonical = await readCacheIndex(cacheDir, cacheIndex.identityKey);
    mergeCacheIndex(canonical, cacheIndex);
    for (const key of Object.keys(cacheIndex)) delete cacheIndex[key];
    Object.assign(cacheIndex, canonical);
    return appendShardEntryUnlocked(cacheDir, cacheIndex, buffer, options);
  }, options.lock)
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
  const buffer = Buffer.isBuffer(options.encodedBuffer) ? options.encodedBuffer : await encodeEmbeddingsCache(payload, options);
  return withEmbeddingProfileMutation(cacheDir, reserveCacheWrite(cacheKey, payload, buffer), async () => {
    assertNoSymlinkPath(path.parse(path.resolve(cacheDir)).root, cacheDir, { allowMissing: true });
    await fs.mkdir(cacheDir, { recursive: true });
    const tempPath = createTempPath(targetPath);
    try {
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
  }, options);
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
    storageEpoch: shardEntry?.storageEpoch ?? cacheIndex.storageEpoch ?? 0,
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
    ...(payload.chunkReferences ? { chunkReferences: { schemaVersion: 1, identityKey: payload.chunkReferences.identityKey,
      keys: [...new Set(payload.chunkReferences.records.map(record => record.key))] } } : {}),
    createdAt: existing.createdAt || now,
    lastAccessAt: now,
    hits: Number.isFinite(Number(existing.hits)) ? Number(existing.hits) : 0
  };
  const previousFile = typeof existing.file === 'string' && existing.file
    ? existing.file
    : null;
  cacheIndex.entries ||= Object.create(null);
  cacheIndex.entries[cacheKey] = next;
  const nextFiles = cacheIndex.files || Object.create(null);
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
  const beforePhysical = await inspectCachePhysicalStorage(cacheDir,cacheIndex);
  if (!beforePhysical.complete) return { removedKeys: [], removedShards: [], changed: false,
    blocked: 'physical-inventory-incomplete', physicalBytes: null, budgetExceeded: maxBytes > 0 };
  const reachability = await collectReferenceProtection(cacheDir, cacheIndex, { readIndex: readCacheIndex });
  const observedPhysicalBytes = beforePhysical.reduce((sum, file) => sum + file.sizeBytes, 0);
  if (reachability.incomplete) return { removedKeys: [], removedShards: [], changed: false,
    blocked: 'reference-ownership-unreadable', budgetExceeded: maxBytes > 0 && observedPhysicalBytes > maxBytes,
    physicalBytes: observedPhysicalBytes };
  const protectedKeys = reachability.protectedKeys;
  const plan = planEmbeddingsCachePrune({
    entries: cacheIndex.entries || {},
    maxBytes,
    maxAgeMs,
    now: Date.now()
  });
  plan.removeKeys = plan.removeKeys.filter(key => !protectedKeys.has(key));
  if (plan.removeKeys.length) cacheIndex.storageEpoch=(cacheIndex.storageEpoch||0)+1;
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
  const work = { summaryEntryVisits: 0 };
  const summarize = () => buildCachePhysicalSummary(cacheDir, cacheIndex, {
    resolveShardPath: resolveCacheShardPath, resolveEntryPath: resolveCacheEntryPath, counters: work
  });
  const beforeCompaction = summarize();
  const removedShards = [];
  for (const shardName of Object.keys(cacheIndex.shards || {})) {
    if (beforeCompaction.shards.has(shardName)) continue;
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
  const compaction = deleteShards ? await compactCacheShards(cacheDir,cacheIndex,options.maxCompactionBytes,beforeCompaction) : {copiedBytes:0,reclaimedBytes:0};
  // Compaction changes pointers. Rebuild once at the physical-inventory phase
  // boundary, rather than scanning the corpus per shard/comparison/removal.
  const physicalSummary = compaction.copiedBytes > 0 ? summarize() : beforeCompaction;
  let physical = await inspectCachePhysicalStorage(cacheDir,cacheIndex,physicalSummary);
  if (!physical.complete) {
    cacheIndex.updatedAt = new Date().toISOString();
    for (const [input, target] of Object.entries(cacheIndex.chunkInputs || {})) if (!cacheIndex.entries[target]) delete cacheIndex.chunkInputs[input];
    return { removedKeys: plan.removeKeys, removedShards, changed: plan.removeKeys.length > 0 || removedShards.length > 0 || compaction.copiedBytes > 0,
      blocked: 'physical-inventory-incomplete', physicalBytes: null, budgetExceeded: maxBytes > 0, work };
  }
  let physicalBytes=physical.reduce((sum,file)=>sum+file.sizeBytes,0);
  const physicalRemoved=[];
  if(deleteShards && maxBytes>0 && physicalBytes>maxBytes){
    physical.sort((a,b)=>compareCachePhysicalAge(a,b,physicalSummary));
    const protectedPaths = new Set([...protectedKeys].map(key => {
      const entry = cacheIndex.entries[key];
      return entry?.shard ? resolveCacheShardPath(cacheDir, entry.shard) : entry?.path || resolveCacheEntryPath(cacheDir, key);
    }));
    for(const file of physical){
      if(physicalBytes<=maxBytes)break;
      if(file.protected)continue;
      if (protectedPaths.has(file.path)) continue;
      try{await fs.rm(file.path);}catch{continue;}
      physicalBytes-=file.sizeBytes;physicalRemoved.push(file.path);
      cacheIndex.storageEpoch=(cacheIndex.storageEpoch||0)+1;
      for(const key of physicalSummary.paths.get(file.path)?.keys || []) {
        delete cacheIndex.entries[key];plan.removeKeys.push(key);
      }
      const name=path.basename(file.path);
      if(cacheIndex.shards[name]){delete cacheIndex.shards[name];removedShards.push(name);}
      if(cacheIndex.currentShard===name)cacheIndex.currentShard=null;
    }
    if(cacheIndex.files)for(const [file,key]of Object.entries(cacheIndex.files))if(!cacheIndex.entries[key])delete cacheIndex.files[file];
  }
  cacheIndex.updatedAt = new Date().toISOString();
  for (const [input, target] of Object.entries(cacheIndex.chunkInputs || {})) if (!cacheIndex.entries[target]) delete cacheIndex.chunkInputs[input];
  const changed=reachability.changed||plan.removeKeys.length>0||removedShards.length>0||compaction.copiedBytes>0||physicalRemoved.length>0;
  return {removedKeys:[...new Set(plan.removeKeys)],removedShards,changed,physicalBytesBefore:beforePhysical.reduce((sum,file)=>sum+file.sizeBytes,0),
    physicalBytes, budgetExceeded:maxBytes>0&&physicalBytes>maxBytes, compaction, physicalRemoved, work};
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
export const flushCacheIndex = (cacheDir, cacheIndex, options = {}) => withEmbeddingProfileMaintenance(cacheDir,
  () => flushCacheIndexUnlocked(cacheDir, cacheIndex, options), options);
const flushCacheIndexUnlocked = async (cacheDir, cacheIndex, options = {}) => {
  if (!cacheDir || !cacheIndex) {
    return { removedKeys: [], removedShards: [], changed: false, locked: false };
  }
  const identityKey = options.identityKey || cacheIndex.identityKey || null;
  const lockResult = await withCacheLock(cacheDir, async () => {
    const onDisk = await readCacheIndexForUpdate(cacheDir, identityKey);
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
    const physical=await inspectCachePhysicalStorage(cacheDir,onDisk);
    const physicalBytes=physical.complete ? physical.reduce((sum,file)=>sum+file.sizeBytes,0) : null;
    return {...pruneResult,physicalBytes,inventoryComplete:physical.complete,
      budgetExceeded:Number(options.maxBytes)>0&&(physicalBytes==null||physicalBytes>Number(options.maxBytes))};
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
      chunkInputVersion: EMBEDDING_CHUNK_INPUT_VERSION,
      file: file || null,
      hash,
      signature: signature || null
    }
  });
  return `file-${keyInfo.version}-${keyInfo.digest}`;
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
      chunkInputVersion: EMBEDDING_CHUNK_INPUT_VERSION,
      chunkHash
    }
  });
  return `global-chunk-${keyInfo.version}-${keyInfo.digest}`;
};

/**
 * Validate a cached entry against the current signature and identity.
 * @param {{cached?:object,signature?:string,identityKey?:string,hash?:string}} input
 * @returns {boolean}
 */
export const isCacheValid = ({ cached, signature, identityKey, hash }) => {
  if (!hasCurrentEmbeddingChunkInput(cached) || cached.chunkSignature !== signature) return false;
  if (hash && cached.hash && cached.hash !== hash) return false;
  return cached.cacheMeta?.identityKey === identityKey;
};

/**
 * Validate a global content-addressed chunk cache entry.
 * @param {{cached?:object,identityKey?:string,chunkHash?:string}} input
 * @returns {boolean}
 */
export const isGlobalChunkCacheValid = ({ cached, identityKey, chunkHash }) => {
  if (!hasCurrentEmbeddingChunkInput(cached)) return false;
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
  const identityKey = buildEmbeddingIdentityKey(identity);
  const profile = resolveEmbeddingCacheProfile({ cacheRoot, identity });
  const paths = [resolveCacheMetaPath(cacheRoot, identity, mode),
    path.join(resolveEmbeddingsCacheModeDir(profile.prior, mode), 'cache.meta.json'),
    path.join(resolveEmbeddingsCacheModeDir(profile.legacy, mode), 'cache.meta.json')];
  for (const metaPath of paths) {
    try {
      const parsed = JSON.parse(fsSync.readFileSync(metaPath, 'utf8'));
      if (parsed?.identityKey === identityKey) return parsed;
    } catch { /* Missing/corrupt compatibility metadata is not authority. */ }
  }
  return null;
};

/**
 * Write cache metadata to disk.
 * @param {string} cacheRoot
 * @param {object} identity
 * @param {string} mode
 * @param {object} meta
 * @returns {Promise<void>}
 */
export const writeCacheMeta = async (cacheRoot, identity, mode, meta, options = {}) => {
  const metaPath = resolveCacheMetaPath(cacheRoot, identity, mode);
  if (!metaPath) return;
  return withEmbeddingProfileMutation(path.dirname(metaPath), Buffer.byteLength(JSON.stringify(meta)) + 4096, async () => {
    await fs.mkdir(path.dirname(metaPath), { recursive: true });
    await writeJsonObjectFile(metaPath, { fields: meta, atomic: true });
  }, options);
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

/** Append an already encoded batch under one cross-process lock. */
export const writeCacheEntries = async (cacheDir, cacheIndex, writes, options = {}) => {
  if (!cacheDir || !cacheIndex) throw new TypeError('Batch cache writes require an index');
  const prepared = [];
  for (const write of writes) prepared.push({ ...write, encodedPayload: Buffer.isBuffer(write.encodedPayload)
    ? write.encodedPayload : await encodeCacheEntryPayload(write.payload) });
  const reservation = prepared.reduce((sum, write) => sum + reserveCacheWrite(write.cacheKey, write.payload, write.encodedPayload), 0);
  return withEmbeddingProfileMutation(cacheDir, reservation, () => writeCacheEntriesUnlocked(cacheDir, cacheIndex, prepared, options), options);
};
const writeCacheEntriesUnlocked = async (cacheDir, cacheIndex, writes, options) => {
  return withCacheLock(cacheDir, async () => {
    const canonical = await readCacheIndexForUpdate(cacheDir, cacheIndex.identityKey);
    const pointers=[], keys = [], fileKeys = new Set();
    for(const write of writes){
      const oldFile = canonical.entries[write.cacheKey]?.file;
      if (oldFile) fileKeys.add(oldFile);
      const buffer=Buffer.isBuffer(write.encodedPayload)?write.encodedPayload:await encodeCacheEntryPayload(write.payload);
      const pointer=await appendShardEntryUnlocked(cacheDir,canonical,buffer,options);
      upsertCacheIndexEntry(canonical,write.cacheKey,write.payload,pointer);
      keys.push(write.cacheKey);
      if (write.payload.file) fileKeys.add(write.payload.file);
      pointers.push(pointer);
    }
    const delta = { keys, fileKeys: [...fileKeys] };
    await appendEmbeddingIndexDelta(cacheDir,canonical,delta);
    syncEmbeddingIndexDelta(cacheIndex, canonical, delta);
    return pointers;
  },options.lock);
};

const writeCacheBuffer = async (handle,buffer,offset) => {
  let written=0;
  while(written<buffer.length){
    const result=await handle.write(buffer,written,buffer.length-written,offset+written);
    if(!result.bytesWritten)throw Error('Incomplete cache write');
    written+=result.bytesWritten;
  }
};

export { readCacheEntries, createCacheBatchReader } from './cache/batch-reader.js';
export const withEmbeddingCacheReadLock = (directory, action, options) => fsSync.existsSync(directory || '')
  ? withCacheLock(directory, action, options) : withEmbeddingProfileAccess(directory, action);
const writeReferencedCacheFileUnlocked = createReferenceCacheWriter({ lock: withCacheLock,
  readIndex: readCacheIndexForUpdate, writeIndex: writeCacheIndex, publishDelta: appendEmbeddingIndexDelta,
  syncIndex: syncEmbeddingIndexDelta, append: appendShardEntryUnlocked,
  readEntries: (...args) => readReferenceEntries(...args),
  upsert: upsertCacheIndexEntry, writeFiles: writeCacheEntries });
const reserveCacheWrite = (key, payload, buffer) => {
  const index = { entries: {}, files: {}, storageEpoch: 0 };
  const entry = upsertCacheIndexEntry(index, key, payload, { shard: 'shard-999999999999999.bin', offset: Number.MAX_SAFE_INTEGER,
    length: buffer.length, sizeBytes: buffer.length + 4 });
  // Each changed projection reserves checkpoint + compatibility + journal and
  // temporary replacement space, without serializing any existing index.
  return buffer.length + 4 + 4 * Buffer.byteLength(JSON.stringify({ entry, files: index.files, inputKey: key })) + 4096;
};
export const writeReferencedCacheFile = async input => {
  const reservation = input.chunks.reduce((sum, chunk) => sum + reserveCacheWrite(chunk.cacheKey, chunk.payload, chunk.encodedPayload),
    input.filePayload ? reserveCacheWrite(input.filePayload.key, input.filePayload, input.encodedFile) : 0);
  return withEmbeddingProfileMutation(input.globalDir, reservation, () => writeReferencedCacheFileUnlocked(input), input.options);
};

const { compactCacheShards, inspectCachePhysicalStorage } = createCachePhysicalStorage({ resolveCacheShardPath, resolveCacheEntryPath,
  resolveCacheShardDir, resolveCacheIndexPath, resolveCacheIndexBinaryPath, allocateShard, writeCacheIndex, writeCacheBuffer });
