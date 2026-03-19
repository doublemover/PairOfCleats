import fs from 'node:fs/promises';
import path from 'node:path';
import { rangeToOffsets } from '../../lsp/positions.js';
import { flattenSymbols } from '../../lsp/symbols.js';
import { writeJsonObjectFile } from '../../../../shared/json-stream.js';
import { throwIfAborted } from '../../../../shared/abort.js';
import { resolveNearestRankPercentile } from '../../../../shared/perf/percentiles.js';
import { canonicalizeTypeText } from '../../../../shared/type-normalization.js';
import {
  buildScopedSymbolId,
  buildSignatureKey,
  buildSymbolId,
  buildSymbolKey
} from '../../../../shared/identity.js';
import { findTargetForOffsets } from './target-index.js';
import {
  decodeSemanticTokens,
  findSemanticTokenAtPosition,
  parseInlayHintSignalInfo
} from './semantic-signals.js';

export const DEFAULT_DOCUMENT_SYMBOL_CONCURRENCY = 4;
export const DEFAULT_HOVER_CONCURRENCY = 8;
export const DEFAULT_LSP_REQUEST_CACHE_MAX_ENTRIES = 50000;
export const LSP_REQUEST_CACHE_POLICY_VERSION = 'rq1';
const LSP_REQUEST_CACHE_SCHEMA_VERSION = 1;
const LSP_REQUEST_CACHE_MAX_READ_BYTES = 16 * 1024 * 1024;
const LSP_REQUEST_CACHE_NEGATIVE_TTL_MS = 30 * 1000;

/**
 * Clamp numeric values to an integer range with fallback.
 * @param {unknown} value
 * @param {number} fallback
 * @param {{min?:number,max?:number}} [bounds]
 * @returns {number}
 */
export const clampIntRange = (value, fallback, { min = 1, max = 64 } = {}) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const normalized = Math.floor(parsed);
  return Math.max(min, Math.min(max, normalized));
};

/**
 * Run async work over a list with a fixed worker pool.
 * @param {Array<any>} items
 * @param {number} concurrency
 * @param {(item:any,index:number)=>Promise<void>} worker
 * @param {{signal?:AbortSignal|null}} [options]
 * @returns {Promise<void>}
 */
export const runWithConcurrency = async (items, concurrency, worker, options = {}) => {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return;
  const signal = options?.signal && typeof options.signal.aborted === 'boolean'
    ? options.signal
    : null;
  const maxWorkers = Math.max(1, Math.min(list.length, clampIntRange(concurrency, 1, { min: 1, max: 128 })));
  let index = 0;
  const runners = Array.from({ length: maxWorkers }, async () => {
    while (true) {
      throwIfAborted(signal);
      const current = index;
      index += 1;
      if (current >= list.length) break;
      throwIfAborted(signal);
      await worker(list[current], current);
      throwIfAborted(signal);
    }
  });
  await Promise.all(runners);
};

/**
 * Create a generic concurrency limiter for promise-returning tasks.
 * @param {number} concurrency
 * @returns {(fn:()=>Promise<any>)=>Promise<any>}
 */
export const createConcurrencyLimiter = (concurrency) => {
  const maxWorkers = Math.max(1, clampIntRange(concurrency, 1, { min: 1, max: 256 }));
  let active = 0;
  let queue = [];
  let queueHead = 0;

  const dequeue = () => {
    if (queueHead >= queue.length) return null;
    const task = queue[queueHead];
    queueHead += 1;
    // Keep dequeue O(1) and compact periodically.
    if (queueHead >= 1024 && queueHead * 2 >= queue.length) {
      queue = queue.slice(queueHead);
      queueHead = 0;
    }
    return task;
  };

  const pump = () => {
    while (active < maxWorkers) {
      const task = dequeue();
      if (!task) break;
      active += 1;
      Promise.resolve()
        .then(task.fn)
        .then(task.resolve, task.reject)
        .finally(() => {
          active -= 1;
          pump();
        });
    }
  };

  return (fn) => new Promise((resolve, reject) => {
    queue.push({ fn, resolve, reject });
    pump();
  });
};

const resolveLspRequestCachePath = (cacheRoot) => {
  if (!cacheRoot) return null;
  return path.join(cacheRoot, 'lsp', `request-cache-v${LSP_REQUEST_CACHE_SCHEMA_VERSION}.json`);
};

const emitLspRequestCacheWarning = (log, message) => {
  if (typeof log === 'function') {
    log(message);
    return;
  }
  try {
    process.emitWarning(message, { code: 'LSP_REQUEST_CACHE_WARNING' });
  } catch {}
};

const normalizeRequestCacheProviderValue = (value) => String(value || '').trim().toLowerCase();

const toFiniteTimestamp = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
};

const normalizeCachedRequestInfo = (info) => {
  if (!info || typeof info !== 'object' || Array.isArray(info)) return null;
  const signature = normalizeTypeText(info.signature);
  const returnType = normalizeTypeText(info.returnType);
  const paramNames = normalizeParamNames(info.paramNames);
  const paramTypes = normalizeParamTypes(info.paramTypes, { defaultConfidence: 0.7 });
  if (!signature && !returnType && !paramNames.length && !paramTypes) return null;
  return {
    ...(signature ? { signature } : {}),
    ...(returnType ? { returnType } : {}),
    ...(paramNames.length ? { paramNames } : {}),
    ...(paramTypes ? { paramTypes } : {})
  };
};

const normalizeRequestCacheEntry = (entry) => {
  if (!entry || typeof entry !== 'object') return null;
  const requestKind = String(entry.requestKind || '').trim().toLowerCase();
  if (!requestKind) return null;
  const negative = entry.negative === true;
  const at = toFiniteTimestamp(entry.at);
  const expiresAt = toFiniteTimestamp(entry.expiresAt);
  const info = negative ? null : normalizeCachedRequestInfo(entry.info);
  if (!negative && !info) return null;
  return {
    requestKind,
    negative,
    ...(info ? { info } : {}),
    ...(at > 0 ? { at } : {}),
    ...(expiresAt > 0 ? { expiresAt } : {})
  };
};

const isExpiredRequestCacheEntry = (entry, now = Date.now()) => {
  const expiresAt = toFiniteTimestamp(entry?.expiresAt);
  return expiresAt > 0 && expiresAt <= now;
};

/**
 * Load persisted LSP request cache from disk.
 * Invalid/missing cache files degrade to an empty cache.
 *
 * @param {string|null} cacheRoot
 * @param {{log?:(message:string)=>void}} [options]
 * @returns {Promise<{path:string|null,entries:Map<string,object>,persistedKeys:Set<string>}>}
 */
export const loadLspRequestCache = async (cacheRoot, { log = null } = {}) => {
  const cachePath = resolveLspRequestCachePath(cacheRoot);
  if (!cachePath) return { path: null, entries: new Map(), persistedKeys: new Set() };
  try {
    const stat = await fs.stat(cachePath);
    if (Number.isFinite(Number(stat?.size)) && Number(stat.size) > LSP_REQUEST_CACHE_MAX_READ_BYTES) {
      emitLspRequestCacheWarning(
        log,
        `[tooling] LSP request cache oversized (${stat.size} bytes > ${LSP_REQUEST_CACHE_MAX_READ_BYTES}); skipping cache load.`
      );
      return { path: cachePath, entries: new Map(), persistedKeys: new Set() };
    }
    const raw = await fs.readFile(cachePath, 'utf8');
    const parsed = JSON.parse(raw);
    const version = Number(parsed?.version);
    if (Number.isFinite(version) && version !== LSP_REQUEST_CACHE_SCHEMA_VERSION) {
      return { path: cachePath, entries: new Map(), persistedKeys: new Set() };
    }
    const rows = Array.isArray(parsed?.entries) ? parsed.entries : [];
    const entries = new Map();
    const persistedKeys = new Set();
    const now = Date.now();
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      if (typeof row.key !== 'string' || !row.key) continue;
      const value = normalizeRequestCacheEntry(row.value);
      if (!value || isExpiredRequestCacheEntry(value, now)) continue;
      entries.set(row.key, value);
      persistedKeys.add(row.key);
    }
    return { path: cachePath, entries, persistedKeys };
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      emitLspRequestCacheWarning(
        log,
        `[tooling] LSP request cache load failed (${error?.code || 'ERR_REQUEST_CACHE_LOAD'}): ${error?.message || error}`
      );
    }
    return { path: cachePath, entries: new Map(), persistedKeys: new Set() };
  }
};

/**
 * Persist LSP request cache entries with recency ordering and bounded size.
 * @param {{cachePath:string|null,entries:Map<string,object>,maxEntries:number}} input
 * @returns {Promise<void>}
 */
export const persistLspRequestCache = async ({ cachePath, entries, maxEntries }) => {
  if (!cachePath || !(entries instanceof Map)) return;
  const now = Date.now();
  const rows = Array.from(entries.entries())
    .map(([key, value]) => ({
      key,
      value: normalizeRequestCacheEntry(value)
    }))
    .filter((entry) => entry.value && !isExpiredRequestCacheEntry(entry.value, now));
  rows.sort((a, b) => Number(b?.value?.at || 0) - Number(a?.value?.at || 0));
  const cap = clampIntRange(maxEntries, DEFAULT_LSP_REQUEST_CACHE_MAX_ENTRIES, { min: 1000, max: 200000 });
  const limited = rows.length > cap ? rows.slice(0, cap) : rows;
  await writeJsonObjectFile(cachePath, {
    trailingNewline: false,
    fields: {
      version: LSP_REQUEST_CACHE_SCHEMA_VERSION,
      generatedAt: new Date().toISOString()
    },
    arrays: {
      entries: limited
    },
    atomic: true
  });
};

/**
 * Build document-position key for request dedupe.
 * Keep keying coarse (line/character only) to avoid duplicate work when
 * servers emit multiple symbol variants for the same cursor location.
 * @param {{position:{line:number,character:number}}} input
 * @returns {string|null}
 */
export const buildSymbolPositionCacheKey = ({ position }) => {
  if (!position || !Number.isFinite(position.line) || !Number.isFinite(position.character)) return null;
  return `${Math.floor(position.line)}:${Math.floor(position.character)}`;
};

/**
 * Build deterministic cache key for one request tuple.
 * @param {{
 *   providerId:string,
 *   providerVersion?:string|null,
 *   workspaceKey?:string|null,
 *   docHash:string,
 *   requestKind:string,
 *   position:{line:number,character:number},
 *   policyVersion?:string|null
 * }} input
 * @returns {string|null}
 */
export const buildLspRequestCacheKey = ({
  providerId,
  providerVersion = null,
  workspaceKey = null,
  docHash,
  requestKind,
  position,
  policyVersion = LSP_REQUEST_CACHE_POLICY_VERSION
}) => {
  if (!docHash) return null;
  const symbolPositionKey = buildSymbolPositionCacheKey({ position });
  if (!symbolPositionKey) return null;
  const normalizedRequestKind = String(requestKind || '').trim().toLowerCase();
  if (!normalizedRequestKind) return null;
  return [
    String(policyVersion || '').trim() || LSP_REQUEST_CACHE_POLICY_VERSION,
    normalizeRequestCacheProviderValue(providerId),
    String(providerVersion || '').trim(),
    String(workspaceKey || '').trim(),
    String(docHash),
    normalizedRequestKind,
    symbolPositionKey
  ].join('|');
};

/**
 * Normalize LSP hover content payloads to plain text.
 * @param {string|Array<any>|object|null} contents
 * @returns {string}
 */
const normalizeHoverContents = (contents) => {
  if (!contents) return '';
  if (typeof contents === 'string') return contents;
  if (Array.isArray(contents)) {
    return contents.map((entry) => normalizeHoverContents(entry)).filter(Boolean).join('\n');
  }
  if (typeof contents === 'object') {
    if (typeof contents.value === 'string') return contents.value;
    if (typeof contents.language === 'string' && typeof contents.value === 'string') return contents.value;
  }
  return '';
};

const extractSignatureHelpText = (payload) => {
  if (!payload || typeof payload !== 'object') return '';
  const signatures = Array.isArray(payload.signatures) ? payload.signatures : [];
  if (!signatures.length) return '';
  const activeIndexRaw = Number(payload.activeSignature);
  const activeIndex = Number.isFinite(activeIndexRaw)
    ? Math.max(0, Math.min(signatures.length - 1, Math.floor(activeIndexRaw)))
    : 0;
  const activeSignature = signatures[activeIndex] || signatures[0] || null;
  if (!activeSignature || typeof activeSignature !== 'object') return '';
  return String(activeSignature.label || '').trim();
};

const extractDefinitionLocations = (payload) => {
  const source = Array.isArray(payload) ? payload : [payload];
  const out = [];
  for (const entry of source) {
    if (!entry || typeof entry !== 'object') continue;
    const uri = typeof entry.uri === 'string'
      ? entry.uri
      : (typeof entry.targetUri === 'string' ? entry.targetUri : null);
    const range = entry.range && typeof entry.range === 'object'
      ? entry.range
      : (entry.targetRange && typeof entry.targetRange === 'object' ? entry.targetRange : null);
    if (!uri || !range) continue;
    out.push({ uri, range });
  }
  return out;
};

/**
 * Normalize signature/type strings to compact one-line text.
 * @param {unknown} value
 * @returns {string|null}
 */
export const normalizeTypeText = (value) => {
  if (!value) return null;
  return String(value).replace(/\s+/g, ' ').trim() || null;
};

const normalizeSignatureCacheText = (value) => (
  String(value || '').replace(/\s+/g, ' ').trim()
);

/**
 * Build deterministic cache key for parsed signature detail payloads.
 *
 * @param {{
 *   languageId?:string,
 *   detailText?:string,
 *   symbolName?:string,
 *   parserKey?:string,
 *   symbolSensitive?:boolean
 * }} input
 * @returns {string|null}
 */
export const buildSignatureParseCacheKey = ({
  languageId = '',
  detailText = '',
  symbolName = '',
  parserKey = '',
  symbolSensitive = true
}) => {
  const normalizedDetail = normalizeSignatureCacheText(detailText);
  if (!normalizedDetail) return null;
  const parts = [
    'v2',
    String(languageId || '').trim(),
    String(parserKey || '').trim() || 'default',
    normalizedDetail
  ];
  if (symbolSensitive !== false) {
    parts.push(String(symbolName || '').trim());
  }
  return parts.join('::');
};

/**
 * Parse finite integer values with optional lower bound.
 * @param {unknown} value
 * @param {number|null} [min=null]
 * @returns {number|null}
 */
export const toFiniteInt = (value, min = null) => {
  if (value == null) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const normalized = Math.floor(parsed);
  if (!Number.isFinite(min)) return normalized;
  return Math.max(min, normalized);
};

const createRequestBudgetController = (maxRequests) => {
  const cap = toFiniteInt(maxRequests, 0);
  if (!Number.isFinite(cap) || cap < 0) {
    return {
      enabled: false,
      tryReserve: () => true
    };
  }
  let used = 0;
  return {
    enabled: true,
    tryReserve: () => {
      if (used >= cap) return false;
      used += 1;
      return true;
    }
  };
};

const createEmptyRequestCacheKindMetrics = () => ({
  hits: 0,
  misses: 0,
  memoryHits: 0,
  persistedHits: 0,
  negativeHits: 0,
  writes: 0
});

const ensureRequestCacheKindMetrics = (metrics, requestKind) => {
  if (!metrics || typeof metrics !== 'object') return createEmptyRequestCacheKindMetrics();
  const key = String(requestKind || '').trim().toLowerCase() || 'unknown';
  if (!metrics.byKind || typeof metrics.byKind !== 'object') {
    metrics.byKind = Object.create(null);
  }
  if (!metrics.byKind[key]) {
    metrics.byKind[key] = createEmptyRequestCacheKindMetrics();
  }
  return metrics.byKind[key];
};

const noteRequestCacheMiss = (metrics, requestKind) => {
  if (!metrics || typeof metrics !== 'object') return;
  metrics.misses = Number(metrics.misses || 0) + 1;
  const bucket = ensureRequestCacheKindMetrics(metrics, requestKind);
  bucket.misses += 1;
};

const noteRequestCacheHit = (metrics, requestKind, { persisted = false, negative = false } = {}) => {
  if (!metrics || typeof metrics !== 'object') return;
  metrics.hits = Number(metrics.hits || 0) + 1;
  const bucket = ensureRequestCacheKindMetrics(metrics, requestKind);
  bucket.hits += 1;
  if (persisted) {
    metrics.persistedHits = Number(metrics.persistedHits || 0) + 1;
    bucket.persistedHits += 1;
  } else {
    metrics.memoryHits = Number(metrics.memoryHits || 0) + 1;
    bucket.memoryHits += 1;
  }
  if (negative) {
    metrics.negativeHits = Number(metrics.negativeHits || 0) + 1;
    bucket.negativeHits += 1;
  }
};

const noteRequestCacheWrite = (metrics, requestKind) => {
  if (!metrics || typeof metrics !== 'object') return;
  metrics.writes = Number(metrics.writes || 0) + 1;
  const bucket = ensureRequestCacheKindMetrics(metrics, requestKind);
  bucket.writes += 1;
};

const readRequestCacheEntry = ({
  requestCacheEntries,
  requestCachePersistedKeys,
  requestCacheMetrics,
  cacheKey,
  requestKind
}) => {
  if (!(requestCacheEntries instanceof Map) || !cacheKey) return null;
  const entry = requestCacheEntries.get(cacheKey);
  if (!entry) {
    noteRequestCacheMiss(requestCacheMetrics, requestKind);
    return null;
  }
  if (isExpiredRequestCacheEntry(entry)) {
    requestCacheEntries.delete(cacheKey);
    if (requestCachePersistedKeys instanceof Set) requestCachePersistedKeys.delete(cacheKey);
    noteRequestCacheMiss(requestCacheMetrics, requestKind);
    return null;
  }
  noteRequestCacheHit(requestCacheMetrics, requestKind, {
    persisted: requestCachePersistedKeys instanceof Set && requestCachePersistedKeys.has(cacheKey),
    negative: entry.negative === true
  });
  return entry;
};

const writeRequestCacheEntry = ({
  requestCacheEntries,
  requestCacheMetrics,
  markRequestCacheDirty,
  cacheKey,
  requestKind,
  info = null,
  negative = false,
  ttlMs = null
}) => {
  if (!(requestCacheEntries instanceof Map) || !cacheKey) return;
  const now = Date.now();
  const entry = {
    requestKind: String(requestKind || '').trim().toLowerCase(),
    negative: negative === true,
    at: now,
    ...(negative !== true && info ? { info: normalizeCachedRequestInfo(info) } : {}),
    ...(negative === true ? {
      expiresAt: now + (
        Number.isFinite(Number(ttlMs)) && Number(ttlMs) > 0
          ? Math.floor(Number(ttlMs))
          : LSP_REQUEST_CACHE_NEGATIVE_TTL_MS
      )
    } : {})
  };
  if (!entry.requestKind) return;
  if (entry.negative !== true && !entry.info) return;
  requestCacheEntries.set(cacheKey, entry);
  if (typeof markRequestCacheDirty === 'function') markRequestCacheDirty();
  noteRequestCacheWrite(requestCacheMetrics, requestKind);
};

const summarizeLatencies = (values) => {
  if (!Array.isArray(values) || values.length === 0) {
    return { count: 0, p50Ms: null, p95Ms: null };
  }
  return {
    count: values.length,
    p50Ms: resolveNearestRankPercentile(values, 0.5, { emptyValue: null }),
    p95Ms: resolveNearestRankPercentile(values, 0.95, { emptyValue: null })
  };
};

const createHoverFileStats = () => ({
  requested: 0,
  succeeded: 0,
  sourceBootstrapUsed: 0,
  hoverTimedOut: 0,
  semanticTokensRequested: 0,
  semanticTokensSucceeded: 0,
  semanticTokensTimedOut: 0,
  signatureHelpRequested: 0,
  signatureHelpSucceeded: 0,
  signatureHelpTimedOut: 0,
  inlayHintsRequested: 0,
  inlayHintsSucceeded: 0,
  inlayHintsTimedOut: 0,
  definitionRequested: 0,
  definitionSucceeded: 0,
  definitionTimedOut: 0,
  typeDefinitionRequested: 0,
  typeDefinitionSucceeded: 0,
  typeDefinitionTimedOut: 0,
  referencesRequested: 0,
  referencesSucceeded: 0,
  referencesTimedOut: 0,
  timedOut: 0,
  skippedByBudget: 0,
  skippedBySoftDeadline: 0,
  skippedByKind: 0,
  skippedByReturnSufficient: 0,
  skippedByAdaptiveDisable: 0,
  skippedByGlobalDisable: 0,
  latencyMs: [],
  disabledAdaptive: false
});

/**
 * Normalize configurable symbol kinds to a set of integer IDs.
 * @param {number[]|number|string[]|string|null} kinds
 * @returns {Set<number>|null}
 */
export const normalizeHoverKinds = (kinds) => {
  if (kinds == null) return null;
  const source = Array.isArray(kinds) ? kinds : [kinds];
  const normalized = source
    .map((entry) => toFiniteInt(entry, 0))
    .filter((entry) => Number.isFinite(entry));
  if (!normalized.length) return null;
  return new Set(normalized);
};

/**
 * Normalize parsed parameter type payloads to enriched provenance entries.
 * @param {object|null} paramTypes
 * @returns {object|null}
 */
export const normalizeParamTypes = (paramTypes, options = {}) => {
  if (!paramTypes || typeof paramTypes !== 'object') return null;
  const configuredDefaultConfidence = Number(options?.defaultConfidence);
  const defaultConfidence = Number.isFinite(configuredDefaultConfidence)
    ? Math.max(0, Math.min(1, configuredDefaultConfidence))
    : 0.7;
  const languageId = String(options?.languageId || '').trim().toLowerCase() || null;
  const output = {};
  for (const [name, entries] of Object.entries(paramTypes)) {
    if (!name) continue;
    if (Array.isArray(entries)) {
      const normalized = entries
        .map((entry) => (typeof entry === 'string' ? { type: entry } : entry))
        .filter((entry) => entry?.type)
        .map((entry) => {
          const normalizedType = canonicalizeTypeText(entry.type, { languageId });
          return {
            type: normalizedType.displayText,
            normalizedType: normalizedType.canonicalText,
            originalText: normalizedType.originalText,
            confidence: Number.isFinite(entry.confidence) ? entry.confidence : defaultConfidence,
            source: entry.source || 'tooling'
          };
        })
        .filter((entry) => entry.type);
      if (normalized.length) output[name] = normalized;
      continue;
    }
    if (typeof entries === 'string') {
      const normalizedType = canonicalizeTypeText(entries, { languageId });
      if (normalizedType.displayText) {
        output[name] = [{
          type: normalizedType.displayText,
          normalizedType: normalizedType.canonicalText,
          originalText: normalizedType.originalText,
          confidence: defaultConfidence,
          source: 'tooling'
        }];
      }
    }
  }
  return Object.keys(output).length ? output : null;
};

const hasParamTypes = (paramTypes) => {
  if (!paramTypes || typeof paramTypes !== 'object') return false;
  for (const entries of Object.values(paramTypes)) {
    if (Array.isArray(entries)) {
      if (entries.some((entry) => normalizeTypeText(typeof entry === 'string' ? entry : entry?.type))) {
        return true;
      }
      continue;
    }
    if (normalizeTypeText(entries)) return true;
  }
  return false;
};

const FUNCTION_LIKE_SYMBOL_KINDS = new Set([6, 9, 12]);

const normalizeParamNames = (value) => {
  if (!Array.isArray(value)) return [];
  const out = [];
  const seen = new Set();
  for (const entry of value) {
    const name = String(entry || '').trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
};

const signatureDeclaresParameters = (signature) => {
  const text = normalizeTypeText(signature);
  if (!text) return false;
  const open = text.indexOf('(');
  const close = text.lastIndexOf(')');
  if (open < 0 || close < 0 || close <= open) return false;
  const inside = text.slice(open + 1, close).trim();
  if (!inside) return false;
  return !/^(void|\(\s*\))$/i.test(inside);
};

const hasTypedParamEntry = (value) => {
  if (Array.isArray(value)) {
    return value.some((entry) => normalizeTypeText(typeof entry === 'string' ? entry : entry?.type));
  }
  return normalizeTypeText(value) != null;
};

const hasTypedParamName = (paramTypes, name) => {
  if (!paramTypes || typeof paramTypes !== 'object') return false;
  if (!name) return false;
  return hasTypedParamEntry(paramTypes[name]);
};

const isAmbiguousReturnType = (info) => {
  const signatureText = normalizeTypeText(info?.signature);
  const hasSignatureArrow = typeof signatureText === 'string' && signatureText.includes('->');
  const normalizedReturnType = normalizeTypeText(info?.returnType);
  const treatVoidAsMissing = normalizedReturnType === 'Void' && hasSignatureArrow;
  return !normalizedReturnType
    || /^unknown$/i.test(normalizedReturnType)
    || /^any\b/i.test(normalizedReturnType)
    || treatVoidAsMissing;
};

/**
 * Determine whether a parsed signature payload is incomplete for enrichment.
 *
 * @param {object|null} info
 * @param {{symbolKind?:number|null}} [options]
 * @returns {{incomplete:boolean,missingReturn:boolean,missingParamTypes:boolean,paramCoverage:number}}
 */
export const isIncompleteTypePayload = (info, options = {}) => {
  if (!info || typeof info !== 'object') {
    return {
      incomplete: true,
      missingReturn: true,
      missingParamTypes: true,
      paramCoverage: 0
    };
  }
  const symbolKind = Number.isInteger(options?.symbolKind) ? options.symbolKind : null;
  const functionLike = symbolKind == null || FUNCTION_LIKE_SYMBOL_KINDS.has(symbolKind);
  const missingReturn = functionLike ? isAmbiguousReturnType(info) : false;
  const paramNames = normalizeParamNames(info?.paramNames);
  const declaredParams = paramNames.length > 0 || signatureDeclaresParameters(info?.signature);
  let paramCoverage = 1;
  let missingParamTypes = false;
  if (functionLike && declaredParams) {
    if (paramNames.length) {
      const typedCount = paramNames.filter((name) => hasTypedParamName(info?.paramTypes, name)).length;
      paramCoverage = typedCount / paramNames.length;
      missingParamTypes = typedCount < paramNames.length;
    } else {
      const hasAnyTypedParam = hasParamTypes(info?.paramTypes);
      paramCoverage = hasAnyTypedParam ? 1 : 0;
      missingParamTypes = !hasAnyTypedParam;
    }
  }
  return {
    incomplete: missingReturn || missingParamTypes,
    missingReturn,
    missingParamTypes,
    paramCoverage
  };
};

/**
 * Extract a source-level signature candidate from target byte range.
 * @param {string} text
 * @param {{start:number,end:number}} virtualRange
 * @returns {string|null}
 */
const buildSourceSignatureCandidate = (text, virtualRange) => {
  if (typeof text !== 'string' || !text) return null;
  const start = Number(virtualRange?.start);
  const end = Number(virtualRange?.end);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  const clampedStart = Math.max(0, Math.min(text.length, Math.floor(start)));
  const clampedEnd = Math.max(clampedStart, Math.min(text.length, Math.ceil(end + 1)));
  if (clampedEnd <= clampedStart) return null;
  let candidate = text.slice(clampedStart, clampedEnd);
  if (!candidate.includes('(') || !candidate.includes(')')) return null;
  const terminators = [candidate.indexOf('{'), candidate.indexOf(';')].filter((idx) => idx >= 0);
  if (terminators.length) {
    candidate = candidate.slice(0, Math.min(...terminators));
  }
  const lastParen = candidate.lastIndexOf(')');
  if (lastParen === -1) return null;
  const trailing = candidate.slice(lastParen + 1);
  const lineBreakIdx = trailing.search(/[\r\n]/);
  const cut = lineBreakIdx >= 0
    ? lastParen + 1 + lineBreakIdx
    : candidate.length;
  return normalizeSignatureCacheText(candidate.slice(0, cut));
};

const buildLineSignatureCandidate = (text, lineNumber) => {
  if (typeof text !== 'string' || !text) return null;
  const line = Number(lineNumber);
  if (!Number.isFinite(line) || line < 0) return null;
  const lines = text.split(/\r?\n/u);
  if (line >= lines.length) return null;
  let candidate = String(lines[line] || '');
  if (!candidate.includes('(') || !candidate.includes(')')) return null;
  const terminators = [candidate.indexOf('{'), candidate.indexOf(';')].filter((idx) => idx >= 0);
  if (terminators.length) {
    candidate = candidate.slice(0, Math.min(...terminators));
  }
  return normalizeSignatureCacheText(candidate);
};

/**
 * Compute deterministic quality score for one signature candidate.
 *
 * @param {object|null} info
 * @param {{symbolKind?:number|null}} [options]
 * @returns {{total:number,returnScore:number,paramScore:number,signatureScore:number,evidenceScore:number,incomplete:boolean}}
 */
export const scoreSignatureInfo = (info, options = {}) => {
  if (!info || typeof info !== 'object') {
    return {
      total: 0,
      returnScore: 0,
      paramScore: 0,
      signatureScore: 0,
      evidenceScore: 0,
      incomplete: true
    };
  }
  const completeness = isIncompleteTypePayload(info, options);
  const returnScore = completeness.missingReturn ? 0 : 4;
  const paramScore = Math.round(Math.max(0, Math.min(1, completeness.paramCoverage || 0)) * 4);
  const signatureScore = normalizeTypeText(info.signature) ? 1 : 0;
  const evidenceScore = hasParamTypes(info.paramTypes) ? 1 : 0;
  return {
    total: returnScore + paramScore + signatureScore + evidenceScore,
    returnScore,
    paramScore,
    signatureScore,
    evidenceScore,
    incomplete: completeness.incomplete
  };
};

const choosePreferredSignatureInfo = (base, next, options = {}) => {
  const baseScore = scoreSignatureInfo(base, options);
  const nextScore = scoreSignatureInfo(next, options);
  if (nextScore.total > baseScore.total) return { preferred: next, alternate: base };
  if (nextScore.total < baseScore.total) return { preferred: base, alternate: next };
  const baseSignature = normalizeTypeText(base?.signature) || '';
  const nextSignature = normalizeTypeText(next?.signature) || '';
  if (nextSignature.length > baseSignature.length) {
    return { preferred: next, alternate: base };
  }
  return { preferred: base, alternate: next };
};

const mergeParamTypesByQuality = (preferred, alternate, paramNames) => {
  const preferredParamTypes = preferred?.paramTypes && typeof preferred.paramTypes === 'object'
    ? preferred.paramTypes
    : null;
  const alternateParamTypes = alternate?.paramTypes && typeof alternate.paramTypes === 'object'
    ? alternate.paramTypes
    : null;
  if (!preferredParamTypes && !alternateParamTypes) return null;
  const names = Array.from(new Set([
    ...paramNames,
    ...Object.keys(preferredParamTypes || {}),
    ...Object.keys(alternateParamTypes || {})
  ])).filter(Boolean);
  const out = {};
  for (const name of names) {
    const preferredBucket = preferredParamTypes?.[name];
    const alternateBucket = alternateParamTypes?.[name];
    if (hasTypedParamEntry(preferredBucket)) {
      out[name] = preferredBucket;
      continue;
    }
    if (hasTypedParamEntry(alternateBucket)) {
      out[name] = alternateBucket;
      continue;
    }
    if (preferredBucket != null) out[name] = preferredBucket;
    else if (alternateBucket != null) out[name] = alternateBucket;
  }
  return Object.keys(out).length ? out : null;
};

/**
 * Merge signature candidates, preferring higher-quality metadata while
 * preserving deterministic tie-break behavior.
 *
 * @param {object|null} base
 * @param {object|null} next
 * @param {{symbolKind?:number|null}} [options]
 * @returns {object|null}
 */
const mergeSignatureInfo = (base, next, options = {}) => {
  if (!next) return base;
  if (!base) return next;
  const { preferred, alternate } = choosePreferredSignatureInfo(base, next, options);
  const merged = { ...preferred };
  const preferredReturnAmbiguous = isAmbiguousReturnType(preferred);
  const alternateReturnAmbiguous = isAmbiguousReturnType(alternate);
  if (preferredReturnAmbiguous && !alternateReturnAmbiguous) {
    merged.returnType = alternate.returnType;
  }
  const preferredSignature = normalizeTypeText(preferred?.signature);
  const alternateSignature = normalizeTypeText(alternate?.signature);
  if (!preferredSignature && alternateSignature) {
    merged.signature = alternate.signature;
  }
  const paramNames = Array.from(new Set([
    ...normalizeParamNames(preferred?.paramNames),
    ...normalizeParamNames(alternate?.paramNames)
  ]));
  if (paramNames.length) merged.paramNames = paramNames;
  const mergedParamTypes = mergeParamTypesByQuality(preferred, alternate, paramNames);
  if (mergedParamTypes) merged.paramTypes = mergedParamTypes;
  if (!merged.semanticClass && alternate?.semanticClass) {
    merged.semanticClass = alternate.semanticClass;
  }
  if (!merged.semanticTokenType && alternate?.semanticTokenType) {
    merged.semanticTokenType = alternate.semanticTokenType;
  }
  if ((!Array.isArray(merged.semanticTokenModifiers) || !merged.semanticTokenModifiers.length)
    && Array.isArray(alternate?.semanticTokenModifiers)
    && alternate.semanticTokenModifiers.length) {
    merged.semanticTokenModifiers = alternate.semanticTokenModifiers.slice();
  }
  return merged;
};

const isFunctionLikeTargetHint = (value) => {
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized === 'function'
      || normalized === 'method'
      || normalized === 'constructor';
  }
  return FUNCTION_LIKE_SYMBOL_KINDS.has(Number(value));
};

const scoreChunkPayloadCandidate = ({ info, symbol, target }) => {
  const detailScore = scoreSignatureInfo(info, { symbolKind: symbol?.kind });
  let total = detailScore.total;
  const hintName = typeof target?.symbolHint?.name === 'string'
    ? target.symbolHint.name.trim()
    : '';
  const symbolName = typeof symbol?.name === 'string' ? symbol.name.trim() : '';
  if (hintName) {
    if (hintName === symbolName) total += 100;
    else if (symbolName) total -= 40;
  }
  const hintIsFunctionLike = isFunctionLikeTargetHint(target?.symbolHint?.kind);
  const symbolIsFunctionLike = FUNCTION_LIKE_SYMBOL_KINDS.has(Number(symbol?.kind));
  if (hintIsFunctionLike && symbolIsFunctionLike) total += 20;
  else if (hintIsFunctionLike && !symbolIsFunctionLike) total -= 20;
  if (!detailScore.incomplete) total += 30;
  return total;
};

const resolveEvidenceTier = (record) => {
  if (
    record?.hoverSucceeded
    || record?.signatureHelpSucceeded
    || record?.definitionSucceeded
    || record?.typeDefinitionSucceeded
    || record?.referencesSucceeded
  ) {
    return 'full';
  }
  if (record?.inlayHintsSucceeded) {
    return 'hinted';
  }
  if (record?.sourceBootstrapUsed || record?.sourceFallbackUsed) {
    return 'heuristic';
  }
  return 'inferred';
};

const scoreEvidenceTier = (tier) => {
  if (tier === 'full') return 20;
  if (tier === 'hinted') return 12;
  if (tier === 'inferred') return 8;
  return 0;
};

const defaultParamConfidenceForTier = (tier) => {
  if (tier === 'full') return 0.9;
  if (tier === 'hinted') return 0.65;
  if (tier === 'inferred') return 0.75;
  return 0.6;
};

const resolveEvidenceConfidenceTier = (tier) => {
  if (tier === 'full') return 'high';
  if (tier === 'hinted') return 'medium';
  if (tier === 'inferred') return 'medium';
  return 'low';
};

const countParamTypeConflicts = (paramTypes) => {
  if (!paramTypes || typeof paramTypes !== 'object' || Array.isArray(paramTypes)) return 0;
  let conflicts = 0;
  for (const entries of Object.values(paramTypes)) {
    if (!Array.isArray(entries) || entries.length <= 1) continue;
    const distinct = new Set(
      entries
        .map((entry) => normalizeTypeText(entry?.type))
        .filter(Boolean)
    );
    if (distinct.size > 1) conflicts += 1;
  }
  return conflicts;
};

const resolveProviderStabilityTier = ({ fileHoverStats, hoverControl }) => {
  if (hoverControl?.disabledGlobal || fileHoverStats?.disabledAdaptive) return 'degraded';
  const timeoutCount = (
    Number(fileHoverStats?.timedOut || 0)
    + Number(fileHoverStats?.hoverTimedOut || 0)
    + Number(fileHoverStats?.signatureHelpTimedOut || 0)
    + Number(fileHoverStats?.definitionTimedOut || 0)
    + Number(fileHoverStats?.typeDefinitionTimedOut || 0)
    + Number(fileHoverStats?.referencesTimedOut || 0)
  );
  return timeoutCount > 0 ? 'degraded' : 'stable';
};

const scoreLspConfidence = ({
  evidenceTier,
  completeness,
  conflictCount,
  unresolvedRate,
  stabilityTier,
  sourceFallbackUsed,
  providerConfidenceBias = 0
}) => {
  let score = evidenceTier === 'full'
    ? 0.92
    : (evidenceTier === 'hinted' ? 0.72 : (evidenceTier === 'inferred' ? 0.78 : 0.62));
  if (completeness?.incomplete) {
    score -= completeness?.missingReturn && completeness?.missingParamTypes ? 0.3 : 0.18;
  }
  score -= Math.min(0.15, Math.max(0, Number(conflictCount || 0)) * 0.05);
  score -= Math.min(0.2, Math.max(0, Number(unresolvedRate || 0)) * 0.25);
  if (stabilityTier !== 'stable') score -= 0.08;
  if (sourceFallbackUsed) score -= 0.05;
  score += Math.max(-0.1, Math.min(0.1, Number(providerConfidenceBias) || 0));
  const normalizedScore = Math.max(0.05, Math.min(0.99, Number(score.toFixed(2))));
  const tier = normalizedScore >= 0.85
    ? 'high'
    : (normalizedScore >= 0.65 ? 'medium' : 'low');
  return { score: normalizedScore, tier };
};

const buildLspSymbolRef = ({
  record,
  payload,
  languageId,
  evidenceConfidence
}) => {
  const target = record?.target || null;
  const symbol = record?.symbol || null;
  const virtualPath = String(target?.virtualPath || target?.chunkRef?.file || '').trim();
  const qualifiedName = String(
    symbol?.fullName
      || symbol?.name
      || target?.symbolHint?.name
      || ''
  ).trim();
  const kindGroup = target?.symbolHint?.kind ?? symbol?.kind ?? 'other';
  const semanticClass = String(record?.semanticClass || '').trim() || null;
  const symbolKey = buildSymbolKey({
    virtualPath,
    qualifiedName,
    kindGroup: semanticClass || kindGroup
  });
  if (!symbolKey) return null;
  const signatureKey = buildSignatureKey({
    qualifiedName,
    signature: payload?.signature || null
  });
  const scopedId = buildScopedSymbolId({
    kindGroup: String(kindGroup || 'other'),
    symbolKey,
    signatureKey,
    chunkUid: target?.chunkRef?.chunkUid || null
  });
  return {
    symbolKey,
    symbolId: buildSymbolId({ scopedId, scheme: 'lsp' }),
    signatureKey,
    scopedId,
    kind: semanticClass || kindGroup,
    qualifiedName,
    languageId: languageId || null,
    definingChunk: target?.chunkRef || null,
    evidence: {
      scheme: 'lsp',
      confidence: evidenceConfidence?.tier || 'low'
    }
  };
};

const buildLspProvenanceEntry = ({
  cmd,
  record,
  completeness,
  detailScore,
  candidateScore,
  evidenceTier,
  conflictCount,
  unresolvedRate,
  stabilityTier,
  confidence
}) => ({
  provider: cmd,
  version: '1.0.0',
  collectedAt: new Date().toISOString(),
  source: 'lsp',
  symbol: {
    name: record?.symbol?.name || record?.target?.symbolHint?.name || null,
    qualifiedName: record?.symbol?.fullName || record?.symbol?.name || record?.target?.symbolHint?.name || null,
    kind: record?.symbol?.kind ?? record?.target?.symbolHint?.kind ?? null,
    semanticClass: record?.semanticClass || null
  },
  stages: {
    documentSymbol: true,
    hover: {
      requested: record?.hoverRequested === true,
      succeeded: record?.hoverSucceeded === true
    },
    semanticTokens: {
      requested: record?.semanticTokensRequested === true,
      succeeded: record?.semanticTokensSucceeded === true
    },
    signatureHelp: {
      requested: record?.signatureHelpRequested === true,
      succeeded: record?.signatureHelpSucceeded === true
    },
    inlayHints: {
      requested: record?.inlayHintsRequested === true,
      succeeded: record?.inlayHintsSucceeded === true
    },
    definition: {
      requested: record?.definitionRequested === true,
      succeeded: record?.definitionSucceeded === true
    },
    typeDefinition: {
      requested: record?.typeDefinitionRequested === true,
      succeeded: record?.typeDefinitionSucceeded === true
    },
    references: {
      requested: record?.referencesRequested === true,
      succeeded: record?.referencesSucceeded === true
    },
    sourceBootstrapUsed: record?.sourceBootstrapUsed === true,
    sourceFallbackUsed: record?.sourceFallbackUsed === true
  },
  evidence: {
    scheme: 'lsp',
    tier: evidenceTier,
    confidence: resolveEvidenceConfidenceTier(evidenceTier)
  },
  quality: {
    score: detailScore.total,
    candidateScore,
    incomplete: completeness.incomplete === true,
    missingReturn: completeness.missingReturn === true,
    missingParamTypes: completeness.missingParamTypes === true,
    paramCoverage: Number(completeness.paramCoverage || 0),
    conflictCount,
    unresolvedRate: Number(unresolvedRate.toFixed(4)),
    stability: stabilityTier
  },
  confidence
});

/**
 * Create default hover metrics envelope.
 * @returns {object}
 */
export const createEmptyHoverMetricsResult = () => ({
  requested: 0,
  succeeded: 0,
  sourceBootstrapUsed: 0,
  hoverTimedOut: 0,
  semanticTokensRequested: 0,
  semanticTokensSucceeded: 0,
  semanticTokensTimedOut: 0,
  signatureHelpRequested: 0,
  signatureHelpSucceeded: 0,
  signatureHelpTimedOut: 0,
  inlayHintsRequested: 0,
  inlayHintsSucceeded: 0,
  inlayHintsTimedOut: 0,
  definitionRequested: 0,
  definitionSucceeded: 0,
  definitionTimedOut: 0,
  typeDefinitionRequested: 0,
  typeDefinitionSucceeded: 0,
  typeDefinitionTimedOut: 0,
  referencesRequested: 0,
  referencesSucceeded: 0,
  referencesTimedOut: 0,
  timedOut: 0,
  incompleteSymbols: 0,
  hoverTriggeredByIncomplete: 0,
  fallbackUsed: 0,
  fallbackReasonCounts: Object.create(null),
  skippedByBudget: 0,
  skippedBySoftDeadline: 0,
  skippedByKind: 0,
  skippedByReturnSufficient: 0,
  skippedByAdaptiveDisable: 0,
  skippedByGlobalDisable: 0,
  p50Ms: null,
  p95Ms: null,
  files: []
});

/**
 * Aggregate per-request and per-file hover metrics for reporting.
 * @param {{hoverMetrics:object,hoverLatencyMs:number[],hoverFileStats:Map<string,object>}} input
 * @returns {object}
 */
export const summarizeHoverMetrics = ({ hoverMetrics, hoverLatencyMs, hoverFileStats }) => {
  const hoverSummary = summarizeLatencies(hoverLatencyMs);
  const hoverFiles = Array.from(hoverFileStats.entries())
    .map(([virtualPath, stats]) => ({
      virtualPath,
      requested: stats.requested,
      succeeded: stats.succeeded,
      sourceBootstrapUsed: stats.sourceBootstrapUsed,
      hoverTimedOut: stats.hoverTimedOut,
      semanticTokensRequested: stats.semanticTokensRequested,
      semanticTokensSucceeded: stats.semanticTokensSucceeded,
      semanticTokensTimedOut: stats.semanticTokensTimedOut,
      signatureHelpRequested: stats.signatureHelpRequested,
      signatureHelpSucceeded: stats.signatureHelpSucceeded,
      signatureHelpTimedOut: stats.signatureHelpTimedOut,
      inlayHintsRequested: stats.inlayHintsRequested,
      inlayHintsSucceeded: stats.inlayHintsSucceeded,
      inlayHintsTimedOut: stats.inlayHintsTimedOut,
      definitionRequested: stats.definitionRequested,
      definitionSucceeded: stats.definitionSucceeded,
      definitionTimedOut: stats.definitionTimedOut,
      typeDefinitionRequested: stats.typeDefinitionRequested,
      typeDefinitionSucceeded: stats.typeDefinitionSucceeded,
      typeDefinitionTimedOut: stats.typeDefinitionTimedOut,
      referencesRequested: stats.referencesRequested,
      referencesSucceeded: stats.referencesSucceeded,
      referencesTimedOut: stats.referencesTimedOut,
      timedOut: stats.timedOut,
      skippedByBudget: stats.skippedByBudget,
      skippedBySoftDeadline: stats.skippedBySoftDeadline,
      skippedByKind: stats.skippedByKind,
      skippedByReturnSufficient: stats.skippedByReturnSufficient,
      skippedByAdaptiveDisable: stats.skippedByAdaptiveDisable,
      skippedByGlobalDisable: stats.skippedByGlobalDisable,
      disabledAdaptive: stats.disabledAdaptive === true,
      ...summarizeLatencies(stats.latencyMs)
    }))
    .sort((a, b) => {
      const timeoutCmp = (b.timedOut || 0) - (a.timedOut || 0);
      if (timeoutCmp) return timeoutCmp;
      const p95A = Number.isFinite(a.p95Ms) ? a.p95Ms : -1;
      const p95B = Number.isFinite(b.p95Ms) ? b.p95Ms : -1;
      if (p95B !== p95A) return p95B - p95A;
      return String(a.virtualPath || '').localeCompare(String(b.virtualPath || ''));
    });

  return {
    requested: hoverMetrics.requested,
    succeeded: hoverMetrics.succeeded,
    sourceBootstrapUsed: hoverMetrics.sourceBootstrapUsed,
    hoverTimedOut: hoverMetrics.hoverTimedOut,
    semanticTokensRequested: hoverMetrics.semanticTokensRequested,
    semanticTokensSucceeded: hoverMetrics.semanticTokensSucceeded,
    semanticTokensTimedOut: hoverMetrics.semanticTokensTimedOut,
    signatureHelpRequested: hoverMetrics.signatureHelpRequested,
    signatureHelpSucceeded: hoverMetrics.signatureHelpSucceeded,
    signatureHelpTimedOut: hoverMetrics.signatureHelpTimedOut,
    inlayHintsRequested: hoverMetrics.inlayHintsRequested,
    inlayHintsSucceeded: hoverMetrics.inlayHintsSucceeded,
    inlayHintsTimedOut: hoverMetrics.inlayHintsTimedOut,
    definitionRequested: hoverMetrics.definitionRequested,
    definitionSucceeded: hoverMetrics.definitionSucceeded,
    definitionTimedOut: hoverMetrics.definitionTimedOut,
    typeDefinitionRequested: hoverMetrics.typeDefinitionRequested,
    typeDefinitionSucceeded: hoverMetrics.typeDefinitionSucceeded,
    typeDefinitionTimedOut: hoverMetrics.typeDefinitionTimedOut,
    referencesRequested: hoverMetrics.referencesRequested,
    referencesSucceeded: hoverMetrics.referencesSucceeded,
    referencesTimedOut: hoverMetrics.referencesTimedOut,
    timedOut: hoverMetrics.timedOut,
    incompleteSymbols: hoverMetrics.incompleteSymbols,
    hoverTriggeredByIncomplete: hoverMetrics.hoverTriggeredByIncomplete,
    fallbackUsed: hoverMetrics.fallbackUsed,
    fallbackReasonCounts: { ...(hoverMetrics.fallbackReasonCounts || {}) },
    skippedByBudget: hoverMetrics.skippedByBudget,
    skippedBySoftDeadline: hoverMetrics.skippedBySoftDeadline,
    skippedByKind: hoverMetrics.skippedByKind,
    skippedByReturnSufficient: hoverMetrics.skippedByReturnSufficient,
    skippedByAdaptiveDisable: hoverMetrics.skippedByAdaptiveDisable,
    skippedByGlobalDisable: hoverMetrics.skippedByGlobalDisable,
    p50Ms: hoverSummary.p50Ms,
    p95Ms: hoverSummary.p95Ms,
    files: hoverFiles
  };
};

/**
 * Emit a one-time check entry when tooling circuit breaker opens.
 * @param {{cmd:string,guard:object,checks:Array<object>,checkFlags:object}} input
 * @returns {void}
 */
const recordCircuitOpenCheck = ({ cmd, guard, checks, checkFlags }) => {
  if (checkFlags.circuitOpened) return;
  checkFlags.circuitOpened = true;
  const state = guard.getState?.() || null;
  checks.push({
    name: 'tooling_circuit_open',
    status: 'warn',
    message: `${cmd} circuit breaker opened after ${state?.consecutiveFailures ?? 'unknown'} failures.`,
    count: state?.tripCount ?? 1
  });
};

const recordCrashLoopCheck = ({ cmd, checks, checkFlags, detail }) => {
  if (checkFlags.crashLoopQuarantined) return;
  checkFlags.crashLoopQuarantined = true;
  const remainingMs = Number.isFinite(Number(detail?.crashLoopBackoffRemainingMs))
    ? Math.max(0, Math.floor(Number(detail.crashLoopBackoffRemainingMs)))
    : null;
  checks.push({
    name: 'tooling_crash_loop_quarantined',
    status: 'warn',
    message: `${cmd} crash-loop quarantine active${remainingMs != null ? ` (${remainingMs}ms remaining)` : ''}.`
  });
};

const recordDocumentSymbolFailureCheck = ({ cmd, checks, checkFlags, err }) => {
  if (checkFlags.documentSymbolFailed) return;
  checkFlags.documentSymbolFailed = true;
  const message = String(err?.message || err || '');
  const lower = message.toLowerCase();
  const category = lower.includes('timeout')
    ? 'timeout'
    : (
      err?.code === 'ERR_LSP_TRANSPORT_CLOSED'
          || lower.includes('transport closed')
          || lower.includes('writer unavailable')
    )
      ? 'transport'
      : 'request';
  checks.push({
    name: 'tooling_document_symbol_failed',
    status: 'warn',
    message: `${cmd} documentSymbol requests failed; running in degraded mode (${category}).`
  });
};

const recordSoftDeadlineCheck = ({
  cmd,
  checks,
  checkFlags,
  softDeadlineAt
}) => {
  if (checkFlags.softDeadlineReached) return;
  checkFlags.softDeadlineReached = true;
  const deadlineIso = Number.isFinite(Number(softDeadlineAt))
    ? new Date(Number(softDeadlineAt)).toISOString()
    : null;
  checks.push({
    name: 'tooling_soft_deadline_reached',
    status: 'warn',
    message: `${cmd} tooling soft deadline reached${deadlineIso ? ` (${deadlineIso})` : ''}; suppressing additional LSP stage requests.`
  });
};

const isTimeoutError = (err) => (
  String(err?.message || err || '').toLowerCase().includes('timeout')
);

const TIMEOUT_METRIC_KEY_BY_STAGE = Object.freeze({
  hover: 'hoverTimedOut',
  semantic_tokens: 'semanticTokensTimedOut',
  signature_help: 'signatureHelpTimedOut',
  inlay_hints: 'inlayHintsTimedOut',
  definition: 'definitionTimedOut',
  type_definition: 'typeDefinitionTimedOut',
  references: 'referencesTimedOut'
});

const recordAdaptiveTimeout = ({
  cmd,
  stageKey,
  checks,
  checkFlags,
  fileHoverStats,
  hoverMetrics,
  hoverControl,
  resolvedHoverDisableAfterTimeouts
}) => {
  fileHoverStats.timedOut += 1;
  hoverMetrics.timedOut += 1;
  const timeoutMetricKey = TIMEOUT_METRIC_KEY_BY_STAGE[stageKey] || null;
  if (timeoutMetricKey) {
    fileHoverStats[timeoutMetricKey] = Number(fileHoverStats[timeoutMetricKey] || 0) + 1;
    hoverMetrics[timeoutMetricKey] = Number(hoverMetrics[timeoutMetricKey] || 0) + 1;
  }
  const timeoutFlag = `${stageKey}TimedOut`;
  if (!checkFlags[timeoutFlag]) {
    checkFlags[timeoutFlag] = true;
    checks.push({
      name: `tooling_${stageKey}_timeout`,
      status: 'warn',
      message: `${cmd} ${stageKey} requests timed out; adaptive suppression may be enabled.`
    });
  }
  if (Number.isFinite(resolvedHoverDisableAfterTimeouts)
    && fileHoverStats.timedOut >= resolvedHoverDisableAfterTimeouts
    && !fileHoverStats.disabledAdaptive) {
    fileHoverStats.disabledAdaptive = true;
  }
  if (Number.isFinite(resolvedHoverDisableAfterTimeouts)
    && hoverMetrics.timedOut >= resolvedHoverDisableAfterTimeouts) {
    hoverControl.disabledGlobal = true;
  }
};

const handleStageRequestError = ({
  err,
  cmd,
  stageKey,
  guard,
  checks,
  checkFlags,
  fileHoverStats,
  hoverMetrics,
  hoverControl,
  resolvedHoverDisableAfterTimeouts
}) => {
  if (err?.code === 'ABORT_ERR') throw err;
  if (err?.code === 'TOOLING_CIRCUIT_OPEN') {
    recordCircuitOpenCheck({ cmd, guard, checks, checkFlags });
  } else if (err?.code === 'TOOLING_CRASH_LOOP') {
    recordCrashLoopCheck({ cmd, checks, checkFlags, detail: err?.detail || null });
  }
  if (isTimeoutError(err)) {
    recordAdaptiveTimeout({
      cmd,
      stageKey,
      checks,
      checkFlags,
      fileHoverStats,
      hoverMetrics,
      hoverControl,
      resolvedHoverDisableAfterTimeouts
    });
  }
  return null;
};

const recordFallbackReasons = (hoverMetrics, reasons) => {
  if (!hoverMetrics || !Array.isArray(reasons) || !reasons.length) return;
  hoverMetrics.fallbackUsed += 1;
  if (!hoverMetrics.fallbackReasonCounts || typeof hoverMetrics.fallbackReasonCounts !== 'object') {
    hoverMetrics.fallbackReasonCounts = Object.create(null);
  }
  for (const rawReason of reasons) {
    const reason = String(rawReason || '').trim();
    if (!reason) continue;
    hoverMetrics.fallbackReasonCounts[reason] = Number(hoverMetrics.fallbackReasonCounts[reason] || 0) + 1;
  }
};

const buildFallbackReasonCodes = ({
  incompleteState,
  hoverRequested,
  hoverSucceeded,
  signatureHelpRequested,
  signatureHelpSucceeded,
  inlayHintsRequested,
  inlayHintsSucceeded,
  definitionRequested,
  definitionSucceeded,
  typeDefinitionRequested,
  typeDefinitionSucceeded,
  referencesRequested,
  referencesSucceeded
}) => {
  const reasons = [];
  if (incompleteState?.missingReturn) reasons.push('missing_return_type');
  if (incompleteState?.missingParamTypes) reasons.push('missing_param_types');
  if (!hoverRequested) reasons.push('hover_not_requested');
  else if (!hoverSucceeded) reasons.push('hover_unavailable_or_failed');
  else reasons.push('post_hover_still_incomplete');
  if (!signatureHelpRequested) reasons.push('signature_help_not_requested');
  else if (!signatureHelpSucceeded) reasons.push('signature_help_unavailable_or_failed');
  else reasons.push('post_signature_help_still_incomplete');
  if (!inlayHintsRequested) reasons.push('inlay_hints_not_requested');
  else if (!inlayHintsSucceeded) reasons.push('inlay_hints_unavailable_or_failed');
  else reasons.push('post_inlay_hints_still_incomplete');
  if (!definitionRequested) reasons.push('definition_not_requested');
  else if (!definitionSucceeded) reasons.push('definition_unavailable_or_failed');
  else reasons.push('post_definition_still_incomplete');
  if (!typeDefinitionRequested) reasons.push('type_definition_not_requested');
  else if (!typeDefinitionSucceeded) reasons.push('type_definition_unavailable_or_failed');
  else reasons.push('post_type_definition_still_incomplete');
  if (!referencesRequested) reasons.push('references_not_requested');
  else if (!referencesSucceeded) reasons.push('references_unavailable_or_failed');
  else reasons.push('post_references_still_incomplete');
  return reasons;
};

/**
 * Enrich chunk payloads for one document using symbol + hover information.
 *
 * Fallback semantics:
 * 1. documentSymbol errors are soft-failed per document.
 * 2. hover/signatureHelp/definition/typeDefinition/references requests are deduped by
 *    position and can be suppressed by:
 *    return-type sufficiency, kind filters, per-file budget, adaptive timeout,
 *    or global timeout circuit.
 * 3. source-signature fallback runs only after hover/signatureHelp/definition/
 *    typeDefinition/references attempts still leave the payload incomplete.
 * 4. strict mode throws only when resolved symbol data cannot be mapped to a
 *    chunk uid.
 * 5. provider-level documentSymbol failure disables further documentSymbol work
 *    for the remaining documents in the same collection pass.
 *
 * @param {object} input
 * @returns {Promise<{enrichedDelta:number}>}
 */
export const processDocumentTypes = async ({
  doc,
  cmd,
  client,
  guard,
  guardRun,
  log,
  strict,
  parseSignature,
  lineIndexFactory,
  uri,
  legacyUri,
  languageId,
  openDocs,
  targetIndexesByPath,
  byChunkUid,
  signatureParseCache,
  hoverEnabled,
  semanticTokensEnabled,
  signatureHelpEnabled,
  inlayHintsEnabled,
  definitionEnabled,
  typeDefinitionEnabled,
  referencesEnabled,
  docPathPolicy = null,
  hoverRequireMissingReturn,
  resolvedHoverKinds,
  resolvedHoverMaxPerFile,
  resolvedHoverDisableAfterTimeouts,
  resolvedHoverTimeout,
  resolvedSignatureHelpTimeout,
  resolvedDefinitionTimeout,
  resolvedTypeDefinitionTimeout,
  resolvedReferencesTimeout,
  resolvedDocumentSymbolTimeout,
  hoverLimiter,
  signatureHelpLimiter,
  definitionLimiter,
  typeDefinitionLimiter,
  referencesLimiter,
  requestCacheEntries,
  requestCachePersistedKeys,
  requestCacheMetrics,
  markRequestCacheDirty,
  requestBudgetControllers = null,
  requestCacheContext = null,
  providerConfidenceBias = 0,
  semanticTokensLegend = null,
  hoverControl,
  documentSymbolControl = null,
  hoverFileStats,
  hoverLatencyMs,
  hoverMetrics,
  symbolProcessingConcurrency = 8,
  softDeadlineAt = null,
  positionEncoding = 'utf-16',
  checks,
  checkFlags,
  abortSignal = null
}) => {
  throwIfAborted(abortSignal);
  if (guard.isOpen()) return { enrichedDelta: 0 };
  let openedHere = false;
  const runGuarded = typeof guardRun === 'function'
    ? guardRun
    : ((fn, options) => guard.run(fn, options));

  const docTargetIndex = targetIndexesByPath.get(doc.virtualPath) || null;
  const interactiveAllowed = docPathPolicy?.suppressInteractive !== true;
  const fileHoverStats = hoverFileStats.get(doc.virtualPath) || createHoverFileStats();
  hoverFileStats.set(doc.virtualPath, fileHoverStats);
  const parseCache = signatureParseCache instanceof Map ? signatureParseCache : null;
  const signatureParserKey = String(parseSignature?.cacheKey || parseSignature?.name || 'default').trim() || 'default';
  const signatureParserSymbolSensitive = parseSignature?.isSymbolSensitive !== false;

  const parseSignatureCached = (detailText, symbolName) => {
    if (typeof parseSignature !== 'function') return null;
    const cacheKey = buildSignatureParseCacheKey({
      languageId,
      detailText,
      symbolName,
      parserKey: signatureParserKey,
      symbolSensitive: signatureParserSymbolSensitive
    });
    if (!cacheKey) return null;
    if (parseCache?.has(cacheKey)) {
      return parseCache.get(cacheKey);
    }
    const normalizedDetail = normalizeSignatureCacheText(detailText);
    const parsed = parseSignature(normalizedDetail, languageId, symbolName) || null;
    if (parseCache) parseCache.set(cacheKey, parsed);
    return parsed;
  };

  try {
    throwIfAborted(abortSignal);
    if (documentSymbolControl?.disabled === true) {
      return { enrichedDelta: 0 };
    }
    if (docPathPolicy?.skipDocumentSymbol === true) {
      return { enrichedDelta: 0 };
    }
    if (!openDocs.has(doc.virtualPath)) {
      client.notify('textDocument/didOpen', {
        textDocument: {
          uri,
          languageId,
          version: 1,
          text: doc.text || ''
        }
      });
      openDocs.set(doc.virtualPath, {
        uri,
        legacyUri,
        lineIndex: null,
        text: doc.text || ''
      });
      openedHere = true;
    }
    const documentSymbolBudget = requestBudgetControllers?.documentSymbol || null;
    if (
      documentSymbolBudget
      && typeof documentSymbolBudget.tryReserve === 'function'
      && !documentSymbolBudget.tryReserve()
    ) {
      return { enrichedDelta: 0 };
    }
    let symbols = null;
    try {
      symbols = await runGuarded(
        ({ timeoutMs: guardTimeout }) => client.request(
          'textDocument/documentSymbol',
          { textDocument: { uri } },
          { timeoutMs: guardTimeout }
        ),
        {
          label: 'documentSymbol',
          ...(resolvedDocumentSymbolTimeout ? { timeoutOverride: resolvedDocumentSymbolTimeout } : {})
        }
      );
    } catch (err) {
      log(`[index] ${cmd} documentSymbol failed (${doc.virtualPath}): ${err?.message || err}`);
      if (documentSymbolControl && typeof documentSymbolControl === 'object') {
        documentSymbolControl.disabled = true;
      }
      if (err?.code === 'TOOLING_CIRCUIT_OPEN') {
        recordCircuitOpenCheck({ cmd, guard, checks, checkFlags });
      } else if (err?.code === 'TOOLING_CRASH_LOOP') {
        recordCrashLoopCheck({ cmd, checks, checkFlags, detail: err?.detail || null });
      } else {
        recordDocumentSymbolFailureCheck({ cmd, checks, checkFlags, err });
      }
      return { enrichedDelta: 0 };
    }

    const flattened = flattenSymbols(symbols || []);
    if (!flattened.length) {
      return { enrichedDelta: 0 };
    }

    const openEntry = openDocs.get(doc.virtualPath) || null;
    const lineIndex = openEntry?.lineIndex || lineIndexFactory(openEntry?.text || doc.text || '');
    if (openEntry && !openEntry.lineIndex) openEntry.lineIndex = lineIndex;
    const docText = openEntry?.text || doc.text || '';
    const hoverRequestByPosition = new Map();
    let semanticTokensRequest = null;
    const signatureHelpRequestByPosition = new Map();
    let inlayHintsRequest = null;
    const definitionRequestByPosition = new Map();
    const typeDefinitionRequestByPosition = new Map();
    const referencesRequestByPosition = new Map();
    const symbolRecords = [];
    const budgetControllers = requestBudgetControllers && typeof requestBudgetControllers === 'object'
      ? requestBudgetControllers
      : Object.create(null);
    const hoverBudget = budgetControllers.hover || createRequestBudgetController(resolvedHoverMaxPerFile);
    const semanticTokensBudget = budgetControllers.semanticTokens || createRequestBudgetController(null);
    const signatureHelpBudget = budgetControllers.signatureHelp || createRequestBudgetController(null);
    const inlayHintsBudget = budgetControllers.inlayHints || createRequestBudgetController(null);
    const definitionBudget = budgetControllers.definition || createRequestBudgetController(null);
    const typeDefinitionBudget = budgetControllers.typeDefinition || createRequestBudgetController(null);
    const referencesBudget = budgetControllers.references || createRequestBudgetController(null);
    const requestCacheProviderId = requestCacheContext?.providerId || cmd;
    const requestCacheProviderVersion = requestCacheContext?.providerVersion || null;
    const requestCacheWorkspaceKey = requestCacheContext?.workspaceKey || null;
    const isSoftDeadlineExpired = () => (
      softDeadlineAt != null
      && Number.isFinite(Number(softDeadlineAt))
      && Date.now() >= Number(softDeadlineAt)
    );
    const recordSoftDeadlineSkip = () => {
      fileHoverStats.skippedBySoftDeadline += 1;
      hoverMetrics.skippedBySoftDeadline += 1;
    };
    const markSoftDeadlineReached = () => {
      hoverControl.disabledGlobal = true;
      recordSoftDeadlineCheck({
        cmd,
        checks,
        checkFlags,
        softDeadlineAt
      });
    };
    const reserveRequestBudget = (controller) => {
      if (!controller || typeof controller.tryReserve !== 'function' || controller.tryReserve()) return true;
      fileHoverStats.skippedByBudget += 1;
      hoverMetrics.skippedByBudget += 1;
      return false;
    };
    const buildRequestCacheKeyForStage = (requestKind, position) => buildLspRequestCacheKey({
      providerId: requestCacheProviderId,
      providerVersion: requestCacheProviderVersion,
      workspaceKey: requestCacheWorkspaceKey,
      docHash: doc.docHash || null,
      requestKind,
      position
    });
    const tryReadRequestCache = (requestKind, position) => readRequestCacheEntry({
      requestCacheEntries,
      requestCachePersistedKeys,
      requestCacheMetrics,
      cacheKey: buildRequestCacheKeyForStage(requestKind, position),
      requestKind
    });
    const writePositiveRequestCache = (requestKind, position, info) => {
      writeRequestCacheEntry({
        requestCacheEntries,
        requestCacheMetrics,
        markRequestCacheDirty,
        cacheKey: buildRequestCacheKeyForStage(requestKind, position),
        requestKind,
        info
      });
    };
    const writeNegativeRequestCache = (requestKind, position, ttlMs = null) => {
      writeRequestCacheEntry({
        requestCacheEntries,
        requestCacheMetrics,
        markRequestCacheDirty,
        cacheKey: buildRequestCacheKeyForStage(requestKind, position),
        requestKind,
        negative: true,
        ttlMs
      });
    };
    const resolveDocumentEndPosition = () => {
      const lines = String(openEntry?.text || doc.text || '').split(/\r?\n/u);
      const lastLineIndex = Math.max(0, lines.length - 1);
      return {
        line: lastLineIndex,
        character: String(lines[lastLineIndex] || '').length
      };
    };

    const requestHover = (symbol, position) => {
      throwIfAborted(abortSignal);
      const key = buildSymbolPositionCacheKey({
        position
      });
      if (!key) return Promise.resolve({ attempted: false, info: null });
      if (hoverRequestByPosition.has(key)) return hoverRequestByPosition.get(key);
      if (isSoftDeadlineExpired()) {
        markSoftDeadlineReached();
        recordSoftDeadlineSkip();
        return Promise.resolve({ attempted: false, info: null });
      }
      if (!reserveRequestBudget(hoverBudget)) return Promise.resolve({ attempted: false, info: null });
      const cachedHoverInfo = tryReadRequestCache('hover', position);
      const promise = (async () => {
        if (cachedHoverInfo?.negative === true) {
          return { attempted: false, info: null };
        }
        if (cachedHoverInfo?.info) {
          return { attempted: true, info: cachedHoverInfo.info };
        }

        const hoverTimeoutOverride = Number.isFinite(resolvedHoverTimeout)
          ? resolvedHoverTimeout
          : null;
        fileHoverStats.requested += 1;
        hoverMetrics.requested += 1;
        const hoverStartMs = Date.now();

        try {
          throwIfAborted(abortSignal);
          const hover = await hoverLimiter(() => runGuarded(
            ({ timeoutMs: guardTimeout }) => client.request('textDocument/hover', {
              textDocument: { uri },
              position
            }, { timeoutMs: guardTimeout }),
            { label: 'hover', ...(hoverTimeoutOverride ? { timeoutOverride: hoverTimeoutOverride } : {}) }
          ));
          const hoverDurationMs = Date.now() - hoverStartMs;
          hoverLatencyMs.push(hoverDurationMs);
          fileHoverStats.latencyMs.push(hoverDurationMs);
          fileHoverStats.succeeded += 1;
          hoverMetrics.succeeded += 1;
          const hoverText = normalizeHoverContents(hover?.contents);
          const hoverInfo = parseSignatureCached(hoverText, symbol?.name);
          if (hoverInfo) writePositiveRequestCache('hover', position, hoverInfo);
          else writeNegativeRequestCache('hover', position);
          return { attempted: true, info: hoverInfo };
        } catch (err) {
          const info = handleStageRequestError({
            err,
            cmd,
            stageKey: 'hover',
            guard,
            checks,
            checkFlags,
            fileHoverStats,
            hoverMetrics,
            hoverControl,
            resolvedHoverDisableAfterTimeouts
          });
          writeNegativeRequestCache('hover', position);
          return { attempted: true, info };
        }
      })();
      hoverRequestByPosition.set(key, promise);
      return promise;
    };

    const requestSemanticTokens = () => {
      throwIfAborted(abortSignal);
      if (semanticTokensRequest) return semanticTokensRequest;
      if (isSoftDeadlineExpired()) {
        markSoftDeadlineReached();
        recordSoftDeadlineSkip();
        return Promise.resolve(null);
      }
      if (!reserveRequestBudget(semanticTokensBudget)) return Promise.resolve(null);
      fileHoverStats.semanticTokensRequested += 1;
      hoverMetrics.semanticTokensRequested += 1;
      semanticTokensRequest = (async () => {
        try {
          throwIfAborted(abortSignal);
          const payload = await hoverLimiter(() => runGuarded(
            ({ timeoutMs: guardTimeout }) => client.request('textDocument/semanticTokens/full', {
              textDocument: { uri }
            }, { timeoutMs: guardTimeout }),
            { label: 'semanticTokens', ...(resolvedHoverTimeout ? { timeoutOverride: resolvedHoverTimeout } : {}) }
          ));
          const decoded = decodeSemanticTokens({
            data: payload?.data,
            legend: semanticTokensLegend,
            providerId: requestCacheProviderId
          });
          fileHoverStats.semanticTokensSucceeded += 1;
          hoverMetrics.semanticTokensSucceeded += 1;
          return decoded;
        } catch (err) {
          handleStageRequestError({
            err,
            cmd,
            stageKey: 'semantic_tokens',
            guard,
            checks,
            checkFlags,
            fileHoverStats,
            hoverMetrics,
            hoverControl,
            resolvedHoverDisableAfterTimeouts
          });
          return null;
        }
      })();
      return semanticTokensRequest;
    };

    const requestSignatureHelp = (symbol, position) => {
      throwIfAborted(abortSignal);
      const key = buildSymbolPositionCacheKey({
        position
      });
      if (!key) return Promise.resolve({ attempted: false, info: null });
      if (signatureHelpRequestByPosition.has(key)) return signatureHelpRequestByPosition.get(key);
      if (isSoftDeadlineExpired()) {
        markSoftDeadlineReached();
        recordSoftDeadlineSkip();
        return Promise.resolve({ attempted: false, info: null });
      }
      if (!reserveRequestBudget(signatureHelpBudget)) return Promise.resolve({ attempted: false, info: null });
      const cachedSignatureHelpInfo = tryReadRequestCache('signature_help', position);
      const runSignatureHelp = typeof signatureHelpLimiter === 'function'
        ? signatureHelpLimiter
        : hoverLimiter;
      const promise = (async () => {
        if (cachedSignatureHelpInfo?.negative === true) {
          return { attempted: false, info: null };
        }
        if (cachedSignatureHelpInfo?.info) {
          return { attempted: true, info: cachedSignatureHelpInfo.info };
        }
        const timeoutOverride = Number.isFinite(resolvedSignatureHelpTimeout)
          ? resolvedSignatureHelpTimeout
          : null;
        fileHoverStats.signatureHelpRequested += 1;
        hoverMetrics.signatureHelpRequested += 1;
        try {
          throwIfAborted(abortSignal);
          const signatureHelp = await runSignatureHelp(() => runGuarded(
            ({ timeoutMs: guardTimeout }) => client.request('textDocument/signatureHelp', {
              textDocument: { uri },
              position,
              context: {
                triggerKind: 1,
                isRetrigger: false,
                activeSignatureHelp: null
              }
            }, { timeoutMs: guardTimeout }),
            { label: 'signatureHelp', ...(timeoutOverride ? { timeoutOverride } : {}) }
          ));
          fileHoverStats.signatureHelpSucceeded += 1;
          hoverMetrics.signatureHelpSucceeded += 1;
          const signatureText = extractSignatureHelpText(signatureHelp);
          const info = parseSignatureCached(signatureText, symbol?.name);
          if (info) writePositiveRequestCache('signature_help', position, info);
          else writeNegativeRequestCache('signature_help', position);
          return { attempted: true, info };
        } catch (err) {
          const info = handleStageRequestError({
            err,
            cmd,
            stageKey: 'signature_help',
            guard,
            checks,
            checkFlags,
            fileHoverStats,
            hoverMetrics,
            hoverControl,
            resolvedHoverDisableAfterTimeouts
          });
          writeNegativeRequestCache('signature_help', position);
          return { attempted: true, info };
        }
      })();
      signatureHelpRequestByPosition.set(key, promise);
      return promise;
    };

    const requestInlayHints = () => {
      throwIfAborted(abortSignal);
      if (inlayHintsRequest) return inlayHintsRequest;
      if (isSoftDeadlineExpired()) {
        markSoftDeadlineReached();
        recordSoftDeadlineSkip();
        return Promise.resolve(null);
      }
      if (!reserveRequestBudget(inlayHintsBudget)) return Promise.resolve(null);
      fileHoverStats.inlayHintsRequested += 1;
      hoverMetrics.inlayHintsRequested += 1;
      inlayHintsRequest = (async () => {
        try {
          throwIfAborted(abortSignal);
          const payload = await hoverLimiter(() => runGuarded(
            ({ timeoutMs: guardTimeout }) => client.request('textDocument/inlayHint', {
              textDocument: { uri },
              range: {
                start: { line: 0, character: 0 },
                end: resolveDocumentEndPosition()
              }
            }, { timeoutMs: guardTimeout }),
            { label: 'inlayHints', ...(resolvedHoverTimeout ? { timeoutOverride: resolvedHoverTimeout } : {}) }
          ));
          const hints = Array.isArray(payload) ? payload : [];
          fileHoverStats.inlayHintsSucceeded += 1;
          hoverMetrics.inlayHintsSucceeded += 1;
          return hints;
        } catch (err) {
          handleStageRequestError({
            err,
            cmd,
            stageKey: 'inlay_hints',
            guard,
            checks,
            checkFlags,
            fileHoverStats,
            hoverMetrics,
            hoverControl,
            resolvedHoverDisableAfterTimeouts
          });
          return null;
        }
      })();
      return inlayHintsRequest;
    };

    const requestDefinition = (symbol, position) => {
      throwIfAborted(abortSignal);
      const key = buildSymbolPositionCacheKey({
        position
      });
      if (!key) return Promise.resolve({ attempted: false, info: null });
      if (definitionRequestByPosition.has(key)) return definitionRequestByPosition.get(key);
      if (isSoftDeadlineExpired()) {
        markSoftDeadlineReached();
        recordSoftDeadlineSkip();
        return Promise.resolve({ attempted: false, info: null });
      }
      if (!reserveRequestBudget(definitionBudget)) return Promise.resolve({ attempted: false, info: null });
      const cachedDefinitionInfo = tryReadRequestCache('definition', position);
      const runDefinition = typeof definitionLimiter === 'function'
        ? definitionLimiter
        : hoverLimiter;
      const promise = (async () => {
        if (cachedDefinitionInfo?.negative === true) {
          return { attempted: false, info: null };
        }
        if (cachedDefinitionInfo?.info) {
          return { attempted: true, info: cachedDefinitionInfo.info };
        }
        const timeoutOverride = Number.isFinite(resolvedDefinitionTimeout)
          ? resolvedDefinitionTimeout
          : null;
        fileHoverStats.definitionRequested += 1;
        hoverMetrics.definitionRequested += 1;
        try {
          throwIfAborted(abortSignal);
          const payload = await runDefinition(() => runGuarded(
            ({ timeoutMs: guardTimeout }) => client.request('textDocument/definition', {
              textDocument: { uri },
              position
            }, { timeoutMs: guardTimeout }),
            { label: 'definition', ...(timeoutOverride ? { timeoutOverride } : {}) }
          ));
          const locations = extractDefinitionLocations(payload);
          if (!locations.length) return null;
          const definitionUris = new Set([String(uri || '')]);
          if (legacyUri) definitionUris.add(String(legacyUri));
          for (const location of locations) {
            if (!definitionUris.has(String(location?.uri || ''))) continue;
            const locationOffsets = rangeToOffsets(lineIndex, location?.range || null, {
              text: docText,
              positionEncoding
            });
            let candidate = buildSourceSignatureCandidate(
              openEntry?.text || doc.text || '',
              locationOffsets
            );
            if (!candidate) {
              const fallbackLine = Number(location?.range?.start?.line);
              candidate = buildLineSignatureCandidate(openEntry?.text || doc.text || '', fallbackLine);
            }
            const info = parseSignatureCached(candidate, symbol?.name);
            if (info) {
              writePositiveRequestCache('definition', position, info);
              fileHoverStats.definitionSucceeded += 1;
              hoverMetrics.definitionSucceeded += 1;
              return { attempted: true, info };
            }
          }
          writeNegativeRequestCache('definition', position);
          return { attempted: true, info: null };
        } catch (err) {
          const info = handleStageRequestError({
            err,
            cmd,
            stageKey: 'definition',
            guard,
            checks,
            checkFlags,
            fileHoverStats,
            hoverMetrics,
            hoverControl,
            resolvedHoverDisableAfterTimeouts
          });
          writeNegativeRequestCache('definition', position);
          return { attempted: true, info };
        }
      })();
      definitionRequestByPosition.set(key, promise);
      return promise;
    };

    const requestTypeDefinition = (symbol, position) => {
      throwIfAborted(abortSignal);
      const key = buildSymbolPositionCacheKey({
        position
      });
      if (!key) return Promise.resolve({ attempted: false, info: null });
      if (typeDefinitionRequestByPosition.has(key)) return typeDefinitionRequestByPosition.get(key);
      if (isSoftDeadlineExpired()) {
        markSoftDeadlineReached();
        recordSoftDeadlineSkip();
        return Promise.resolve({ attempted: false, info: null });
      }
      if (!reserveRequestBudget(typeDefinitionBudget)) return Promise.resolve({ attempted: false, info: null });
      const cachedTypeDefinitionInfo = tryReadRequestCache('type_definition', position);
      const runTypeDefinition = typeof typeDefinitionLimiter === 'function'
        ? typeDefinitionLimiter
        : hoverLimiter;
      const promise = (async () => {
        if (cachedTypeDefinitionInfo?.negative === true) {
          return { attempted: false, info: null };
        }
        if (cachedTypeDefinitionInfo?.info) {
          return { attempted: true, info: cachedTypeDefinitionInfo.info };
        }
        const timeoutOverride = Number.isFinite(resolvedTypeDefinitionTimeout)
          ? resolvedTypeDefinitionTimeout
          : null;
        fileHoverStats.typeDefinitionRequested += 1;
        hoverMetrics.typeDefinitionRequested += 1;
        try {
          throwIfAborted(abortSignal);
          const payload = await runTypeDefinition(() => runGuarded(
            ({ timeoutMs: guardTimeout }) => client.request('textDocument/typeDefinition', {
              textDocument: { uri },
              position
            }, { timeoutMs: guardTimeout }),
            { label: 'typeDefinition', ...(timeoutOverride ? { timeoutOverride } : {}) }
          ));
          const locations = extractDefinitionLocations(payload);
          if (!locations.length) return null;
          const definitionUris = new Set([String(uri || '')]);
          if (legacyUri) definitionUris.add(String(legacyUri));
          for (const location of locations) {
            if (!definitionUris.has(String(location?.uri || ''))) continue;
            const locationOffsets = rangeToOffsets(lineIndex, location?.range || null, {
              text: docText,
              positionEncoding
            });
            let candidate = buildSourceSignatureCandidate(
              openEntry?.text || doc.text || '',
              locationOffsets
            );
            if (!candidate) {
              const fallbackLine = Number(location?.range?.start?.line);
              candidate = buildLineSignatureCandidate(openEntry?.text || doc.text || '', fallbackLine);
            }
            const info = parseSignatureCached(candidate, symbol?.name);
            if (info) {
              writePositiveRequestCache('type_definition', position, info);
              fileHoverStats.typeDefinitionSucceeded += 1;
              hoverMetrics.typeDefinitionSucceeded += 1;
              return { attempted: true, info };
            }
          }
          writeNegativeRequestCache('type_definition', position);
          return { attempted: true, info: null };
        } catch (err) {
          const info = handleStageRequestError({
            err,
            cmd,
            stageKey: 'type_definition',
            guard,
            checks,
            checkFlags,
            fileHoverStats,
            hoverMetrics,
            hoverControl,
            resolvedHoverDisableAfterTimeouts
          });
          writeNegativeRequestCache('type_definition', position);
          return { attempted: true, info };
        }
      })();
      typeDefinitionRequestByPosition.set(key, promise);
      return promise;
    };

    const requestReferences = (symbol, position) => {
      throwIfAborted(abortSignal);
      const key = buildSymbolPositionCacheKey({
        position
      });
      if (!key) return Promise.resolve({ attempted: false, info: null });
      if (referencesRequestByPosition.has(key)) return referencesRequestByPosition.get(key);
      if (isSoftDeadlineExpired()) {
        markSoftDeadlineReached();
        recordSoftDeadlineSkip();
        return Promise.resolve({ attempted: false, info: null });
      }
      if (!reserveRequestBudget(referencesBudget)) return Promise.resolve({ attempted: false, info: null });
      const cachedReferencesInfo = tryReadRequestCache('references', position);
      const runReferences = typeof referencesLimiter === 'function'
        ? referencesLimiter
        : hoverLimiter;
      const promise = (async () => {
        if (cachedReferencesInfo?.negative === true) {
          return { attempted: false, info: null };
        }
        if (cachedReferencesInfo?.info) {
          return { attempted: true, info: cachedReferencesInfo.info };
        }
        const timeoutOverride = Number.isFinite(resolvedReferencesTimeout)
          ? resolvedReferencesTimeout
          : null;
        fileHoverStats.referencesRequested += 1;
        hoverMetrics.referencesRequested += 1;
        try {
          throwIfAborted(abortSignal);
          const payload = await runReferences(() => runGuarded(
            ({ timeoutMs: guardTimeout }) => client.request('textDocument/references', {
              textDocument: { uri },
              position,
              context: { includeDeclaration: true }
            }, { timeoutMs: guardTimeout }),
            { label: 'references', ...(timeoutOverride ? { timeoutOverride } : {}) }
          ));
          const locations = extractDefinitionLocations(payload);
          if (!locations.length) return null;
          const referenceUris = new Set([String(uri || '')]);
          if (legacyUri) referenceUris.add(String(legacyUri));
          for (const location of locations) {
            if (!referenceUris.has(String(location?.uri || ''))) continue;
            const locationOffsets = rangeToOffsets(lineIndex, location?.range || null, {
              text: docText,
              positionEncoding
            });
            let candidate = buildSourceSignatureCandidate(
              openEntry?.text || doc.text || '',
              locationOffsets
            );
            if (!candidate) {
              const fallbackLine = Number(location?.range?.start?.line);
              candidate = buildLineSignatureCandidate(openEntry?.text || doc.text || '', fallbackLine);
            }
            const info = parseSignatureCached(candidate, symbol?.name);
            if (info) {
              writePositiveRequestCache('references', position, info);
              fileHoverStats.referencesSucceeded += 1;
              hoverMetrics.referencesSucceeded += 1;
              return { attempted: true, info };
            }
          }
          writeNegativeRequestCache('references', position);
          return { attempted: true, info: null };
        } catch (err) {
          const info = handleStageRequestError({
            err,
            cmd,
            stageKey: 'references',
            guard,
            checks,
            checkFlags,
            fileHoverStats,
            hoverMetrics,
            hoverControl,
            resolvedHoverDisableAfterTimeouts
          });
          writeNegativeRequestCache('references', position);
          return { attempted: true, info };
        }
      })();
      referencesRequestByPosition.set(key, promise);
      return promise;
    };

    for (const symbol of flattened) {
      throwIfAborted(abortSignal);
      const offsets = rangeToOffsets(lineIndex, symbol.selectionRange || symbol.range, {
        text: docText,
        positionEncoding
      });
      const target = findTargetForOffsets(docTargetIndex, offsets, symbol.name);
      if (!target) continue;

      const detailText = symbol.detail || symbol.name;
      let info = parseSignatureCached(detailText, symbol.name);
      const initialIncompleteState = isIncompleteTypePayload(info, { symbolKind: symbol?.kind });
      let sourceSignature = null;
      let sourceBootstrapUsed = false;
      if (initialIncompleteState.incomplete) {
        sourceSignature = buildSourceSignatureCandidate(
          openEntry?.text || doc.text || '',
          target?.virtualRange
        );
      }
      if (sourceSignature) {
        const sourceInfo = parseSignatureCached(sourceSignature, symbol?.name);
        if (sourceInfo) {
          const baseScore = scoreSignatureInfo(info, { symbolKind: symbol?.kind });
          const sourceScore = scoreSignatureInfo(sourceInfo, { symbolKind: symbol?.kind });
          const mergedSourceInfo = mergeSignatureInfo(info, sourceInfo, { symbolKind: symbol?.kind });
          const mergedState = isIncompleteTypePayload(mergedSourceInfo, { symbolKind: symbol?.kind });
          const shouldBootstrapSource = (
            sourceScore.total > baseScore.total
            || (!mergedState.incomplete && baseScore.incomplete)
          );
          if (shouldBootstrapSource) {
            info = mergedSourceInfo;
            sourceBootstrapUsed = true;
            fileHoverStats.sourceBootstrapUsed += 1;
            hoverMetrics.sourceBootstrapUsed += 1;
          }
        }
      }
      const incompleteState = isIncompleteTypePayload(info, { symbolKind: symbol?.kind });
      if (incompleteState.incomplete) {
        hoverMetrics.incompleteSymbols += 1;
      }
      const needsHover = hoverRequireMissingReturn === false
        ? incompleteState.incomplete === true
        : (incompleteState.missingReturn || incompleteState.missingParamTypes);
      if (needsHover) {
        hoverMetrics.hoverTriggeredByIncomplete += 1;
      }
      if (!needsHover) {
        fileHoverStats.skippedByReturnSufficient += 1;
        hoverMetrics.skippedByReturnSufficient += 1;
      }

      const symbolKindAllowed = !resolvedHoverKinds
        || (Number.isInteger(symbol?.kind) && resolvedHoverKinds.has(symbol.kind));
      if (!symbolKindAllowed) {
        fileHoverStats.skippedByKind += 1;
        hoverMetrics.skippedByKind += 1;
      }
      const position = symbol.selectionRange?.start || symbol.range?.start || null;
      symbolRecords.push({
        symbol,
        position,
        target,
        info,
        sourceSignature,
        semanticTokensEligible: (
          semanticTokensEnabled
          && interactiveAllowed
          && position != null
        ),
        hoverEligible: (
          hoverEnabled
          && interactiveAllowed
          && needsHover
          && symbolKindAllowed
          && position != null
        ),
        signatureHelpEligible: (
          signatureHelpEnabled
          && interactiveAllowed
          && needsHover
          && symbolKindAllowed
          && position != null
        ),
        inlayHintsEligible: (
          inlayHintsEnabled
          && interactiveAllowed
          && needsHover
          && position != null
        ),
        definitionEligible: (
          definitionEnabled
          && interactiveAllowed
          && needsHover
          && symbolKindAllowed
          && position != null
          && !sourceSignature
        ),
        typeDefinitionEligible: (
          typeDefinitionEnabled
          && interactiveAllowed
          && needsHover
          && symbolKindAllowed
          && position != null
          && !sourceSignature
        ),
        referencesEligible: (
          referencesEnabled
          && interactiveAllowed
          && FUNCTION_LIKE_SYMBOL_KINDS.has(Number(symbol?.kind))
          && needsHover
          && symbolKindAllowed
          && position != null
          && !sourceSignature
        ),
        semanticTokensRequested: false,
        semanticTokensSucceeded: false,
        hoverRequested: false,
        hoverSucceeded: false,
        signatureHelpRequested: false,
        signatureHelpSucceeded: false,
        inlayHintsRequested: false,
        inlayHintsSucceeded: false,
        definitionRequested: false,
        definitionSucceeded: false,
        typeDefinitionRequested: false,
        typeDefinitionSucceeded: false,
        referencesRequested: false,
        referencesSucceeded: false,
        semanticClass: String(info?.semanticClass || '').trim() || null,
        sourceBootstrapUsed: sourceBootstrapUsed === true,
        sourceFallbackUsed: false
      });
    }

    let enrichedDelta = 0;
    const adaptiveSymbolProcessingConcurrency = clampIntRange(
      Math.max(1, Math.min(
        symbolProcessingConcurrency,
        Math.ceil(Math.max(1, symbolRecords.length) / 8)
      )),
      symbolProcessingConcurrency,
      { min: 1, max: 256 }
    );
    const resolvedSymbolProcessingConcurrency = clampIntRange(
      adaptiveSymbolProcessingConcurrency,
      8,
      { min: 1, max: 256 }
    );
    let unresolvedRecords = symbolRecords.filter((record) => isIncompleteTypePayload(record?.info, {
      symbolKind: record?.symbol?.kind
    }).incomplete);
    const isAdaptiveSuppressed = () => hoverControl.disabledGlobal || fileHoverStats.disabledAdaptive;
    const recordAdaptiveSkip = () => {
      if (hoverControl.disabledGlobal) {
        fileHoverStats.skippedByGlobalDisable += 1;
        hoverMetrics.skippedByGlobalDisable += 1;
      } else if (fileHoverStats.disabledAdaptive) {
        fileHoverStats.skippedByAdaptiveDisable += 1;
        hoverMetrics.skippedByAdaptiveDisable += 1;
      }
    };
    const shouldSuppressAdditionalRequests = () => {
      if (isSoftDeadlineExpired()) {
        markSoftDeadlineReached();
        recordSoftDeadlineSkip();
        return true;
      }
      if (isAdaptiveSuppressed()) {
        recordAdaptiveSkip();
        return true;
      }
      return false;
    };
    const runStagePass = async ({
      enabled = true,
      eligibleFlag,
      requestFn,
      requestedFlag,
      succeededFlag
    }) => {
      if (!enabled || !unresolvedRecords.length) return;
      const stageRecords = unresolvedRecords.filter((record) => record?.[eligibleFlag]);
      if (!stageRecords.length) return;
      await runWithConcurrency(stageRecords, resolvedSymbolProcessingConcurrency, async (record) => {
        throwIfAborted(abortSignal);
        if (shouldSuppressAdditionalRequests()) return;
        const stageResult = await requestFn(record.symbol, record.position);
        if (!stageResult?.attempted) return;
        record[requestedFlag] = true;
        const stageInfo = stageResult.info;
        if (!stageInfo) return;
        record[succeededFlag] = true;
        record.info = mergeSignatureInfo(record.info, stageInfo, { symbolKind: record?.symbol?.kind });
      }, { signal: abortSignal });
      unresolvedRecords = unresolvedRecords.filter((record) => isIncompleteTypePayload(record?.info, {
        symbolKind: record?.symbol?.kind
      }).incomplete);
    };

    if (semanticTokensEnabled !== false) {
      const semanticEligibleRecords = symbolRecords.filter((record) => record?.semanticTokensEligible === true);
      if (semanticEligibleRecords.length && !shouldSuppressAdditionalRequests()) {
        const semanticTokens = await requestSemanticTokens();
        if (Array.isArray(semanticTokens) && semanticTokens.length) {
          for (const record of semanticEligibleRecords) {
            record.semanticTokensRequested = true;
            const token = findSemanticTokenAtPosition(semanticTokens, record.position);
            if (!token?.semanticClass) continue;
            record.semanticTokensSucceeded = true;
            record.semanticClass = token.semanticClass;
            record.info = mergeSignatureInfo(record.info, {
              semanticClass: token.semanticClass,
              semanticTokenType: token.tokenType || null,
              semanticTokenModifiers: Array.isArray(token.tokenModifiers)
                ? token.tokenModifiers.slice()
                : []
            }, { symbolKind: record?.symbol?.kind });
          }
        }
      }
    }

    await runStagePass({
      enabled: hoverEnabled !== false,
      eligibleFlag: 'hoverEligible',
      requestFn: requestHover,
      requestedFlag: 'hoverRequested',
      succeededFlag: 'hoverSucceeded'
    });
    await runStagePass({
      enabled: signatureHelpEnabled !== false,
      eligibleFlag: 'signatureHelpEligible',
      requestFn: requestSignatureHelp,
      requestedFlag: 'signatureHelpRequested',
      succeededFlag: 'signatureHelpSucceeded'
    });
    if (inlayHintsEnabled !== false && unresolvedRecords.length) {
      const inlayEligibleRecords = unresolvedRecords.filter((record) => record?.inlayHintsEligible === true);
      if (inlayEligibleRecords.length && !shouldSuppressAdditionalRequests()) {
        const inlayHints = await requestInlayHints();
        if (Array.isArray(inlayHints)) {
          for (const record of inlayEligibleRecords) {
            record.inlayHintsRequested = true;
            const hintInfo = parseInlayHintSignalInfo({
              hints: inlayHints,
              lineIndex,
              text: docText,
              targetRange: record?.target?.virtualRange || record?.target?.chunkRef?.range || null,
              positionEncoding,
              paramNames: normalizeParamNames(record?.info?.paramNames),
              languageId
            });
            if (!hintInfo) continue;
            record.inlayHintsSucceeded = hintInfo.hintCount > 0;
            if (record.inlayHintsSucceeded) {
              record.info = mergeSignatureInfo(record.info, hintInfo, { symbolKind: record?.symbol?.kind });
            }
          }
          unresolvedRecords = unresolvedRecords.filter((record) => isIncompleteTypePayload(record?.info, {
            symbolKind: record?.symbol?.kind
          }).incomplete);
        }
      }
    }
    await runStagePass({
      enabled: definitionEnabled !== false,
      eligibleFlag: 'definitionEligible',
      requestFn: requestDefinition,
      requestedFlag: 'definitionRequested',
      succeededFlag: 'definitionSucceeded'
    });
    await runStagePass({
      enabled: typeDefinitionEnabled !== false,
      eligibleFlag: 'typeDefinitionEligible',
      requestFn: requestTypeDefinition,
      requestedFlag: 'typeDefinitionRequested',
      succeededFlag: 'typeDefinitionSucceeded'
    });
    await runStagePass({
      enabled: referencesEnabled !== false,
      eligibleFlag: 'referencesEligible',
      requestFn: requestReferences,
      requestedFlag: 'referencesRequested',
      succeededFlag: 'referencesSucceeded'
    });

    const candidateRows = [];
    const unresolvedRate = symbolRecords.length > 0
      ? (unresolvedRecords.length / symbolRecords.length)
      : 0;
    const stabilityTier = resolveProviderStabilityTier({ fileHoverStats, hoverControl });
    const resolveRecordCandidate = async (record, recordIndex) => {
      throwIfAborted(abortSignal);
      let info = record.info;
      const incompleteAfterStages = isIncompleteTypePayload(info, {
        symbolKind: record?.symbol?.kind
      });
      if (incompleteAfterStages.incomplete && record.sourceSignature && !record.sourceBootstrapUsed) {
        const sourceInfo = parseSignatureCached(record.sourceSignature, record?.symbol?.name);
        if (sourceInfo) {
          const fallbackReasons = buildFallbackReasonCodes({
            incompleteState: incompleteAfterStages,
            hoverRequested: record.hoverRequested === true,
            hoverSucceeded: record.hoverSucceeded === true,
            signatureHelpRequested: record.signatureHelpRequested === true,
            signatureHelpSucceeded: record.signatureHelpSucceeded === true,
            inlayHintsRequested: record.inlayHintsRequested === true,
            inlayHintsSucceeded: record.inlayHintsSucceeded === true,
            definitionRequested: record.definitionRequested === true,
            definitionSucceeded: record.definitionSucceeded === true,
            typeDefinitionRequested: record.typeDefinitionRequested === true,
            typeDefinitionSucceeded: record.typeDefinitionSucceeded === true,
            referencesRequested: record.referencesRequested === true,
            referencesSucceeded: record.referencesSucceeded === true
          });
          recordFallbackReasons(hoverMetrics, fallbackReasons);
          info = mergeSignatureInfo(info, sourceInfo, { symbolKind: record?.symbol?.kind });
          record.sourceFallbackUsed = true;
        }
      }
      if (!info) return null;

      const chunkUid = record.target?.chunkRef?.chunkUid;
      if (!chunkUid) {
        if (strict) throw new Error('LSP output missing chunkUid.');
        return null;
      }

      const normalizedSignature = normalizeTypeText(info.signature);
      let normalizedReturn = canonicalizeTypeText(info.returnType, { languageId }).displayText;
      if (normalizedReturn === 'Void' && normalizedSignature?.includes('->')) {
        const arrowMatch = normalizedSignature.split('->').pop();
        const trimmed = arrowMatch ? arrowMatch.trim() : '';
        if (trimmed) {
          normalizedReturn = trimmed === '()' ? 'Void' : trimmed;
        }
      }
      const evidenceTier = resolveEvidenceTier(record);
      const completeness = isIncompleteTypePayload(info, { symbolKind: record?.symbol?.kind });

      const payload = {
        returnType: normalizedReturn,
        paramTypes: normalizeParamTypes(info.paramTypes, {
          defaultConfidence: defaultParamConfidenceForTier(evidenceTier),
          languageId
        }),
        signature: normalizedSignature
      };
      const detailScore = scoreSignatureInfo(info, { symbolKind: record?.symbol?.kind });
      const conflictCount = countParamTypeConflicts(payload.paramTypes);
      const candidateScore = scoreChunkPayloadCandidate({
        info,
        symbol: record.symbol,
        target: record.target
      }) + scoreEvidenceTier(evidenceTier);
      const confidence = scoreLspConfidence({
        evidenceTier,
        completeness,
        conflictCount,
        unresolvedRate,
        stabilityTier,
        sourceFallbackUsed: record?.sourceFallbackUsed === true,
        providerConfidenceBias
      });
      const provenance = buildLspProvenanceEntry({
        cmd,
        record,
        completeness,
        detailScore,
        candidateScore,
        evidenceTier,
        conflictCount,
        unresolvedRate,
        stabilityTier,
        confidence
      });
      const symbolRef = buildLspSymbolRef({
        record,
        payload,
        languageId,
        evidenceConfidence: confidence
      });
      return {
        chunkUid,
        chunkRef: record.target.chunkRef,
        payload,
        ...(symbolRef ? { symbolRef } : {}),
        provenance,
        candidateScore,
        evidenceTier,
        signatureLength: String(payload.signature || '').length,
        recordIndex
      };
    };

    const symbolWorkItems = symbolRecords.map((record, recordIndex) => ({ record, recordIndex }));
    await runWithConcurrency(symbolWorkItems, resolvedSymbolProcessingConcurrency, async (item) => {
      const candidate = await resolveRecordCandidate(item.record, item.recordIndex);
      if (candidate) candidateRows.push(candidate);
    }, { signal: abortSignal });

    candidateRows.sort((a, b) => {
      const chunkCmp = String(a.chunkUid).localeCompare(String(b.chunkUid));
      if (chunkCmp) return chunkCmp;
      const scoreCmp = Number(b.candidateScore || 0) - Number(a.candidateScore || 0);
      if (scoreCmp) return scoreCmp;
      const signatureCmp = Number(b.signatureLength || 0) - Number(a.signatureLength || 0);
      if (signatureCmp) return signatureCmp;
      return Number(a.recordIndex || 0) - Number(b.recordIndex || 0);
    });
    const selectedChunkUids = new Set();
    for (const row of candidateRows) {
      if (selectedChunkUids.has(row.chunkUid)) continue;
      selectedChunkUids.add(row.chunkUid);
      byChunkUid[row.chunkUid] = {
        chunk: row.chunkRef,
        payload: row.payload,
        ...(row.symbolRef ? { symbolRef: row.symbolRef } : {}),
        provenance: row.provenance
      };
      enrichedDelta += 1;
    }

    return { enrichedDelta };
  } finally {
    if (openedHere) {
      // Retain the URI/line-index mapping until diagnostics shaping completes.
      // For tokenized poc-vfs URIs, fallback URI reconstruction can differ from
      // the didOpen URI, so deleting this too early drops diagnostics.
      client.notify('textDocument/didClose', { textDocument: { uri } }, { startIfNeeded: false });
    }
  }
};
