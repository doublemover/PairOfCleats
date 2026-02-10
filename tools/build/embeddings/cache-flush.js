import { flushCacheIndex as flushCacheIndexImpl } from './cache.js';

/**
 * Flush cache index updates when needed and return updated dirty state.
 * Keep dirty state set when flush can't acquire the lock so callers can retry.
 *
 * @param {{
 *   cacheDir:string,
 *   cacheIndex:object|null,
 *   cacheEligible:boolean,
 *   cacheIndexDirty:boolean,
 *   cacheIdentityKey:string|null,
 *   cacheMaxBytes:number,
 *   cacheMaxAgeMs:number,
 *   scheduleIo?:(worker:() => Promise<any>) => Promise<any>,
 *   flushCacheIndex?:(cacheDir:string, cacheIndex:object, options:object) => Promise<{locked?:boolean}>
 * }} input
 * @returns {Promise<{cacheIndexDirty:boolean,flushResult:object|null}>}
 */
export const flushCacheIndexIfNeeded = async ({
  cacheDir,
  cacheIndex,
  cacheEligible,
  cacheIndexDirty,
  cacheIdentityKey,
  cacheMaxBytes,
  cacheMaxAgeMs,
  scheduleIo = null,
  flushCacheIndex = flushCacheIndexImpl
}) => {
  const shouldFlush = Boolean(cacheIndex && cacheEligible && (cacheIndexDirty || cacheMaxBytes || cacheMaxAgeMs));
  if (!shouldFlush) {
    return { cacheIndexDirty, flushResult: null };
  }

  const runFlush = () => flushCacheIndex(cacheDir, cacheIndex, {
    identityKey: cacheIdentityKey,
    maxBytes: cacheMaxBytes,
    maxAgeMs: cacheMaxAgeMs
  });

  try {
    const flushResult = scheduleIo ? await scheduleIo(runFlush) : await runFlush();
    if (flushResult?.locked) {
      return { cacheIndexDirty: false, flushResult };
    }
    return { cacheIndexDirty, flushResult: flushResult || null };
  } catch {
    return { cacheIndexDirty, flushResult: null };
  }
};

