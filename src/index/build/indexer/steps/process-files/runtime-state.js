import fs from 'node:fs/promises';
import path from 'node:path';

import { createLruCache, estimateJsonBytes } from '../../../../../shared/cache.js';
import { atomicWriteJson } from '../../../../../shared/io/atomic-write.js';
import { normalizeExtractedProseYieldProfilePrefilterConfig } from '../../../../chunking/formats/document-common.js';

const extractedProseExtrasCacheByRuntime = new WeakMap();
const sharedScmMetaCacheByRuntime = new WeakMap();

const EXTRACTED_PROSE_RUNTIME_STATE_DIR = 'runtime';
const EXTRACTED_PROSE_YIELD_PROFILE_FILE = 'extracted-prose-yield-profile.json';
export const EXTRACTED_PROSE_YIELD_PROFILE_VERSION = 1;
export const DOCUMENT_EXTRACTION_CACHE_FILE = 'document-extraction-cache.json';
const DOCUMENT_EXTRACTION_CACHE_VERSION = 1;
export const DOCUMENT_EXTRACTION_CACHE_MAX_LOAD_BYTES = 16 * 1024 * 1024;
export const DOCUMENT_EXTRACTION_CACHE_MAX_ENTRIES = 2048;
export const DOCUMENT_EXTRACTION_CACHE_MAX_TOTAL_ENTRY_BYTES = 8 * 1024 * 1024;
export const DOCUMENT_EXTRACTION_CACHE_MAX_ENTRY_TEXT_BYTES = 512 * 1024;

const isPlainObject = (value) => (
  value && typeof value === 'object' && !Array.isArray(value)
);

export const toSafeNonNegativeInt = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.floor(parsed);
};

export const normalizeYieldProfileFamilyStats = (value) => {
  const observedFiles = toSafeNonNegativeInt(value?.observedFiles);
  const yieldedFiles = Math.min(observedFiles, toSafeNonNegativeInt(value?.yieldedFiles));
  const chunkCount = toSafeNonNegativeInt(value?.chunkCount);
  return {
    observedFiles,
    yieldedFiles,
    chunkCount,
    yieldRatio: observedFiles > 0 ? yieldedFiles / observedFiles : 0
  };
};

export const normalizeYieldProfileEntry = (value, configFallback = null) => {
  const entry = isPlainObject(value) ? value : {};
  const families = isPlainObject(entry.families) ? entry.families : {};
  const cohorts = isPlainObject(entry.cohorts) ? entry.cohorts : {};
  const normalizedFamilies = {};
  for (const [familyKey, familyStats] of Object.entries(families)) {
    if (!familyKey) continue;
    normalizedFamilies[familyKey] = normalizeYieldProfileFamilyStats(familyStats);
  }
  const normalizedCohorts = {};
  for (const [cohortKey, cohortStats] of Object.entries(cohorts)) {
    if (!cohortKey) continue;
    normalizedCohorts[cohortKey] = normalizeYieldProfileFamilyStats(cohortStats);
  }
  const totals = normalizeYieldProfileFamilyStats(entry.totals || {});
  return {
    config: normalizeExtractedProseYieldProfilePrefilterConfig(entry.config || configFallback || null),
    builds: toSafeNonNegativeInt(entry.builds),
    totals,
    families: normalizedFamilies,
    cohorts: normalizedCohorts,
    fingerprint: isPlainObject(entry.fingerprint) ? entry.fingerprint : null
  };
};

const normalizeYieldProfileState = (value, configFallback = null) => {
  const payload = isPlainObject(value) ? value : {};
  const entries = isPlainObject(payload.entries) ? payload.entries : {};
  return {
    version: EXTRACTED_PROSE_YIELD_PROFILE_VERSION,
    entries: {
      'extracted-prose': normalizeYieldProfileEntry(entries['extracted-prose'], configFallback)
    }
  };
};

const resolveRuntimeStatePath = (runtime, fileName) => {
  const repoCacheRoot = typeof runtime?.repoCacheRoot === 'string'
    ? runtime.repoCacheRoot.trim()
    : '';
  if (!repoCacheRoot) return null;
  return path.join(repoCacheRoot, EXTRACTED_PROSE_RUNTIME_STATE_DIR, fileName);
};

const readJsonIfExists = async (filePath, { maxBytes = null, label = 'json' } = {}) => {
  if (!filePath) return null;
  try {
    if (Number.isFinite(Number(maxBytes)) && Number(maxBytes) > 0) {
      const fileStat = await fs.stat(filePath);
      const cappedMaxBytes = Math.floor(Number(maxBytes));
      if (Number(fileStat?.size || 0) > cappedMaxBytes) {
        const err = new Error(
          `[stage1:extracted-prose] ${label} exceeds load limit `
          + `(${fileStat.size} > ${cappedMaxBytes} bytes)`
        );
        err.code = 'ERR_JSON_FILE_TOO_LARGE';
        err.meta = { filePath, label, bytes: fileStat.size, maxBytes: cappedMaxBytes };
        throw err;
      }
    }
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err?.code === 'ENOENT') return null;
    throw err;
  }
};

export const loadExtractedProseYieldProfileState = async ({ runtime, log: logger = null }) => {
  const config = normalizeExtractedProseYieldProfilePrefilterConfig(
    runtime?.indexingConfig?.extractedProse?.prefilter?.yieldProfile || null
  );
  const profilePath = resolveRuntimeStatePath(runtime, EXTRACTED_PROSE_YIELD_PROFILE_FILE);
  if (!profilePath) {
    return normalizeYieldProfileState(null, config);
  }
  try {
    const loaded = await readJsonIfExists(profilePath);
    return normalizeYieldProfileState(loaded, config);
  } catch (err) {
    if (typeof logger === 'function') {
      logger(`[stage1:extracted-prose] failed to load yield profile: ${err?.message || err}`);
    }
    return normalizeYieldProfileState(null, config);
  }
};

export const persistExtractedProseYieldProfileState = async ({ runtime, state, log: logger = null }) => {
  const profilePath = resolveRuntimeStatePath(runtime, EXTRACTED_PROSE_YIELD_PROFILE_FILE);
  if (!profilePath) return;
  try {
    await atomicWriteJson(profilePath, state, { spaces: 2, newline: true });
  } catch (err) {
    if (typeof logger === 'function') {
      logger(`[stage1:extracted-prose] failed to persist yield profile: ${err?.message || err}`);
    }
  }
};

const normalizeDocumentExtractionCacheState = (value) => {
  const payload = isPlainObject(value) ? value : {};
  const entries = isPlainObject(payload.entries) ? payload.entries : {};
  const normalizedEntries = {};
  for (const [cacheKey, record] of Object.entries(entries)) {
    if (!cacheKey || !isPlainObject(record)) continue;
    normalizedEntries[cacheKey] = record;
  }
  return {
    version: DOCUMENT_EXTRACTION_CACHE_VERSION,
    entries: normalizedEntries
  };
};

const resolveDocumentExtractionCachePersistencePolicy = () => ({
  maxLoadBytes: DOCUMENT_EXTRACTION_CACHE_MAX_LOAD_BYTES,
  maxEntries: DOCUMENT_EXTRACTION_CACHE_MAX_ENTRIES,
  maxTotalEntryBytes: DOCUMENT_EXTRACTION_CACHE_MAX_TOTAL_ENTRY_BYTES,
  maxEntryTextBytes: DOCUMENT_EXTRACTION_CACHE_MAX_ENTRY_TEXT_BYTES
});

export const compactDocumentExtractionCacheEntries = (entries, policy = resolveDocumentExtractionCachePersistencePolicy()) => {
  const sourceEntries = isPlainObject(entries) ? entries : {};
  const maxEntries = Math.max(1, Math.floor(Number(policy?.maxEntries) || DOCUMENT_EXTRACTION_CACHE_MAX_ENTRIES));
  const maxTotalEntryBytes = Math.max(
    1,
    Math.floor(Number(policy?.maxTotalEntryBytes) || DOCUMENT_EXTRACTION_CACHE_MAX_TOTAL_ENTRY_BYTES)
  );
  const maxEntryTextBytes = Math.max(
    1,
    Math.floor(Number(policy?.maxEntryTextBytes) || DOCUMENT_EXTRACTION_CACHE_MAX_ENTRY_TEXT_BYTES)
  );
  const orderedEntries = Object.entries(sourceEntries);
  const keptNewestFirst = [];
  let totalEntryBytes = 0;
  let droppedForEntryTextBytes = 0;
  let droppedForTotalBytes = 0;
  let droppedForMaxEntries = 0;
  for (let i = orderedEntries.length - 1; i >= 0; i -= 1) {
    const [cacheKey, record] = orderedEntries[i];
    if (!cacheKey || !isPlainObject(record)) continue;
    if (keptNewestFirst.length >= maxEntries) {
      droppedForMaxEntries += 1;
      continue;
    }
    const text = typeof record.text === 'string' ? record.text : '';
    const textBytes = Buffer.byteLength(text, 'utf8');
    if (textBytes > maxEntryTextBytes) {
      droppedForEntryTextBytes += 1;
      continue;
    }
    const entryBytes = Math.max(1, Math.floor(estimateJsonBytes(record)));
    if (totalEntryBytes + entryBytes > maxTotalEntryBytes) {
      droppedForTotalBytes += 1;
      continue;
    }
    totalEntryBytes += entryBytes;
    keptNewestFirst.push([cacheKey, record]);
  }
  keptNewestFirst.reverse();
  const compactedEntries = Object.fromEntries(keptNewestFirst);
  return {
    entries: compactedEntries,
    stats: {
      inputEntries: orderedEntries.length,
      keptEntries: keptNewestFirst.length,
      droppedEntries: Math.max(0, orderedEntries.length - keptNewestFirst.length),
      droppedForEntryTextBytes,
      droppedForTotalBytes,
      droppedForMaxEntries,
      totalEntryBytes,
      maxEntries,
      maxTotalEntryBytes,
      maxEntryTextBytes
    }
  };
};

export const loadDocumentExtractionCacheState = async ({ runtime, log: logger = null }) => {
  const cachePath = resolveRuntimeStatePath(runtime, DOCUMENT_EXTRACTION_CACHE_FILE);
  if (!cachePath) return normalizeDocumentExtractionCacheState(null);
  const policy = resolveDocumentExtractionCachePersistencePolicy();
  try {
    const loaded = await readJsonIfExists(cachePath, {
      maxBytes: policy.maxLoadBytes,
      label: DOCUMENT_EXTRACTION_CACHE_FILE
    });
    const normalized = normalizeDocumentExtractionCacheState(loaded);
    const compacted = compactDocumentExtractionCacheEntries(normalized.entries, policy);
    if (typeof logger === 'function' && compacted.stats.droppedEntries > 0) {
      logger(
        `[stage1:extracted-prose] compacted document extraction cache `
        + `(${compacted.stats.inputEntries} -> ${compacted.stats.keptEntries}; `
        + `dropMaxEntries=${compacted.stats.droppedForMaxEntries}, `
        + `dropTotalBytes=${compacted.stats.droppedForTotalBytes}, `
        + `dropEntryTextBytes=${compacted.stats.droppedForEntryTextBytes}).`
      );
    }
    return {
      version: DOCUMENT_EXTRACTION_CACHE_VERSION,
      entries: compacted.entries
    };
  } catch (err) {
    if (typeof logger === 'function') {
      logger(`[stage1:extracted-prose] failed to load document extraction cache: ${err?.message || err}`);
    }
    return normalizeDocumentExtractionCacheState(null);
  }
};

export const createMutableKeyValueStore = (entries = null) => {
  const map = new Map();
  if (isPlainObject(entries)) {
    for (const [key, value] of Object.entries(entries)) {
      if (!key) continue;
      map.set(key, value);
    }
  }
  return {
    get(key) {
      if (!key || !map.has(key)) return null;
      const value = map.get(key);
      map.delete(key);
      map.set(key, value);
      return value;
    },
    set(key, value) {
      if (!key) return;
      if (map.has(key)) {
        map.delete(key);
      }
      map.set(key, value);
    },
    snapshot() {
      return Object.fromEntries(map.entries());
    }
  };
};

export const persistDocumentExtractionCacheState = async ({ runtime, cacheStore, log: logger = null }) => {
  const cachePath = resolveRuntimeStatePath(runtime, DOCUMENT_EXTRACTION_CACHE_FILE);
  if (!cachePath || !cacheStore || typeof cacheStore.snapshot !== 'function') return;
  const policy = resolveDocumentExtractionCachePersistencePolicy();
  const compacted = compactDocumentExtractionCacheEntries(cacheStore.snapshot(), policy);
  if (typeof logger === 'function' && compacted.stats.droppedEntries > 0) {
    logger(
      `[stage1:extracted-prose] persisted compacted document extraction cache `
      + `(${compacted.stats.inputEntries} -> ${compacted.stats.keptEntries}; `
      + `dropMaxEntries=${compacted.stats.droppedForMaxEntries}, `
      + `dropTotalBytes=${compacted.stats.droppedForTotalBytes}, `
      + `dropEntryTextBytes=${compacted.stats.droppedForEntryTextBytes}).`
    );
  }
  const payload = {
    version: DOCUMENT_EXTRACTION_CACHE_VERSION,
    entries: compacted.entries
  };
  try {
    await atomicWriteJson(cachePath, payload, { spaces: 2, newline: true });
  } catch (err) {
    if (typeof logger === 'function') {
      logger(`[stage1:extracted-prose] failed to persist document extraction cache: ${err?.message || err}`);
    }
  }
};

export const resolveExtractedProseExtrasCache = (runtime, cacheReporter = null) => {
  if (!runtime || typeof runtime !== 'object') {
    return createLruCache({
      name: 'extractedProseExtras',
      maxEntries: 10000,
      sizeCalculation: estimateJsonBytes,
      reporter: cacheReporter
    });
  }
  const existing = extractedProseExtrasCacheByRuntime.get(runtime);
  if (existing) return existing;
  const cacheConfig = runtime?.cacheConfig?.extractedProseExtras || {};
  const cache = createLruCache({
    name: 'extractedProseExtras',
    maxEntries: cacheConfig.maxEntries,
    maxMb: cacheConfig.maxMb,
    ttlMs: cacheConfig.ttlMs,
    sizeCalculation: estimateJsonBytes,
    reporter: cacheReporter
  });
  extractedProseExtrasCacheByRuntime.set(runtime, cache);
  return cache;
};

export const resolveSharedScmMetaCache = (runtime, cacheReporter = null) => {
  if (!runtime || typeof runtime !== 'object') {
    return createLruCache({
      name: 'sharedScmMeta',
      maxEntries: 5000,
      sizeCalculation: estimateJsonBytes,
      reporter: cacheReporter
    });
  }
  const existing = sharedScmMetaCacheByRuntime.get(runtime);
  if (existing) return existing;
  const cacheConfig = runtime?.cacheConfig?.gitMeta || {};
  const cache = createLruCache({
    name: 'sharedScmMeta',
    maxEntries: cacheConfig.maxEntries,
    maxMb: cacheConfig.maxMb,
    ttlMs: cacheConfig.ttlMs,
    sizeCalculation: estimateJsonBytes,
    reporter: cacheReporter
  });
  sharedScmMetaCacheByRuntime.set(runtime, cache);
  return cache;
};

export { normalizeExtractedProseYieldProfilePrefilterConfig };
