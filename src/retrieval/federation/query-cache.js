import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { sha1 } from '../../shared/hash.js';
import { atomicWriteText } from '../../shared/io/atomic-write.js';
import { stableStringify } from '../../shared/stable-json.js';

export const FEDERATED_QUERY_CACHE_SCHEMA_VERSION = 1;

export const FEDERATED_QUERY_CACHE_DEFAULTS = Object.freeze({
  maxEntries: 200,
  maxBytes: 5 * 1024 * 1024,
  maxAgeDays: 30
});

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

const normalizeSelection = (selection = {}) => ({
  selectedRepoIds: normalizeStringList(selection.selectedRepoIds),
  includeDisabled: selection.includeDisabled === true,
  tags: normalizeStringList(selection.tags),
  repoFilter: normalizeStringList(selection.repoFilter),
  explicitSelects: normalizeStringList(selection.explicitSelects)
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
  selection,
  cohorts,
  cohortSelectors = [],
  search = {},
  merge = {},
  limits = {},
  runtime = {}
} = {}) => ({
  v: 1,
  repoSetId: repoSetId || null,
  manifestHash: manifestHash || null,
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

const createEmptyCache = (repoSetId) => ({
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

const parseCacheFile = (raw, repoSetId) => {
  try {
    const parsed = JSON.parse(raw);
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
        createdAt: toIsoString(entry.createdAt, new Date(0).toISOString()),
        lastUsedAt: toIsoString(entry.lastUsedAt, new Date(0).toISOString()),
        manifestHash: entry.manifestHash,
        keyPayloadHash: typeof entry.keyPayloadHash === 'string' ? entry.keyPayloadHash : null,
        result: entry.result
      };
    }
    return {
      schemaVersion: FEDERATED_QUERY_CACHE_SCHEMA_VERSION,
      repoSetId: parsed.repoSetId || repoSetId || null,
      updatedAt: toIsoString(parsed.updatedAt, null),
      entries
    };
  } catch {
    return createEmptyCache(repoSetId);
  }
};

export const loadFederatedQueryCache = async ({
  cachePath,
  repoSetId
} = {}) => {
  if (!cachePath) return createEmptyCache(repoSetId);
  try {
    const raw = await fsPromises.readFile(cachePath, 'utf8');
    return parseCacheFile(raw, repoSetId);
  } catch {
    return createEmptyCache(repoSetId);
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

export const pruneFederatedQueryCache = (cache, policy = {}) => {
  const maxEntries = Number.isFinite(Number(policy.maxEntries))
    ? Math.max(1, Math.floor(Number(policy.maxEntries)))
    : FEDERATED_QUERY_CACHE_DEFAULTS.maxEntries;
  const maxBytes = Number.isFinite(Number(policy.maxBytes))
    ? Math.max(1, Math.floor(Number(policy.maxBytes)))
    : FEDERATED_QUERY_CACHE_DEFAULTS.maxBytes;
  const maxAgeDays = Number.isFinite(Number(policy.maxAgeDays))
    ? Math.max(0, Number(policy.maxAgeDays))
    : FEDERATED_QUERY_CACHE_DEFAULTS.maxAgeDays;
  const cutoff = Date.now() - (maxAgeDays * 24 * 60 * 60 * 1000);

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

  let currentBytes = Buffer.byteLength(stableStringify(cache), 'utf8');
  if (currentBytes > maxBytes) {
    candidates = listEvictionCandidates(cache);
    while (candidates.length && currentBytes > maxBytes) {
      const oldest = candidates.shift();
      if (!oldest) break;
      delete cache.entries[oldest.key];
      currentBytes = Buffer.byteLength(stableStringify(cache), 'utf8');
    }
  }
};

export const findFederatedQueryCacheEntry = (cache, {
  keyHash,
  manifestHash
} = {}) => {
  if (!cache || !cache.entries || !keyHash || !manifestHash) return null;
  const entry = cache.entries[keyHash];
  if (!entry) return null;
  if (entry.manifestHash !== manifestHash) return null;
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
    createdAt: existing?.createdAt || now,
    lastUsedAt: now,
    manifestHash,
    keyPayloadHash: keyPayloadHash || null,
    result: JSON.parse(stableStringify(result))
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

export const persistFederatedQueryCache = async ({
  cachePath,
  cache
} = {}) => {
  if (!cachePath || !cache) return;
  const normalized = {
    schemaVersion: FEDERATED_QUERY_CACHE_SCHEMA_VERSION,
    repoSetId: cache.repoSetId || null,
    updatedAt: cache.updatedAt || null,
    entries: sortObjectDeep(cache.entries || {})
  };
  await atomicWriteText(path.resolve(cachePath), stableStringify(normalized), { newline: true });
};
