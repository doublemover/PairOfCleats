import { atomicWriteJson } from '../../../shared/io/atomic-write.js';
import { withFileLock } from '../../../shared/locks/file-lock.js';
import { loadBoundedJsonFile } from '../../../shared/cache/json-file.js';
import {
  pruneQueryCache,
  rememberQueryCacheEntry
} from '../../query-cache.js';

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
  queryCacheMaxEntries
}) {
  let nextCacheData = cacheData;
  let nextCacheShouldPersist = cacheShouldPersist;

  if (!(queryCacheEnabled && cacheKey)) {
    return {
      cacheData: nextCacheData,
      cacheShouldPersist: nextCacheShouldPersist
    };
  }

  if (!nextCacheData && !cacheHit && queryCachePath) {
    nextCacheData = { version: 1, entries: [] };
  }
  if (!cacheHit) {
    if (nextCacheData && Array.isArray(nextCacheData.entries)) {
      nextCacheData.entries = nextCacheData.entries.filter((entry) => entry.key !== cacheKey);
    }
    const entry = {
      key: cacheKey,
      ts: Date.now(),
      ttlMs: queryCacheTtlMs,
      signature: cacheSignature,
      meta: {
        query,
        backend: backendLabel
      },
      payload: {
        prose: proseHits,
        extractedProse: extractedProseHits,
        code: codeHits,
        records: recordHits
      }
    };
    if (nextCacheData && Array.isArray(nextCacheData.entries)) {
      nextCacheData.entries.push(entry);
      nextCacheShouldPersist = Boolean(queryCachePath);
    }
    rememberQueryCacheEntry(queryCachePath, cacheKey, cacheSignature, entry, queryCacheMaxEntries);
  }
  if (nextCacheShouldPersist && nextCacheData && queryCachePath) {
    pruneQueryCache(nextCacheData, queryCacheMaxEntries);
    try {
      await withFileLock({ lockPath: `${queryCachePath}.lock`, waitMs: 5000, timeoutBehavior: 'throw' }, async () => {
        const { data: disk } = await loadBoundedJsonFile(queryCachePath, { maxBytes: 8 * 1024 * 1024 });
        const byKey = new Map();
        for (const entry of [...(disk?.version === 1 && Array.isArray(disk.entries) ? disk.entries : []), ...nextCacheData.entries]) {
          if (!entry?.key) continue;
          const old = byKey.get(entry.key);
          if (!old || Number(entry.ts || 0) >= Number(old.ts || 0)) byKey.set(entry.key, entry);
        }
        nextCacheData = { version: 1, entries: [...byKey.values()] };
        pruneQueryCache(nextCacheData, queryCacheMaxEntries);
        await atomicWriteJson(queryCachePath, nextCacheData, { spaces: 2 });
      });
    } catch {}
  }

  return {
    cacheData: nextCacheData,
    cacheShouldPersist: nextCacheShouldPersist
  };
}
