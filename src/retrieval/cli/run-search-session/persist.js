import { atomicWriteJson } from '../../../shared/io/atomic-write.js';
import { withFileLock } from '../../../shared/locks/file-lock.js';
import { loadBoundedJsonFile } from '../../../shared/cache/json-file.js';
import { randomUUID } from 'node:crypto';
import { applyQueryCacheTouches, loadQueryCacheTouches, clearQueryCacheTouchesUnlocked,
  awaitQueryCacheTouchPublication, requireQueryCacheTouchSettlement } from '../../query-cache-touches.js';
import {
  pruneQueryCache,
  rememberQueryCacheEntry,
  findQueryCacheEntry
} from '../../query-cache.js';
import { snapshotQueryCachePayload, upsertQueryCacheEntry, forkQueryCacheSnapshot,
  captureQueryCacheSubmission, mergeQueryCacheSubmission, acknowledgeQueryCacheSubmission } from '../../query-cache-state.js';
import { throwIfAborted, isAbortError } from '../../../shared/abort.js';
import { observeStorageResource } from '../../../shared/storage/failure-observation.js';
import { areRetrievalExecutionsReusable } from '../../../contracts/retrieval-execution.js';

export function resolveAnnBackendUsed({
  vectorAnnEnabled,
  vectorAnnUsed,
  hnswAnnUsed,
  lanceAnnUsed
}) {
  const hnswActive = Object.values(hnswAnnUsed).some(Boolean);
  const lanceActive = Object.values(lanceAnnUsed).some(Boolean);
  const sqliteVectorActive = vectorAnnEnabled && Object.values(vectorAnnUsed).some(Boolean);
  return sqliteVectorActive
    ? 'sqlite-extension'
    : (lanceActive ? 'lancedb' : (hnswActive ? 'hnsw' : 'js'));
}

export async function persistSearchSession({
  queryCacheEnabled,
  cacheKey,
  cacheHit,
  cacheData,
  queryCachePath,
  cacheShouldPersist,
  queryCacheTtlMs,
  cacheSignature,
  query,
  backendLabel,
  proseHits,
  extractedProseHits,
  codeHits,
  recordHits,
  executionOutcomes = null,
  queryCacheMaxEntries,
  signal = null
}) {
  throwIfAborted(signal);
  let nextCacheData = cacheData;
  let nextCacheShouldPersist = cacheShouldPersist;
  let preparedEntry = null;

  if (!(queryCacheEnabled && cacheKey)) {
    return {
      cacheData: nextCacheData,
      cacheShouldPersist: nextCacheShouldPersist
    };
  }
  // A completed fallback can serve this request while still requiring a fresh
  // provider attempt later. Ordinary cache recency must never certify it healthy.
  if (!cacheHit && !areRetrievalExecutionsReusable(executionOutcomes)) {
    return { cacheData: nextCacheData, cacheShouldPersist: nextCacheShouldPersist };
  }

  if (!nextCacheData && !cacheHit && queryCachePath) {
    nextCacheData = { version: 1, entries: [] };
  }
  if (!cacheHit) {
    let payload;
    try { payload = snapshotQueryCachePayload({ prose: proseHits, extractedProse: extractedProseHits, code: codeHits, records: recordHits }); }
    catch (error) {
      observeStorageResource(error, { phase: 'query-cache-payload-admission' }).requireSettled();
      return { cacheData: nextCacheData, cacheShouldPersist: nextCacheShouldPersist };
    }
    const entry = {
      key: cacheKey,
      payloadId: randomUUID(),
      ts: Date.now(),
      ttlMs: queryCacheTtlMs,
      signature: cacheSignature,
      meta: {
        query,
        backend: backendLabel,
        executionOutcomes: snapshotQueryCachePayload(executionOutcomes)
      },
      payload
    };
    preparedEntry = entry;
    if (nextCacheData && Array.isArray(nextCacheData.entries)) {
      upsertQueryCacheEntry(nextCacheData, entry);
      nextCacheShouldPersist = Boolean(queryCachePath);
    }
    if (!nextCacheShouldPersist) {
      throwIfAborted(signal);
      rememberQueryCacheEntry(queryCachePath, cacheKey, cacheSignature, entry, queryCacheMaxEntries);
    }
  }
  if (nextCacheShouldPersist && nextCacheData && queryCachePath) {
    pruneQueryCache(nextCacheData, queryCacheMaxEntries);
    const submittedCache = nextCacheData;
    const submitted = captureQueryCacheSubmission(submittedCache);
    try {
      await awaitQueryCacheTouchPublication(queryCachePath);
      throwIfAborted(signal);
      await withFileLock({ lockPath: `${queryCachePath}.lock`, waitMs: 5000, timeoutBehavior: 'throw' }, async () => {
        const { data: disk } = await loadBoundedJsonFile(queryCachePath, { maxBytes: 8 * 1024 * 1024 });
        throwIfAborted(signal);
        requireQueryCacheTouchSettlement(queryCachePath);
        if (disk?.version === 1) applyQueryCacheTouches(disk, loadQueryCacheTouches(queryCachePath));
        const merged = mergeQueryCacheSubmission(disk?.version === 1 && Array.isArray(disk.entries)
          ? forkQueryCacheSnapshot(disk) : { entries: [] }, submitted);
        for (const entry of merged.entries) entry.payloadId ||= randomUUID();
        pruneQueryCache(merged, queryCacheMaxEntries);
        throwIfAborted(signal);
        await atomicWriteJson(queryCachePath, merged, { spaces: 0, signal });
        await clearQueryCacheTouchesUnlocked(queryCachePath);
        acknowledgeQueryCacheSubmission(submittedCache, submitted);
        nextCacheData = merged;
        nextCacheShouldPersist = false;
        findQueryCacheEntry(merged, cacheKey, cacheSignature, { cachePath: queryCachePath,
          strategy: 'disk-first', maxHotEntries: queryCacheMaxEntries });
      });
    } catch (error) {
      observeStorageResource(error, { phase: 'query-cache-checkpoint' }).requireSettled();
      if (isAbortError(error)) throw error;
    }
  }
  throwIfAborted(signal);
  // A best-effort flush failure may retain this completed result for retry;
  // cancellation never publishes a staged miss to the shared hot cache.
  if (preparedEntry && nextCacheShouldPersist) {
    rememberQueryCacheEntry(queryCachePath, cacheKey, cacheSignature, preparedEntry, queryCacheMaxEntries);
  }

  return {
    cacheData: nextCacheData,
    cacheShouldPersist: nextCacheShouldPersist
  };
}
