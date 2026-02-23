import fs from 'node:fs/promises';
import {
  encodeCacheEntryPayload,
  isCacheValid,
  readCacheEntry,
  readCacheIndex,
  readCacheMeta,
  resolveCacheDir,
  shouldFastRejectCacheLookup,
  updateCacheIndexAccess,
  upsertCacheIndexEntry,
  writeCacheEntry
} from '../cache.js';
import { flushCacheIndexIfNeeded } from '../cache-flush.js';
import { ensureVectorArrays, isDimsMismatch, validateCachedDims } from '../embed.js';
import { isNonEmptyVector } from '../../../../src/shared/embedding-utils.js';

const EMPTY_VECTOR = Object.freeze([]);

/**
 * @typedef {object} EmbeddingsCacheCounters
 * @property {number} attempts
 * @property {number} hits
 * @property {number} misses
 * @property {number} rejected
 * @property {number} fastRejects
 */

/**
 * @typedef {object} EmbeddingsCacheState
 * @property {string} cacheDir
 * @property {object} cacheIndex
 * @property {boolean} cacheIndexDirty
 * @property {boolean} cacheEligible
 */

/**
 * Create mutable per-mode cache counters.
 *
 * @returns {EmbeddingsCacheCounters}
 */
export const createEmbeddingsCacheCounters = () => ({
  attempts: 0,
  hits: 0,
  misses: 0,
  rejected: 0,
  fastRejects: 0
});

/**
 * Initialize per-mode cache state and enforce identity/dims safety checks.
 *
 * @param {{
 *   mode:string,
 *   cacheRoot:string,
 *   cacheIdentity:object,
 *   cacheIdentityKey:string,
 *   configuredDims:number|null,
 *   scheduleIo:(worker:()=>Promise<any>)=>Promise<any>,
 *   warn:(line:string)=>void
 * }} input
 * @returns {Promise<{cacheState:EmbeddingsCacheState,cacheMeta:object|null,cacheMetaMatches:boolean}>}
 */
export const initializeEmbeddingsCacheState = async ({
  mode,
  cacheRoot,
  cacheIdentity,
  cacheIdentityKey,
  configuredDims,
  scheduleIo,
  warn
}) => {
  const cacheDir = resolveCacheDir(cacheRoot, cacheIdentity, mode);
  await scheduleIo(() => fs.mkdir(cacheDir, { recursive: true }));
  let cacheIndex = await scheduleIo(() => readCacheIndex(cacheDir, cacheIdentityKey));
  let cacheIndexDirty = false;
  const cacheMeta = await scheduleIo(() => readCacheMeta(cacheRoot, cacheIdentity, mode));
  const cacheMetaMatches = cacheMeta?.identityKey === cacheIdentityKey;
  let cacheEligible = true;
  if (cacheMeta?.identityKey && !cacheMetaMatches) {
    warn(`[embeddings] ${mode} cache identity mismatch; ignoring cached vectors.`);
    cacheEligible = false;
    cacheIndex = {
      ...(cacheIndex || {}),
      entries: {},
      files: {},
      shards: {},
      currentShard: null,
      nextShardId: 0
    };
    cacheIndexDirty = true;
  }
  if (configuredDims && cacheEligible) {
    if (cacheMetaMatches && Number.isFinite(Number(cacheMeta?.dims))) {
      const cachedDims = Number(cacheMeta.dims);
      if (cachedDims !== configuredDims) {
        throw new Error(
          `[embeddings] ${mode} cache dims mismatch (configured=${configuredDims}, cached=${cachedDims}).`
        );
      }
    }
  }
  return {
    cacheState: {
      cacheDir,
      cacheIndex,
      cacheIndexDirty,
      cacheEligible
    },
    cacheMeta,
    cacheMetaMatches
  };
};

/**
 * Ensure cache index has a mutable file->key map.
 *
 * @param {object|null|undefined} cacheIndex
 * @returns {void}
 */
const ensureCacheFilesMap = (cacheIndex) => {
  if (!cacheIndex || (cacheIndex.files && typeof cacheIndex.files === 'object')) return;
  cacheIndex.files = {};
};

/**
 * Create opportunistic/forced cache-index flush coordinator used by the file
 * completion hot path. Keeping this centralized avoids duplicated in-flight
 * guards and preserves flush cadence under parallel file workers.
 *
 * @param {{
 *   cacheState:EmbeddingsCacheState,
 *   cacheIdentityKey:string,
 *   cacheMaxBytes:number,
 *   cacheMaxAgeMs:number,
 *   scheduleIo:(worker:()=>Promise<any>)=>Promise<any>,
 *   flushIntervalFiles?:number
 * }} input
 * @returns {{noteFileProcessed:()=>void,flushMaybe:(input?:{force?:boolean})=>Promise<void>}}
 */
export const createCacheIndexFlushCoordinator = ({
  cacheState,
  cacheIdentityKey,
  cacheMaxBytes,
  cacheMaxAgeMs,
  scheduleIo,
  flushIntervalFiles = 64
}) => {
  let filesSinceCacheIndexFlush = 0;
  let cacheIndexFlushInFlight = null;

  const noteFileProcessed = () => {
    filesSinceCacheIndexFlush += 1;
  };

  const flushMaybe = async ({ force = false } = {}) => {
    if (!cacheState.cacheIndex || !cacheState.cacheEligible) return;
    if (cacheIndexFlushInFlight) {
      if (force) {
        await cacheIndexFlushInFlight;
      }
      return;
    }
    if (!cacheState.cacheIndexDirty) {
      if (force) filesSinceCacheIndexFlush = 0;
      return;
    }
    if (!force && filesSinceCacheIndexFlush < flushIntervalFiles) {
      return;
    }
    cacheIndexFlushInFlight = (async () => {
      const flushState = await flushCacheIndexIfNeeded({
        cacheDir: cacheState.cacheDir,
        cacheIndex: cacheState.cacheIndex,
        cacheEligible: cacheState.cacheEligible,
        cacheIndexDirty: cacheState.cacheIndexDirty,
        cacheIdentityKey,
        cacheMaxBytes,
        cacheMaxAgeMs,
        scheduleIo
      });
      cacheState.cacheIndexDirty = flushState.cacheIndexDirty;
      if (!cacheState.cacheIndexDirty || force) {
        filesSinceCacheIndexFlush = 0;
      } else {
        filesSinceCacheIndexFlush = flushIntervalFiles;
      }
    })();
    try {
      await cacheIndexFlushInFlight;
    } finally {
      cacheIndexFlushInFlight = null;
    }
  };

  return {
    noteFileProcessed,
    flushMaybe
  };
};

/**
 * Mark cache index dirty so flush coordinator can persist updates.
 *
 * @param {EmbeddingsCacheState} cacheState
 * @returns {void}
 */
export const markCacheIndexDirty = (cacheState) => {
  cacheState.cacheIndexDirty = true;
};

/**
 * Perform one cache lookup while updating per-mode counters. Misses are counted
 * even when fast-reject short-circuits disk reads, matching prior semantics.
 *
 * @param {{
 *   cacheState:EmbeddingsCacheState,
 *   cacheKey:string|null,
 *   fileHash:string|null,
 *   chunkSignature:string,
 *   cacheIdentityKey:string,
 *   scheduleIo:(worker:()=>Promise<any>)=>Promise<any>,
 *   counters:EmbeddingsCacheCounters
 * }} input
 * @returns {Promise<object|null>}
 */
export const lookupCacheEntryWithStats = async ({
  cacheState,
  cacheKey,
  fileHash,
  chunkSignature,
  cacheIdentityKey,
  scheduleIo,
  counters
}) => {
  if (!cacheState.cacheEligible || !cacheKey || !fileHash) return null;
  counters.attempts += 1;
  if (shouldFastRejectCacheLookup({
    cacheIndex: cacheState.cacheIndex,
    cacheKey,
    identityKey: cacheIdentityKey,
    fileHash,
    chunkSignature
  })) {
    counters.fastRejects += 1;
    counters.misses += 1;
    return null;
  }
  const cachedResult = await scheduleIo(() => readCacheEntry(
    cacheState.cacheDir,
    cacheKey,
    cacheState.cacheIndex
  ));
  const cached = cachedResult?.entry || null;
  if (!cached) counters.misses += 1;
  return cached;
};

/**
 * Attempt to reuse a cached file entry. On success this updates output vectors,
 * optional HNSW feeds, and cache index access bookkeeping in one pass.
 *
 * @param {{
 *   cached:object|null,
 *   items:Array<{index:number}>,
 *   normalizedRel:string,
 *   mode:string,
 *   configuredDims:number|null,
 *   cacheIdentityKey:string,
 *   chunkSignature:string,
 *   fileHash:string|null,
 *   cacheKey:string|null,
 *   cacheState:EmbeddingsCacheState,
 *   counters:EmbeddingsCacheCounters,
 *   assertDims:(dims:number)=>void,
 *   codeVectors:Array<any>,
 *   docVectors:Array<any>,
 *   mergedVectors:Array<any>,
 *   addHnswFromQuantized?:((target:'merged'|'doc'|'code',chunkIndex:number,vector:any)=>void)|null
 * }} input
 * @returns {boolean}
 */
export const tryApplyCachedVectors = ({
  cached,
  items,
  normalizedRel,
  mode,
  configuredDims,
  cacheIdentityKey,
  chunkSignature,
  fileHash,
  cacheKey,
  cacheState,
  counters,
  assertDims,
  codeVectors,
  docVectors,
  mergedVectors,
  addHnswFromQuantized = null
}) => {
  if (!cached) return false;
  try {
    const cacheIdentityMatches = cached.cacheMeta?.identityKey === cacheIdentityKey;
    if (cacheIdentityMatches) {
      const expectedDims = configuredDims || cached.cacheMeta?.identity?.dims || null;
      validateCachedDims({ vectors: cached.codeVectors, expectedDims, mode });
      validateCachedDims({ vectors: cached.docVectors, expectedDims, mode });
      validateCachedDims({ vectors: cached.mergedVectors, expectedDims, mode });
    }
    if (!isCacheValid({
      cached,
      signature: chunkSignature,
      identityKey: cacheIdentityKey,
      hash: fileHash
    })) {
      return false;
    }
    const cachedCode = ensureVectorArrays(cached.codeVectors, items.length);
    const cachedDoc = ensureVectorArrays(cached.docVectors, items.length);
    const cachedMerged = ensureVectorArrays(cached.mergedVectors, items.length);
    for (let i = 0; i < items.length; i += 1) {
      const chunkIndex = items[i].index;
      const codeVec = cachedCode[i] || EMPTY_VECTOR;
      const docVec = cachedDoc[i] || EMPTY_VECTOR;
      const mergedVec = cachedMerged[i] || EMPTY_VECTOR;
      if (!isNonEmptyVector(codeVec) || !isNonEmptyVector(docVec) || !isNonEmptyVector(mergedVec)) {
        throw new Error(`[embeddings] ${mode} cached vectors incomplete; recomputing ${normalizedRel}.`);
      }
      assertDims(codeVec.length);
      assertDims(docVec.length);
      assertDims(mergedVec.length);
      codeVectors[chunkIndex] = codeVec;
      docVectors[chunkIndex] = docVec;
      mergedVectors[chunkIndex] = mergedVec;
      if (addHnswFromQuantized) {
        addHnswFromQuantized('merged', chunkIndex, mergedVec);
        addHnswFromQuantized('doc', chunkIndex, docVec);
        addHnswFromQuantized('code', chunkIndex, codeVec);
      }
    }
    if (cacheState.cacheIndex && cacheKey) {
      updateCacheIndexAccess(cacheState.cacheIndex, cacheKey);
      ensureCacheFilesMap(cacheState.cacheIndex);
      if (!cacheState.cacheIndex.files[normalizedRel]) {
        cacheState.cacheIndex.files[normalizedRel] = cacheKey;
      }
      markCacheIndexDirty(cacheState);
    }
    counters.hits += 1;
    return true;
  } catch (err) {
    if (isDimsMismatch(err)) throw err;
    counters.rejected += 1;
    return false;
  }
};

/**
 * Reuse chunk vectors from a previous cache entry keyed to the same file when
 * chunk hashes still overlap across signature/hash changes.
 *
 * @param {{
 *   cacheState:EmbeddingsCacheState,
 *   cacheKey:string|null,
 *   normalizedRel:string,
 *   chunkHashes:string[],
 *   chunkHashesFingerprint:string|null,
 *   reuse:{code:any[],doc:any[],merged:any[]},
 *   scheduleIo:(worker:()=>Promise<any>)=>Promise<any>
 * }} input
 * @returns {Promise<void>}
 */
export const reuseVectorsFromPriorCacheEntry = async ({
  cacheState,
  cacheKey,
  normalizedRel,
  chunkHashes,
  chunkHashesFingerprint,
  reuse,
  scheduleIo
}) => {
  if (!cacheState.cacheEligible) return;
  const priorKey = cacheState.cacheIndex?.files?.[normalizedRel];
  if (!priorKey || priorKey === cacheKey) return;
  const priorIndexEntry = cacheState.cacheIndex?.entries?.[priorKey] || null;
  const canCheckFingerprint = typeof chunkHashesFingerprint === 'string'
    && !!priorIndexEntry?.chunkHashesFingerprint;
  const fingerprintMatches = !canCheckFingerprint
    || priorIndexEntry.chunkHashesFingerprint === chunkHashesFingerprint;
  const priorResult = fingerprintMatches
    ? await scheduleIo(() => readCacheEntry(cacheState.cacheDir, priorKey, cacheState.cacheIndex))
    : null;
  const priorEntry = priorResult?.entry;
  if (!priorEntry || !Array.isArray(priorEntry.chunkHashes)) return;
  const hashMap = new Map();
  for (let i = 0; i < priorEntry.chunkHashes.length; i += 1) {
    const hash = priorEntry.chunkHashes[i];
    if (!hash) continue;
    const list = hashMap.get(hash) || [];
    list.push(i);
    hashMap.set(hash, list);
  }
  const priorCode = ensureVectorArrays(priorEntry.codeVectors, priorEntry.chunkHashes.length);
  const priorDoc = ensureVectorArrays(priorEntry.docVectors, priorEntry.chunkHashes.length);
  const priorMerged = ensureVectorArrays(priorEntry.mergedVectors, priorEntry.chunkHashes.length);
  for (let i = 0; i < chunkHashes.length; i += 1) {
    const hash = chunkHashes[i];
    const list = hashMap.get(hash);
    if (!list || !list.length) continue;
    const priorIndex = list.shift();
    const codeVec = priorCode[priorIndex] || null;
    const docVec = priorDoc[priorIndex] || null;
    const mergedVec = priorMerged[priorIndex] || null;
    if (isNonEmptyVector(codeVec) && isNonEmptyVector(docVec) && isNonEmptyVector(mergedVec)) {
      reuse.code[i] = codeVec;
      reuse.doc[i] = docVec;
      reuse.merged[i] = mergedVec;
    }
  }
  updateCacheIndexAccess(cacheState.cacheIndex, priorKey);
  markCacheIndexDirty(cacheState);
};

/**
 * Queue a cache write for computed/reused vectors and update in-memory index
 * metadata once the shard append succeeds.
 *
 * @param {{
 *   cacheState:EmbeddingsCacheState,
 *   cacheIdentity:object,
 *   cacheIdentityKey:string,
 *   cacheKey:string|null,
 *   normalizedRel:string,
 *   fileHash:string|null,
 *   chunkSignature:string,
 *   chunkHashes:string[]|null,
 *   chunkHashesFingerprint:string|null,
 *   chunkCount:number,
 *   codeVectors:any[],
 *   docVectors:any[],
 *   mergedVectors:any[],
 *   writerQueue:{enqueue:(worker:()=>Promise<any>)=>Promise<any>},
 *   cacheShardHandlePool:object
 * }} input
 * @returns {Promise<void>}
 */
export const enqueueCacheEntryWrite = async ({
  cacheState,
  cacheIdentity,
  cacheIdentityKey,
  cacheKey,
  normalizedRel,
  fileHash,
  chunkSignature,
  chunkHashes,
  chunkHashesFingerprint,
  chunkCount,
  codeVectors,
  docVectors,
  mergedVectors,
  writerQueue,
  cacheShardHandlePool
}) => {
  if (!cacheKey) return;
  const cachePayload = {
    key: cacheKey,
    file: normalizedRel,
    hash: fileHash,
    chunkSignature,
    chunkHashes,
    cacheMeta: {
      schemaVersion: 1,
      identityKey: cacheIdentityKey,
      identity: cacheIdentity,
      createdAt: new Date().toISOString()
    },
    codeVectors,
    docVectors,
    mergedVectors
  };
  const encodedPayload = await encodeCacheEntryPayload(cachePayload);
  await writerQueue.enqueue(async () => {
    const shardEntry = await writeCacheEntry(cacheState.cacheDir, cacheKey, cachePayload, {
      index: cacheState.cacheIndex,
      encodedBuffer: encodedPayload,
      shardHandlePool: cacheShardHandlePool
    });
    if (shardEntry) {
      upsertCacheIndexEntry(cacheState.cacheIndex, cacheKey, {
        key: cacheKey,
        file: normalizedRel,
        hash: fileHash,
        chunkSignature,
        chunkCount,
        chunkHashesFingerprint,
        chunkHashesCount: Array.isArray(chunkHashes) ? chunkHashes.length : null
      }, shardEntry);
      markCacheIndexDirty(cacheState);
    }
  });
};
