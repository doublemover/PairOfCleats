import fs from 'node:fs/promises';
import path from 'node:path';
import { writeJsonObjectFile } from '../../../../../shared/json-stream.js';
import {
  normalizeParamNames,
  normalizeParamTypes,
  normalizeTypeText
} from './payload-policy.js';
import {
  clampIntRange
} from './concurrency.js';

export const DEFAULT_LSP_REQUEST_CACHE_MAX_ENTRIES = 50000;
export const LSP_REQUEST_CACHE_POLICY_VERSION = 'rq1';
const LSP_REQUEST_CACHE_SCHEMA_VERSION = 1;
const LSP_REQUEST_CACHE_MAX_READ_BYTES = 16 * 1024 * 1024;
const LSP_REQUEST_CACHE_NEGATIVE_TTL_MS = 30 * 1000;

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

export const buildSymbolPositionCacheKey = ({ position }) => {
  if (!position || !Number.isFinite(position.line) || !Number.isFinite(position.character)) return null;
  return `${Math.floor(position.line)}:${Math.floor(position.character)}`;
};

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

export const normalizeSignatureCacheText = (value) => (
  String(value || '').replace(/\s+/g, ' ').trim()
);

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

export const readRequestCacheEntry = ({
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

export const writeRequestCacheEntry = ({
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
