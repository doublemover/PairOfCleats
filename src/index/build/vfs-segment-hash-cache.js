import { buildCacheKey } from '../../shared/cache-key.js';
import { createLruCache } from '../../shared/cache.js';

/** Schema version for the VFS segment hash cache. */
export const VFS_SEGMENT_HASH_CACHE_SCHEMA_VERSION = '1.0.0';

const normalizeField = (value, fallback = '') => (value == null ? fallback : String(value));

/**
 * Build a cache key for a VFS segment doc hash.
 * @param {object} [input]
 * @returns {string|null}
 */
export const buildVfsSegmentHashCacheKey = ({
  fileHash,
  fileHashAlgo,
  containerPath,
  languageId,
  effectiveExt,
  segmentStart,
  segmentEnd
} = {}) => {
  if (!fileHash) return null;
  const algo = normalizeField(fileHashAlgo, 'sha1');
  const path = normalizeField(containerPath);
  const lang = normalizeField(languageId, 'unknown');
  const ext = normalizeField(effectiveExt);
  const range = `${Number.isFinite(Number(segmentStart)) ? Number(segmentStart) : 0}-${Number.isFinite(Number(segmentEnd)) ? Number(segmentEnd) : 0}`;
  const keyInfo = buildCacheKey({
    repoHash: `${algo}:${fileHash}`,
    buildConfigHash: null,
    mode: 'vfs',
    schemaVersion: VFS_SEGMENT_HASH_CACHE_SCHEMA_VERSION,
    featureFlags: [`lang:${lang}`, `ext:${ext}`],
    pathPolicy: 'posix',
    extra: {
      containerPath: path,
      range
    }
  });
  return keyInfo.key;
};

/** Alias for buildVfsSegmentHashCacheKey. */
export const buildDocHashCacheKey = buildVfsSegmentHashCacheKey;

/**
 * Create an in-memory LRU cache for VFS segment hashes.
 * @param {{maxEntries?:number}} [options]
 * @returns {{get:(key:string)=>any,set:(key:string,value:any)=>void,clear:()=>void,size:number}}
 */
export const createVfsSegmentHashCache = ({ maxEntries = 50000 } = {}) => {
  const limit = Number.isFinite(Number(maxEntries)) ? Math.max(1, Math.floor(Number(maxEntries))) : 50000;
  const store = createLruCache({
    name: 'vfs-segment-hash',
    maxEntries: limit
  });
  return {
    get(key) {
      if (!key) return null;
      return store.get(key);
    },
    set(key, value) {
      if (!key) return;
      store.set(key, value);
    },
    clear() {
      store.clear();
    },
    get size() {
      return store.size();
    }
  };
};
