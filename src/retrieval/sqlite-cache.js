import fsSync from 'node:fs';
import { createLruCache } from '../shared/cache/lru.js';
import { incCacheEviction, setCacheSize } from '../shared/metrics/core.js';
import { stableStringifyForSignature } from '../shared/stable-json.js';
import { createSqliteCacheCloseOwner } from './sqlite-cache-close-owner.js';

const DEFAULT_SQLITE_CACHE_MAX_ENTRIES = 4;
const DEFAULT_SQLITE_CACHE_TTL_MS = 15 * 60 * 1000;

const fileSignature = (filePath) => {
  try {
    const stat = fsSync.statSync(filePath);
    return `${stat.size}:${stat.mtimeMs}`;
  } catch {
    return null;
  }
};

const normalizeGenerationTag = (generationTag = null) => {
  if (generationTag == null) return null;
  if (typeof generationTag === 'string') {
    const trimmed = generationTag.trim();
    return trimmed || null;
  }
  return stableStringifyForSignature(generationTag);
};

const buildCacheKey = (dbPath, generationTag = null) => (
  `${dbPath}|generation:${normalizeGenerationTag(generationTag) || 'default'}`
);

const isEntryForPath = (entry, dbPath) => entry?.dbPath === dbPath;

export function createSqliteDbCache({
  maxEntries = DEFAULT_SQLITE_CACHE_MAX_ENTRIES,
  ttlMs = DEFAULT_SQLITE_CACHE_TTL_MS,
  onEvict = null
} = {}) {
  let disposed = false;
  let cleanupErrors = null;
  const retiredEntries = new Set(), deferredErrors = new Set();
  const attemptCleanup = (action) => {
    try {
      action();
    } catch (error) {
      // LRU callbacks must finish so one failed close cannot interrupt eviction.
      // Explicit cleanup operations report failures after attempting every entry.
      if (cleanupErrors) cleanupErrors.push(error);
      else deferredErrors.add(error);
    }
  };
  const withCleanupErrors = (action) => {
    const previousErrors = cleanupErrors;
    const errors = [];
    cleanupErrors = errors;
    try {
      action();
    } catch (error) {
      errors.push(error);
    } finally {
      cleanupErrors = previousErrors;
    }
    errors.push(...deferredErrors); deferredErrors.clear();
    for (const entry of retiredEntries) {
      if (entry.owner.lastError && !entry.owner.isSettled()) errors.push(entry.owner.lastError);
    }
    if (errors.length) {
      const unique = [...new Set(errors)], owners = [...new Set([...retiredEntries].map(entry => entry.owner))];
      const failure = new AggregateError(unique, 'Failed to close SQLite cache handles.', { cause: unique[0] });
      Object.defineProperties(failure, { sqliteCacheOwners: { value: Object.freeze(owners) },
        cacheOwnershipPending: { get: () => owners.some(owner => !owner.isSettled()) },
        cacheOwnershipReleased: { value: () => owners.every(owner => owner.isSettled()) } });
      throw failure;
    }
  };
  const closeRetiredEntry = (entry) => {
    if (!entry || !entry.retired || entry.refs || entry.closed) return;
    retiredEntries.add(entry);
    attemptCleanup(() => entry.owner.retire());
  };
  const createLease = (entry) => {
    entry.refs += 1;
    let released = false;
    return {
      db: entry.db,
      release() {
        if (released) {
          if (entry.owner.lastError && !entry.owner.isSettled()) withCleanupErrors(() => {});
          return;
        }
        released = true;
        withCleanupErrors(() => {
          entry.refs -= 1;
          closeRetiredEntry(entry);
        });
      }
    };
  };
  const cacheHandle = createLruCache({
    name: 'sqlite',
    maxEntries,
    ttlMs,
    onEvict: ({ key, value, reason }) => {
      value.retired = true;
      retiredEntries.add(value);
      closeRetiredEntry(value);
      if (typeof onEvict === 'function') {
        attemptCleanup(() => onEvict({ key, entry: value, reason }));
      }
      if (reason === 'evict' || reason === 'expire') {
        incCacheEviction({ cache: 'sqlite' });
      }
      setCacheSize({ cache: 'sqlite', value: cacheHandle.size() });
    },
    onSizeChange: (size) => {
      setCacheSize({ cache: 'sqlite', value: size });
    }
  });
  const getEntry = (dbPath, options = {}) => {
    if (disposed) return null;
    const cacheKey = buildCacheKey(dbPath, options.generationTag);
    const entry = cacheHandle.get(cacheKey);
    if (!entry) return null;
    const signature = fileSignature(dbPath);
    if (!signature || signature !== entry.signature) {
      cacheHandle.delete(cacheKey);
      return null;
    }
    return entry;
  };

  const get = (dbPath, options = {}) => getEntry(dbPath, options)?.db || null;
  const acquire = (dbPath, options = {}) => {
    const entry = getEntry(dbPath, options);
    return entry ? createLease(entry) : null;
  };
  const makeEntry = (dbPath, db, options) => {
    const entry = { db, dbPath, generationTag: normalizeGenerationTag(options.generationTag),
      signature: fileSignature(dbPath), refs: 0, retired: disposed || !cacheHandle.cache, closed: false };
    entry.owner = createSqliteCacheCloseOwner(db, {
      canClose: () => entry.retired && entry.refs === 0,
      onClosed: () => { entry.closed = true; retiredEntries.delete(entry); }
    });
    return entry;
  };
  const insertEntry = (entry) => {
    const { dbPath, generationTag } = entry;
    const cacheKey = buildCacheKey(dbPath, generationTag);
    for (const [existingKey, existingEntry] of cacheHandle.cache.entries()) {
      if (!isEntryForPath(existingEntry, dbPath) || existingKey === cacheKey) continue;
      cacheHandle.delete(existingKey);
    }
    cacheHandle.set(cacheKey, entry);
  };
  const set = (dbPath, db, options = {}) => {
    if (disposed || !cacheHandle.cache) return;
    insertEntry(makeEntry(dbPath, db, options));
  };
  const setAndAcquire = (dbPath, db, options = {}) => {
    const entry = makeEntry(dbPath, db, options);
    // Pin before inserting: maxEntries eviction must never close a live request.
    const lease = createLease(entry);
    if (!entry.retired) insertEntry(entry);
    return lease;
  };

  const close = (dbPath, options = {}) => withCleanupErrors(() => {
    if (!cacheHandle.cache) return;
    const normalizedGenerationTag = normalizeGenerationTag(options.generationTag);
    for (const [existingKey, existingEntry] of cacheHandle.cache.entries()) {
      if (!isEntryForPath(existingEntry, dbPath)) continue;
      if (normalizedGenerationTag && existingEntry.generationTag !== normalizedGenerationTag) continue;
      if (options.expectedDb && existingEntry.db !== options.expectedDb) continue;
      cacheHandle.delete(existingKey);
    }
  });

  const closeAll = () => withCleanupErrors(() => cacheHandle.clear());
  const dispose = () => {
    disposed = true;
    closeAll();
  };

  return {
    get,
    set,
    acquire,
    setAndAcquire,
    close,
    closeAll,
    dispose,
    retainFailure(error) {
      const entries = new Set([...retiredEntries, ...(cacheHandle.cache?.values() || [])]);
      for (const entry of entries) entry.owner.retainFailure(error);
    },
    pendingOwners: () => Object.freeze([...retiredEntries].map(entry => entry.owner)),
    size: cacheHandle.size
  };
}
