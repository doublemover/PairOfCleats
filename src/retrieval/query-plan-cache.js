import fs from 'node:fs';
import { createLruCache } from '../shared/cache.js';
import { incCacheEvent, incCacheEviction, setCacheSize } from '../shared/metrics.js';
import { buildLocalCacheKey } from '../shared/cache-key.js';
import { atomicWriteText } from '../shared/io/atomic-write.js';
import { sortAndTrimEntriesByNewest } from './cache-trim.js';
import {
  QUERY_PLAN_SCHEMA_VERSION,
  QUERY_PARSER_VERSION,
  QUERY_TOKENIZER_VERSION,
  validateQueryPlan
} from './query-plan-schema.js';

const DEFAULT_QUERY_PLAN_CACHE_MAX_ENTRIES = 128;
const DEFAULT_QUERY_PLAN_CACHE_TTL_MS = 10 * 60 * 1000;
const QUERY_PLAN_DISK_CACHE_VERSION = 1;
const DEFAULT_QUERY_PLAN_DISK_MAX_BYTES = 2 * 1024 * 1024;
const DISK_CACHE_PREFIX = `{"version":${QUERY_PLAN_DISK_CACHE_VERSION},"entries":[`;
const DISK_CACHE_SUFFIX = ']}';
const DISK_CACHE_WRAPPER_BYTES = Buffer.byteLength(`${DISK_CACHE_PREFIX}${DISK_CACHE_SUFFIX}`, 'utf8');

const normalizeDiskLimit = (value, fallback) => {
  if (value === null || value === undefined) return fallback;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.floor(numeric));
};

const normalizeQueryText = (query) => String(query ?? '').trim();

const hashSignature = (value, namespace = 'signature') => {
  return buildLocalCacheKey({
    namespace,
    payload: value ?? null
  }).digest;
};

/**
 * Serialize a query plan for caching (RegExp/Set to JSON-friendly).
 * @param {object} plan
 * @returns {object|null}
 */
export function serializeQueryPlan(plan) {
  if (!plan || typeof plan !== 'object') return null;
  const payload = { ...plan };
  if (payload.highlightRegex instanceof RegExp) {
    payload.highlightRegex = {
      source: payload.highlightRegex.source,
      flags: payload.highlightRegex.flags
    };
  }
  if (payload.phraseNgramSet instanceof Set) {
    payload.phraseNgramSet = Array.from(payload.phraseNgramSet);
  }
  if (payload.requiredArtifacts instanceof Set) {
    payload.requiredArtifacts = Array.from(payload.requiredArtifacts);
  }
  if (payload.filterPredicates) delete payload.filterPredicates;
  return payload;
}

/**
 * Hydrate a cached query plan (restore Sets/RegExp).
 * @param {object} raw
 * @returns {object|null}
 */
export function hydrateQueryPlan(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const plan = { ...raw };
  if (Array.isArray(plan.phraseNgramSet)) {
    plan.phraseNgramSet = new Set(plan.phraseNgramSet);
  }
  if (Array.isArray(plan.requiredArtifacts)) {
    plan.requiredArtifacts = new Set(plan.requiredArtifacts);
  }
  if (plan.highlightRegex && typeof plan.highlightRegex === 'object') {
    const source = plan.highlightRegex.source;
    const flags = plan.highlightRegex.flags || '';
    if (typeof source === 'string') {
      try {
        plan.highlightRegex = new RegExp(source, flags);
      } catch {
        plan.highlightRegex = null;
      }
    }
  }
  return plan;
}

const serializeQueryPlanEntry = (entry) => {
  if (!entry || typeof entry !== 'object') return null;
  const plan = serializeQueryPlan(entry.plan);
  if (!plan) return null;
  return { ...entry, plan };
};

const hydrateQueryPlanEntry = (rawEntry, { configSignature, indexSignature } = {}) => {
  if (!rawEntry || typeof rawEntry !== 'object') return null;
  const plan = hydrateQueryPlan(rawEntry.plan);
  if (!plan) return null;
  const entry = { ...rawEntry, plan };
  return validateQueryPlanEntry(entry, { configSignature, indexSignature }) ? entry : null;
};

const readDiskCache = (cachePath) => {
  if (!cachePath || !fs.existsSync(cachePath)) return null;
  try {
    const raw = fs.readFileSync(cachePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const serializeDiskEntry = (entry) => {
  if (!entry || typeof entry !== 'object') return null;
  try {
    const json = JSON.stringify(entry);
    if (typeof json !== 'string') return null;
    return {
      entry,
      json,
      bytes: Buffer.byteLength(json, 'utf8')
    };
  } catch {
    return null;
  }
};

const buildDiskPayloadText = (serializedEntries) => {
  const parts = [];
  for (let index = 0; index < serializedEntries.length; index += 1) {
    const serialized = serializedEntries[index];
    if (!serialized?.json) continue;
    parts.push(serialized.json);
  }
  return `${DISK_CACHE_PREFIX}${parts.join(',')}${DISK_CACHE_SUFFIX}`;
};

const prepareDiskEntries = (entries, { maxEntries, ttlMs, now }) => {
  const limit = normalizeDiskLimit(maxEntries, DEFAULT_QUERY_PLAN_CACHE_MAX_ENTRIES);
  const ttl = normalizeDiskLimit(ttlMs, DEFAULT_QUERY_PLAN_CACHE_TTL_MS);
  const nowMs = typeof now === 'function' ? now() : Date.now();
  const filtered = entries
    .filter((entry) => entry && entry.key && entry.entry)
    .map((entry) => ({ key: entry.key, entry: entry.entry }))
    .filter((entry) => entry.entry && typeof entry.entry.ts === 'number')
    .filter((entry) => !ttl || (nowMs - entry.entry.ts) <= ttl);
  return sortAndTrimEntriesByNewest(filtered, {
    maxEntries: limit > 0 ? limit : null,
    selectTimestamp: (entry) => entry?.entry?.ts
  });
};

const trimEntriesBySize = (entries, maxBytes) => {
  const limit = normalizeDiskLimit(maxBytes, DEFAULT_QUERY_PLAN_DISK_MAX_BYTES);
  if (!limit) return entries;
  const trimmed = [];
  let totalBytes = DISK_CACHE_WRAPPER_BYTES;
  for (const entry of entries) {
    if (!entry?.bytes) continue;
    const candidateBytes = totalBytes + entry.bytes + (trimmed.length ? 1 : 0);
    if (candidateBytes > limit) continue;
    totalBytes = candidateBytes;
    trimmed.push(entry);
  }
  return trimmed;
};

/**
 * Create a disk-backed query plan cache.
 * @param {{path?:string,maxEntries?:number,ttlMs?:number,maxBytes?:number}} [options]
 * @returns {{enabled:boolean,cache:object,size:()=>number,get:(key:string)=>any,set:(key:string,value:any)=>void,resetIfConfigChanged:(sig:string)=>number,load:()=>number,persist:()=>Promise<number>,isDirty:()=>boolean}}
 */
export function createQueryPlanDiskCache({
  path: cachePath = null,
  maxEntries = DEFAULT_QUERY_PLAN_CACHE_MAX_ENTRIES,
  ttlMs = DEFAULT_QUERY_PLAN_CACHE_TTL_MS,
  maxBytes = DEFAULT_QUERY_PLAN_DISK_MAX_BYTES
} = {}) {
  let dirty = false;
  const markDirty = () => {
    dirty = true;
  };
  const base = createQueryPlanCache({
    maxEntries,
    ttlMs,
    onEvict: ({ reason }) => {
      if (reason === 'evict' || reason === 'expire') {
        markDirty();
      }
    }
  });
  if (!base.enabled) {
    return {
      ...base,
      load: () => 0,
      persist: async () => 0,
      isDirty: () => false
    };
  }

  const load = () => {
    if (!cachePath) return 0;
    const data = readDiskCache(cachePath);
    if (!data || data.version !== QUERY_PLAN_DISK_CACHE_VERSION || !Array.isArray(data.entries)) {
      return 0;
    }
    const prepared = prepareDiskEntries(data.entries, { maxEntries, ttlMs });
    let droppedEntries = prepared.length !== data.entries.length;
    let loaded = 0;
    for (const entry of prepared) {
      const hydrated = hydrateQueryPlanEntry(entry.entry);
      if (!hydrated) {
        droppedEntries = true;
        continue;
      }
      base.set(entry.key, hydrated);
      loaded += 1;
    }
    dirty = droppedEntries;
    return loaded;
  };

  const persist = async () => {
    if (!cachePath || !dirty) return 0;
    const entries = [];
    for (const [key, entry] of base.cache.entries()) {
      const serialized = serializeQueryPlanEntry(entry);
      if (!serialized) continue;
      entries.push({ key, entry: serialized });
    }
    const prepared = prepareDiskEntries(entries, { maxEntries, ttlMs });
    const serializedEntries = [];
    for (let index = 0; index < prepared.length; index += 1) {
      const serializedEntry = serializeDiskEntry(prepared[index]);
      if (!serializedEntry) continue;
      serializedEntries.push(serializedEntry);
    }
    const trimmed = trimEntriesBySize(serializedEntries, maxBytes);
    const payloadText = buildDiskPayloadText(trimmed);
    try {
      await atomicWriteText(cachePath, payloadText, { newline: false });
      dirty = false;
      return trimmed.length;
    } catch {
      return 0;
    }
  };

  const resetIfConfigChanged = (nextSignature) => {
    const sizeBefore = base.size();
    base.resetIfConfigChanged(nextSignature);
    if (base.size() < sizeBefore) markDirty();
  };

  const set = (key, entry) => {
    base.set(key, entry);
    markDirty();
  };

  const del = (key) => {
    base.delete(key);
    markDirty();
  };

  const clear = () => {
    base.clear();
    markDirty();
  };

  return {
    enabled: base.enabled,
    cache: base.cache,
    size: base.size,
    get(key, options = {}) {
      const sizeBefore = base.size();
      const value = base.get(key, options);
      if (base.size() < sizeBefore) {
        markDirty();
      }
      return value;
    },
    set,
    delete: del,
    clear,
    resetIfConfigChanged,
    load,
    persist,
    isDirty: () => dirty
  };
}

/**
 * Build a signature for query plan cache config inputs.
 * @param {{queryParserVersion?:string,queryTokenizerVersion?:string,limits?:object,filters?:object,features?:object}} [input]
 * @returns {string}
 */
export function buildQueryPlanConfigSignature({
  dictConfig = null,
  postingsConfig = null,
  caseTokens = false,
  fileFilter = null,
  caseFile = false,
  searchRegexConfig = null,
  filePrefilterEnabled = null,
  fileChargramN = null,
  searchType = null,
  searchAuthor = null,
  searchImport = null,
  chunkAuthorFilter = null,
  branchesMin = null,
  loopsMin = null,
  breaksMin = null,
  continuesMin = null,
  churnMin = null,
  extFilter = null,
  langFilter = null,
  extImpossible = null,
  langImpossible = null,
  metaFilters = null,
  modifiedAfter = null,
  modifiedSinceDays = null,
  fieldWeightsConfig = null,
  denseVectorMode = null,
  branchFilter = null,
  dictSize = null
} = {}) {
  return hashSignature({
    dictConfig,
    dictSize,
    postingsConfig,
    caseTokens,
    fileFilter,
    caseFile,
    searchRegexConfig,
    filePrefilterEnabled,
    fileChargramN,
    searchType,
    searchAuthor,
    searchImport,
    chunkAuthorFilter,
    branchesMin,
    loopsMin,
    breaksMin,
    continuesMin,
    churnMin,
    extFilter,
    langFilter,
    extImpossible,
    langImpossible,
    metaFilters,
    modifiedAfter,
    modifiedSinceDays,
    fieldWeightsConfig,
    denseVectorMode,
    branchFilter
  });
}

/**
 * Normalize index signature for query plan cache keys.
 * @param {string|null} indexSignature
 * @returns {string}
 */
export function buildQueryPlanIndexSignature(indexSignature) {
  return hashSignature(indexSignature ?? null, 'query-plan-index');
}

/**
 * Build a cache key for a query plan.
 * @param {{query:string,configSignature:string,indexSignature:string}} input
 * @returns {string}
 */
export function buildQueryPlanCacheKey({ query, configSignature, indexSignature }) {
  const payload = {
    query: normalizeQueryText(query),
    configSignature: configSignature || null,
    indexSignature: indexSignature || null,
    schemaVersion: QUERY_PLAN_SCHEMA_VERSION,
    parserVersion: QUERY_PARSER_VERSION,
    tokenizerVersion: QUERY_TOKENIZER_VERSION
  };
  const keyInfo = buildLocalCacheKey({
    namespace: 'query-plan',
    payload
  });
  return { key: keyInfo.key, payload };
}

/**
 * Create a cache entry for a query plan.
 * @param {{plan:object,configSignature:string,indexSignature:string,keyPayload?:object}} [input]
 * @returns {object|null}
 */
export function createQueryPlanEntry({ plan, configSignature, indexSignature, keyPayload = null } = {}) {
  return {
    keyPayload,
    configSignature: configSignature || null,
    indexSignature: indexSignature || null,
    schemaVersion: QUERY_PLAN_SCHEMA_VERSION,
    parserVersion: QUERY_PARSER_VERSION,
    tokenizerVersion: QUERY_TOKENIZER_VERSION,
    ts: Date.now(),
    plan
  };
}

/**
 * Validate a query plan cache entry against schema and signatures.
 * @param {object} entry
 * @param {{configSignature?:string,indexSignature?:string}} [options]
 * @returns {boolean}
 */
export function validateQueryPlanEntry(entry, { configSignature, indexSignature } = {}) {
  if (!entry || typeof entry !== 'object') return false;
  if (entry.schemaVersion !== QUERY_PLAN_SCHEMA_VERSION) return false;
  if (entry.parserVersion !== QUERY_PARSER_VERSION) return false;
  if (entry.tokenizerVersion !== QUERY_TOKENIZER_VERSION) return false;
  if (configSignature && entry.configSignature !== configSignature) return false;
  if (indexSignature && entry.indexSignature !== indexSignature) return false;
  return validateQueryPlan(entry.plan);
}

/**
 * Create an in-memory query plan cache with TTL.
 * @param {{maxEntries?:number,ttlMs?:number}} [options]
 * @returns {{enabled:boolean,cache:LRUCache,size:()=>number,get:(key:string)=>any,set:(key:string,value:any)=>void,resetIfConfigChanged:(sig:string)=>number}}
 */
export function createQueryPlanCache({
  maxEntries = DEFAULT_QUERY_PLAN_CACHE_MAX_ENTRIES,
  ttlMs = DEFAULT_QUERY_PLAN_CACHE_TTL_MS,
  onEvict = null
} = {}) {
  const cacheHandle = createLruCache({
    name: 'query-plan',
    maxEntries,
    ttlMs,
    onEvict: ({ key, value, reason }) => {
      if (typeof onEvict === 'function') {
        onEvict({ key, value, reason });
      }
      if (reason === 'evict' || reason === 'expire') {
        incCacheEviction({ cache: 'query-plan' });
      }
      setCacheSize({ cache: 'query-plan', value: cacheHandle.size() });
    },
    onSizeChange: (size) => {
      setCacheSize({ cache: 'query-plan', value: size });
    }
  });
  if (!cacheHandle.cache) {
    return {
      enabled: false,
      resetIfConfigChanged() {},
      get() {
        return null;
      },
      set() {},
      delete() {},
      clear() {},
      size: () => 0,
      cache: null
    };
  }
  let configSignature = null;
  return {
    enabled: true,
    resetIfConfigChanged(nextSignature) {
      if (nextSignature && configSignature && configSignature !== nextSignature) {
        cacheHandle.clear();
      }
      if (nextSignature) configSignature = nextSignature;
    },
    get(key, { configSignature: expectedConfig, indexSignature: expectedIndex } = {}) {
      const entry = cacheHandle.get(key);
      const valid = validateQueryPlanEntry(entry, {
        configSignature: expectedConfig,
        indexSignature: expectedIndex
      });
      if (!valid && entry) {
        cacheHandle.delete(key);
      }
      incCacheEvent({ cache: 'query-plan', result: valid ? 'hit' : 'miss' });
      return valid ? entry : null;
    },
    set(key, entry) {
      cacheHandle.set(key, entry);
    },
    delete(key) {
      cacheHandle.delete(key);
    },
    clear() {
      cacheHandle.clear();
    },
    size: cacheHandle.size,
    cache: cacheHandle.cache
  };
}
