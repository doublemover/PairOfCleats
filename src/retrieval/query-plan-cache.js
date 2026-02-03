import { LRUCache } from 'lru-cache';
import { incCacheEvent, incCacheEviction, setCacheSize } from '../shared/metrics.js';
import { sha1 } from '../shared/hash.js';
import { stableStringifyForSignature } from '../shared/stable-json.js';
import {
  QUERY_PLAN_SCHEMA_VERSION,
  QUERY_PARSER_VERSION,
  QUERY_TOKENIZER_VERSION,
  validateQueryPlan
} from './query-plan-schema.js';

const DEFAULT_QUERY_PLAN_CACHE_MAX_ENTRIES = 128;
const DEFAULT_QUERY_PLAN_CACHE_TTL_MS = 10 * 60 * 1000;

const normalizeQueryText = (query) => String(query ?? '').trim();

const hashSignature = (value) => {
  const raw = stableStringifyForSignature(value ?? null);
  return sha1(raw);
};

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

export function buildQueryPlanIndexSignature(indexSignature) {
  return hashSignature(indexSignature ?? null);
}

export function buildQueryPlanCacheKey({ query, configSignature, indexSignature }) {
  const payload = {
    query: normalizeQueryText(query),
    configSignature: configSignature || null,
    indexSignature: indexSignature || null,
    schemaVersion: QUERY_PLAN_SCHEMA_VERSION,
    parserVersion: QUERY_PARSER_VERSION,
    tokenizerVersion: QUERY_TOKENIZER_VERSION
  };
  return { key: hashSignature(payload), payload };
}

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

export function validateQueryPlanEntry(entry, { configSignature, indexSignature } = {}) {
  if (!entry || typeof entry !== 'object') return false;
  if (entry.schemaVersion !== QUERY_PLAN_SCHEMA_VERSION) return false;
  if (entry.parserVersion !== QUERY_PARSER_VERSION) return false;
  if (entry.tokenizerVersion !== QUERY_TOKENIZER_VERSION) return false;
  if (configSignature && entry.configSignature !== configSignature) return false;
  if (indexSignature && entry.indexSignature !== indexSignature) return false;
  return validateQueryPlan(entry.plan);
}

export function createQueryPlanCache({
  maxEntries = DEFAULT_QUERY_PLAN_CACHE_MAX_ENTRIES,
  ttlMs = DEFAULT_QUERY_PLAN_CACHE_TTL_MS,
  onEvict = null
} = {}) {
  const resolvedMax = Number.isFinite(Number(maxEntries))
    ? Math.floor(Number(maxEntries))
    : DEFAULT_QUERY_PLAN_CACHE_MAX_ENTRIES;
  const resolvedTtlMs = Number.isFinite(Number(ttlMs))
    ? Math.max(0, Number(ttlMs))
    : DEFAULT_QUERY_PLAN_CACHE_TTL_MS;
  if (!resolvedMax || resolvedMax <= 0) {
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
  const cache = new LRUCache({
    max: resolvedMax,
    ttl: resolvedTtlMs > 0 ? resolvedTtlMs : undefined,
    allowStale: false,
    updateAgeOnGet: true,
    dispose: (value, key, reason) => {
      if (typeof onEvict === 'function') {
        onEvict({ key, value, reason });
      }
      if (reason === 'evict' || reason === 'expire') {
        incCacheEviction({ cache: 'query-plan' });
      }
      setCacheSize({ cache: 'query-plan', value: cache.size });
    }
  });
  let configSignature = null;
  return {
    enabled: true,
    resetIfConfigChanged(nextSignature) {
      if (nextSignature && configSignature && configSignature !== nextSignature) {
        cache.clear();
        setCacheSize({ cache: 'query-plan', value: cache.size });
      }
      if (nextSignature) configSignature = nextSignature;
    },
    get(key, { configSignature: expectedConfig, indexSignature: expectedIndex } = {}) {
      const entry = cache.get(key);
      const valid = validateQueryPlanEntry(entry, {
        configSignature: expectedConfig,
        indexSignature: expectedIndex
      });
      if (!valid && entry) {
        cache.delete(key);
        setCacheSize({ cache: 'query-plan', value: cache.size });
      }
      incCacheEvent({ cache: 'query-plan', result: valid ? 'hit' : 'miss' });
      return valid ? entry : null;
    },
    set(key, entry) {
      cache.set(key, entry);
      setCacheSize({ cache: 'query-plan', value: cache.size });
    },
    delete(key) {
      cache.delete(key);
      setCacheSize({ cache: 'query-plan', value: cache.size });
    },
    clear() {
      cache.clear();
      setCacheSize({ cache: 'query-plan', value: cache.size });
    },
    size: () => cache.size,
    cache
  };
}
