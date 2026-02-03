/** Schema version for VFS segment hash cache. */
export const VFS_SEGMENT_HASH_CACHE_SCHEMA_VERSION = '1.0.0';

const normalizeField = (value, fallback = '') => (value == null ? fallback : String(value));

/**
 * Build a cache key for VFS segment hash entries.
 * @param {object} options
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
  return `${algo}:${fileHash}::${path}::${lang}::${ext}::${range}`;
};

/** Alias for buildVfsSegmentHashCacheKey. */
export const buildDocHashCacheKey = buildVfsSegmentHashCacheKey;

/**
 * Create an LRU-like cache for VFS segment hashes.
 * @param {{ maxEntries?: number }} [options]
 * @returns {object}
 */
export const createVfsSegmentHashCache = ({ maxEntries = 50000 } = {}) => {
  const limit = Number.isFinite(Number(maxEntries)) ? Math.max(1, Math.floor(Number(maxEntries))) : 50000;
  const store = new Map();
  return {
    get(key) {
      if (!key) return null;
      const value = store.get(key) || null;
      if (!value) return null;
      store.delete(key);
      store.set(key, value);
      return value;
    },
    set(key, value) {
      if (!key) return;
      if (store.has(key)) {
        store.delete(key);
      }
      store.set(key, value);
      while (store.size > limit) {
        const oldest = store.keys().next().value;
        if (oldest == null) break;
        store.delete(oldest);
      }
    },
    clear() {
      store.clear();
    },
    get size() {
      return store.size;
    }
  };
};
