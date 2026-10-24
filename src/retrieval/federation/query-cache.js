import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { sha1 } from '../../shared/hash.js';
import { atomicWriteText } from '../../shared/io/atomic-write.js';
import { stableStringify } from '../../shared/stable-json.js';
import { loadBoundedJsonFile } from '../../shared/cache/json-file.js';
import { randomUUID } from 'node:crypto';
import { withFileLock } from '../../shared/locks/file-lock.js';
import { loadQueryCacheTouches, persistQueryCacheTouch, clearQueryCacheTouchesUnlocked,
  awaitQueryCacheTouchPublication, requireQueryCacheTouchSettlement } from '../query-cache-touches.js';

export const FEDERATED_QUERY_CACHE_SCHEMA_VERSION = 2;

export const FEDERATED_QUERY_CACHE_DEFAULTS = Object.freeze({
  maxEntries: 200,
  maxBytes: 5 * 1024 * 1024,
  maxAgeDays: 30
});
const FEDERATED_QUERY_CACHE_MAX_READ_BYTES = 16 * 1024 * 1024;
const FEDERATED_QUERY_CACHE_CORRUPT_SUFFIX = '.corrupt';
const cachePolicies = new WeakMap();
// Every loaded snapshot owns mutable entry metadata. Its original payload ids
// distinguish explicit replacements from stale recency-only writes.
const cacheEntryOrigins = new WeakMap();
const rememberEntryOrigins = cache => {
  cacheEntryOrigins.set(cache, new Map(Object.entries(cache.entries).map(([key, entry]) => [key, entry.payloadId])));
  return cache;
};
const parsedCaches = new Map();
let parsedCacheBytes = 0;
const MAX_PARSED_CACHE_BYTES = 16 * 1024 * 1024;
const payloadByteSizes = new WeakMap();
const freezePayload = value => {
  const pending = [value];
  while (pending.length) {
    const next = pending.pop();
    if (!next || typeof next !== 'object' || Object.isFrozen(next)) continue;
    for (const child of Object.values(next)) pending.push(child);
    Object.freeze(next);
  }
  return value;
};
const cacheFileSignature = async cachePath => {
  try {
    const stat = await fsPromises.stat(cachePath, { bigint: true });
    return { signature: [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].map(String).join(':'), bytes: Number(stat.size) };
  } catch { return null; }
};
const forkCache = cache => rememberEntryOrigins({ ...cache,
  entries: Object.fromEntries(Object.entries(cache.entries).map(([key, entry]) => [key, { ...entry }])) });
const rememberParsedCache = (key, record) => {
  const previous = parsedCaches.get(key);
  if (previous) parsedCacheBytes -= previous.bytes;
  parsedCaches.delete(key);
  if (record.bytes <= MAX_PARSED_CACHE_BYTES) {
    parsedCaches.set(key, record); parsedCacheBytes += record.bytes;
  }
  while (parsedCaches.size > 8 || parsedCacheBytes > MAX_PARSED_CACHE_BYTES) {
    const oldest = parsedCaches.keys().next().value;
    parsedCacheBytes -= parsedCaches.get(oldest).bytes; parsedCaches.delete(oldest);
  }
};

const normalizeStringList = (value) => {
  const list = Array.isArray(value) ? value : (value == null ? [] : [value]);
  return Array.from(new Set(
    list
      .map((entry) => String(entry ?? '').trim())
      .filter(Boolean)
  )).sort((a, b) => a.localeCompare(b));
};

const sortObjectDeep = (value) => {
  if (Array.isArray(value)) return value.map((entry) => sortObjectDeep(entry));
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const key of Object.keys(value).sort((a, b) => a.localeCompare(b))) {
    out[key] = sortObjectDeep(value[key]);
  }
  return out;
};

/**
 * Normalize selector input for cache-key hashing.
 *
 * `selectedRepoPriorities` uses `repoId:priority` tokens so workspace priority
 * updates invalidate cached federated ordering even when repo ids are unchanged.
 *
 * @param {any} [selection]
 * @returns {{
 *   selectedRepoIds: string[],
 *   selectedRepoPriorities: string[],
 *   includeDisabled: boolean,
 *   tags: string[],
 *   repoFilter: string[],
 *   explicitSelects: string[]
 * }}
 */
const normalizeSelection = (selection = {}) => ({
  selectedRepoIds: normalizeStringList(selection.selectedRepoIds),
  selectedRepoPriorities: normalizeStringList(
    Array.isArray(selection.selectedRepoPriorities)
      ? selection.selectedRepoPriorities
      : []
  ),
  includeDisabled: selection.includeDisabled === true,
  tags: normalizeStringList(selection.tags),
  repoFilter: normalizeStringList(selection.repoFilter),
  explicitSelects: normalizeStringList(selection.explicitSelects)
});

/**
 * Normalize workspace metadata used for federated cache-key hashing.
 *
 * `configHash` captures workspace display metadata (name/alias/tags/priority),
 * so cache entries are invalidated when response metadata can change even if
 * index-manifest signatures are unchanged.
 *
 * @param {any} [workspace]
 * @returns {{configHash: string|null}}
 */
const normalizeWorkspace = (workspace = {}) => ({
  configHash: typeof workspace?.configHash === 'string' ? workspace.configHash : null
});

const normalizeCohorts = (cohorts = {}, cohortSelectors = []) => {
  const excludedInput = cohorts?.excluded && typeof cohorts.excluded === 'object'
    ? cohorts.excluded
    : {};
  const excluded = {};
  for (const mode of Object.keys(excludedInput).sort((a, b) => a.localeCompare(b))) {
    const entries = Array.isArray(excludedInput[mode]) ? excludedInput[mode] : [];
    excluded[mode] = entries
      .map((entry) => ({
        repoId: entry?.repoId ? String(entry.repoId) : '',
        effectiveKey: entry?.effectiveKey == null ? null : String(entry.effectiveKey),
        reason: entry?.reason ? String(entry.reason) : ''
      }))
      .sort((a, b) => (
        a.repoId.localeCompare(b.repoId)
        || String(a.effectiveKey ?? '').localeCompare(String(b.effectiveKey ?? ''))
        || a.reason.localeCompare(b.reason)
      ));
  }
  return {
    policy: typeof cohorts?.policy === 'string' ? cohorts.policy : 'default',
    modeSelections: sortObjectDeep(cohorts?.modeSelections || {}),
    excluded,
    request: {
      selectors: normalizeStringList(cohortSelectors),
      allowUnsafeMix: cohorts?.policy === 'unsafe-mix'
    }
  };
};

export const buildFederatedQueryCacheKeyPayload = ({
  repoSetId,
  manifestHash,
  query,
  workspace,
  selection,
  cohorts,
  cohortSelectors = [],
  search = {},
  merge = {},
  limits = {},
  runtime = {}
} = {}) => ({
  // Child authority plus sign-safe ranking and reconciled final score evidence.
  v: 9,
  repoSetId: repoSetId || null,
  manifestHash: manifestHash || null,
  workspace: normalizeWorkspace(workspace),
  selection: normalizeSelection(selection),
  cohorts: normalizeCohorts(cohorts, cohortSelectors),
  search: sortObjectDeep({
    query: typeof query === 'string' ? query : '',
    request: search || {}
  }),
  runtime: sortObjectDeep(runtime || {}),
  merge: sortObjectDeep({
    strategy: merge.strategy || 'rrf',
    rrfK: Number.isFinite(Number(merge.rrfK)) ? Number(merge.rrfK) : null
  }),
  limits: sortObjectDeep({
    top: Number.isFinite(Number(limits.top)) ? Number(limits.top) : null,
    perRepoTop: Number.isFinite(Number(limits.perRepoTop)) ? Number(limits.perRepoTop) : null,
    concurrency: Number.isFinite(Number(limits.concurrency)) ? Number(limits.concurrency) : null
  })
});

export const buildFederatedQueryCacheKey = (payload) => {
  const canonical = stableStringify(payload);
  const keyPayloadHash = sha1(canonical);
  return {
    keyHash: `fqc1-${keyPayloadHash}`,
    keyPayloadHash,
    payload
  };
};

const createEmptyCache = (repoSetId) => rememberEntryOrigins({
  schemaVersion: FEDERATED_QUERY_CACHE_SCHEMA_VERSION,
  repoSetId: repoSetId || null,
  updatedAt: null,
  entries: {}
});

const toIsoString = (value, fallback) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return date.toISOString();
};

const toMs = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
};

const normalizeCachePayload = (parsed, repoSetId) => {
  if (!parsed || typeof parsed !== 'object') return createEmptyCache(repoSetId);
  if (parsed.schemaVersion !== FEDERATED_QUERY_CACHE_SCHEMA_VERSION) {
    return createEmptyCache(repoSetId);
  }
  if (repoSetId && parsed.repoSetId && parsed.repoSetId !== repoSetId) {
    return createEmptyCache(repoSetId);
  }
  const entriesInput = parsed.entries && typeof parsed.entries === 'object'
    ? parsed.entries
    : {};
  const entries = {};
  for (const key of Object.keys(entriesInput).sort((a, b) => a.localeCompare(b))) {
    const entry = entriesInput[key];
    if (!entry || typeof entry !== 'object') continue;
    if (typeof entry.manifestHash !== 'string' || !entry.manifestHash) continue;
    entries[key] = {
      payloadId: typeof entry.payloadId === 'string' ? entry.payloadId : null,
      createdAt: toIsoString(entry.createdAt, new Date(0).toISOString()),
      lastUsedAt: toIsoString(entry.lastUsedAt, new Date(0).toISOString()),
      manifestHash: entry.manifestHash,
      keyPayloadHash: typeof entry.keyPayloadHash === 'string' ? entry.keyPayloadHash : null,
      result: freezePayload(entry.result)
    };
  }
  return rememberEntryOrigins({
    schemaVersion: FEDERATED_QUERY_CACHE_SCHEMA_VERSION,
    repoSetId: parsed.repoSetId || repoSetId || null,
    updatedAt: toIsoString(parsed.updatedAt, null),
    entries
  });
};

const bumpCacheHealthCounter = (health, key) => {
  if (!health || typeof health !== 'object' || !key) return;
  const current = Number.isFinite(Number(health[key])) ? Number(health[key]) : 0;
  health[key] = current + 1;
};

const emitCacheWarning = (log, message) => {
  if (typeof log === 'function') {
    log(message);
    return;
  }
  try {
    process.emitWarning(message, { code: 'FEDERATED_QUERY_CACHE_WARNING' });
  } catch {}
};

const quarantineCorruptCacheFile = async (cachePath, log) => {
  if (!cachePath) return null;
  const quarantinePath = `${cachePath}${FEDERATED_QUERY_CACHE_CORRUPT_SUFFIX}-${Date.now()}`;
  try {
    await fsPromises.rename(cachePath, quarantinePath);
    emitCacheWarning(log, `[retrieval:federation] quarantined corrupt cache file: ${quarantinePath}`);
    return quarantinePath;
  } catch (error) {
    emitCacheWarning(
      log,
      `[retrieval:federation] failed to quarantine corrupt cache file (${cachePath}): ${error?.message || error}`
    );
    return null;
  }
};

export const loadFederatedQueryCache = async ({
  cachePath,
  repoSetId,
  log = null,
  health = null
} = {}) => {
  if (!cachePath) return createEmptyCache(repoSetId);
  const parsedKey = JSON.stringify([path.resolve(cachePath), repoSetId || null]);
  const before = await cacheFileSignature(cachePath);
  const remembered = parsedCaches.get(parsedKey);
  if (remembered && before?.signature === remembered.signature) {
    parsedCaches.delete(parsedKey); parsedCaches.set(parsedKey, remembered);
    const cache = forkCache(remembered.cache); foldFederatedTouches(cache, cachePath); return cache;
  }
  if (remembered) { parsedCacheBytes -= remembered.bytes; parsedCaches.delete(parsedKey); }
  const {
    data: parsedPayload,
    error: readError,
    phase: readPhase
  } = await loadBoundedJsonFile(cachePath, {
    fallback: null,
    maxBytes: FEDERATED_QUERY_CACHE_MAX_READ_BYTES
  });
  if (readError) {
    const readErrorCode = typeof readError?.code === 'string' ? readError.code : null;
    if (readError?.code === 'ERR_JSON_FILE_TOO_LARGE') {
      emitCacheWarning(
        log,
        `[retrieval:federation] cache file oversized (> ${FEDERATED_QUERY_CACHE_MAX_READ_BYTES} bytes); using empty cache.`
      );
      bumpCacheHealthCounter(health, 'federatedQueryCacheOversized');
      return createEmptyCache(repoSetId);
    }
    if (readErrorCode !== 'ENOENT') {
      if (readPhase === 'parse') {
        bumpCacheHealthCounter(health, 'federatedQueryCacheParseFailures');
      } else {
        bumpCacheHealthCounter(health, 'federatedQueryCacheReadFailures');
      }
      emitCacheWarning(
        log,
        `[retrieval:federation] cache ${readPhase === 'parse' ? 'parse' : 'read'} failed `
          + `(${readErrorCode || 'ERR_READ'}): ${readError?.message || readError}`
      );
      await quarantineCorruptCacheFile(cachePath, log);
    }
    return createEmptyCache(repoSetId);
  }
  const cache = normalizeCachePayload(parsedPayload, repoSetId);
  const after = await cacheFileSignature(cachePath);
  if (before && after?.signature === before.signature) rememberParsedCache(parsedKey, { ...after, cache: forkCache(cache) });
  foldFederatedTouches(cache, cachePath);
  return cache;
};

const foldFederatedTouches = (cache, cachePath) => {
  for (const touch of loadQueryCacheTouches(cachePath)) {
    const entry = cache.entries[touch.key];
    if (entry?.manifestHash === touch.signature && entry.payloadId === touch.payloadId)
      entry.lastUsedAt = new Date(Math.max(toMs(entry.lastUsedAt), touch.ts)).toISOString();
  }
};

const listEvictionCandidates = (cache) => (
  Object.entries(cache.entries || {})
    .map(([key, entry]) => ({ key, entry }))
    .sort((a, b) => (
      toMs(a.entry.lastUsedAt) - toMs(b.entry.lastUsedAt)
      || toMs(a.entry.createdAt) - toMs(b.entry.createdAt)
      || a.key.localeCompare(b.key)
    ))
);

const estimateFederatedCacheEntryBytes = (key, entry) => {
  const result = entry.result;
  if (!result || typeof result !== 'object' || !Object.isFrozen(result))
    return Buffer.byteLength(stableStringify({ [key]: entry }), 'utf8');
  let bytes = payloadByteSizes.get(result);
  if (bytes == null) { bytes = Buffer.byteLength(stableStringify(result), 'utf8'); payloadByteSizes.set(result, bytes); }
  return Buffer.byteLength(stableStringify({ [key]: { ...entry, result: null } }), 'utf8') - 4 + bytes;
};

const estimateFederatedCacheHeaderBytes = (cache) => {
  const envelope = {
    schemaVersion: cache?.schemaVersion ?? FEDERATED_QUERY_CACHE_SCHEMA_VERSION,
    repoSetId: cache?.repoSetId || null,
    updatedAt: cache?.updatedAt || null,
    entries: {}
  };
  return Buffer.byteLength(stableStringify(envelope), 'utf8');
};

const resolveAgeCutoff = (policy, now) => {
  const maxAgeDays = Number.isFinite(Number(policy.maxAgeDays))
    ? Math.max(0, Number(policy.maxAgeDays))
    : FEDERATED_QUERY_CACHE_DEFAULTS.maxAgeDays;
  return now - (maxAgeDays * 24 * 60 * 60 * 1000);
};

export const pruneFederatedQueryCache = (cache, policy = {}) => {
  cachePolicies.set(cache, policy);
  const maxEntries = Number.isFinite(Number(policy.maxEntries))
    ? Math.max(1, Math.floor(Number(policy.maxEntries)))
    : FEDERATED_QUERY_CACHE_DEFAULTS.maxEntries;
  const maxBytes = Number.isFinite(Number(policy.maxBytes))
    ? Math.min(FEDERATED_QUERY_CACHE_MAX_READ_BYTES, Math.max(1, Math.floor(Number(policy.maxBytes))))
    : FEDERATED_QUERY_CACHE_DEFAULTS.maxBytes;
  const cutoff = resolveAgeCutoff(policy, Date.now());

  for (const [key, entry] of Object.entries(cache.entries || {})) {
    if (toMs(entry.lastUsedAt) < cutoff) {
      delete cache.entries[key];
    }
  }

  let candidates = listEvictionCandidates(cache);
  while (candidates.length > maxEntries) {
    const oldest = candidates.shift();
    if (!oldest) break;
    delete cache.entries[oldest.key];
  }

  const headerBytes = estimateFederatedCacheHeaderBytes(cache);
  const entryByteSizes = new Map();
  let currentBytes = headerBytes;
  for (const [key, entry] of Object.entries(cache.entries || {})) {
    const size = estimateFederatedCacheEntryBytes(key, entry);
    entryByteSizes.set(key, size);
    currentBytes += size;
  }
  if (currentBytes > maxBytes) {
    candidates = listEvictionCandidates(cache);
    while (candidates.length && currentBytes > maxBytes) {
      const oldest = candidates.shift();
      if (!oldest) break;
      delete cache.entries[oldest.key];
      const reclaimed = Number(entryByteSizes.get(oldest.key) || 0);
      currentBytes = Math.max(headerBytes, currentBytes - reclaimed);
    }
  }
  if (currentBytes > maxBytes) {
    candidates = listEvictionCandidates(cache);
    while (candidates.length && Buffer.byteLength(stableStringify(cache), 'utf8') > maxBytes) {
      const oldest = candidates.shift();
      if (!oldest) break;
      delete cache.entries[oldest.key];
    }
  }
};

export const findFederatedQueryCacheEntry = (cache, {
  keyHash,
  manifestHash,
  policy = {},
  now = Date.now()
} = {}) => {
  if (!cache || !cache.entries || !keyHash || !manifestHash) return null;
  const entry = cache.entries[keyHash];
  if (!entry) return null;
  if (entry.manifestHash !== manifestHash) return null;
  if (toMs(entry.lastUsedAt) < resolveAgeCutoff(policy, now)) return null;
  return entry;
};

export const upsertFederatedQueryCacheEntry = (cache, {
  keyHash,
  keyPayloadHash,
  manifestHash,
  result,
  now = new Date().toISOString(),
  policy = {}
} = {}) => {
  if (!cache || !cache.entries || !keyHash || !manifestHash) return;
  const existing = cache.entries[keyHash];
  cache.entries[keyHash] = {
    payloadId: randomUUID(),
    createdAt: existing?.createdAt || now,
    lastUsedAt: now,
    manifestHash,
    keyPayloadHash: keyPayloadHash || null,
    result: freezePayload(JSON.parse(stableStringify(result)))
  };
  cache.updatedAt = now;
  pruneFederatedQueryCache(cache, policy);
};

export const touchFederatedQueryCacheEntry = (cache, keyHash, now = new Date().toISOString()) => {
  if (!cache || !cache.entries || !keyHash) return;
  const entry = cache.entries[keyHash];
  if (!entry) return;
  entry.lastUsedAt = now;
  cache.updatedAt = now;
};

export const persistFederatedQueryCacheTouch = ({ cachePath, cache, keyHash, maxEntries }) => {
  const entry = cache.entries[keyHash];
  return persistQueryCacheTouch({ cachePath, key: keyHash, signature: entry.manifestHash,
    payloadId: entry.payloadId, ts: toMs(entry.lastUsedAt), maxEntries });
};

export const persistFederatedQueryCache = async ({
  cachePath,
  cache
} = {}) => {
  if (!cachePath || !cache) return;
  const submitted = Object.fromEntries(Object.entries(cache.entries || {}).map(([key, entry]) => [key, { ...entry }]));
  const origins = new Map(cacheEntryOrigins.get(cache) || []);
  const policy = cachePolicies.get(cache) || {};
  await awaitQueryCacheTouchPublication(cachePath);
  await withFileLock({ lockPath: `${cachePath}.lock`, waitMs: 5000, timeoutBehavior: 'throw' }, async () => {
    const disk = await loadFederatedQueryCache({ cachePath, repoSetId: cache.repoSetId });
    requireQueryCacheTouchSettlement(cachePath);
    const merged = { ...disk.entries };
    for (const [key, entry] of Object.entries(submitted)) {
      const replaced = !origins.has(key) || entry.payloadId !== origins.get(key);
      if (replaced) {
        merged[key] = entry;
      } else if (merged[key]?.payloadId === entry.payloadId && merged[key].manifestHash === entry.manifestHash) {
        // A touch can only extend the exact payload it observed. It cannot
        // resurrect an evicted entry or overwrite a newer generation/result.
        merged[key] = { ...merged[key], lastUsedAt: new Date(Math.max(toMs(merged[key].lastUsedAt), toMs(entry.lastUsedAt))).toISOString() };
      }
    }
    for (const entry of Object.values(merged)) entry.payloadId ||= randomUUID();
    const normalized = {
      schemaVersion: FEDERATED_QUERY_CACHE_SCHEMA_VERSION,
      repoSetId: cache.repoSetId || null,
      updatedAt: cache.updatedAt || null,
      // Preserve frozen payload identities so byte accounting never needs a
      // second serialization of every retained payload during checkpointing.
      entries: Object.fromEntries(Object.keys(merged).sort((a, b) => a.localeCompare(b)).map(key => [key, merged[key]]))
    };
    pruneFederatedQueryCache(normalized, policy);
    await atomicWriteText(path.resolve(cachePath), stableStringify(normalized), { newline: true });
    await clearQueryCacheTouchesUnlocked(cachePath);
    const currentOrigins = cacheEntryOrigins.get(cache) || new Map();
    for (const [key, entry] of Object.entries(submitted)) {
      if (cache.entries?.[key]?.payloadId === entry.payloadId) currentOrigins.set(key, entry.payloadId);
    }
    cacheEntryOrigins.set(cache, currentOrigins);
  });
};
