import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { sha1 } from '../../../src/shared/hash.js';
import { buildEmbeddingIdentity, buildEmbeddingIdentityKey } from '../../../src/shared/embedding-identity.js';
import {
  decodeEmbeddingsCache,
  encodeEmbeddingsCache,
  getEmbeddingsCacheSuffix,
  planEmbeddingsCachePrune,
  resolveEmbeddingsCacheBase,
  resolveEmbeddingsCacheModeDir,
  resolveEmbeddingsCacheRoot
} from '../../../src/shared/embeddings-cache/index.js';
import { writeJsonObjectFile } from '../../../src/shared/json-stream.js';
import { createTempPath, replaceFile } from './atomic.js';

const CACHE_INDEX_VERSION = 1;
const DEFAULT_MAX_SHARD_BYTES = 128 * 1024 * 1024;
const CACHE_ENTRY_PREFIX_BYTES = 4;

/**
 * Build embedding identity + key for cache usage.
 *
 * Deterministic: identical inputs produce identical identity and key.
 *
 * @param {object} [input]
 * @returns {{ identity: object, key: string }}
 */
export const buildCacheIdentity = (input = {}) => {
  const identity = buildEmbeddingIdentity(input);
  const key = buildEmbeddingIdentityKey(identity);
  return { identity, key };
};

/**
 * Resolve cache root based on scope and config.
 * @param {{ repoCacheRoot?: string, cacheDirConfig?: string, scope?: string }} options
 * @returns {string}
 */
export const resolveCacheRoot = ({ repoCacheRoot, cacheDirConfig, scope }) => (
  resolveEmbeddingsCacheRoot({ repoCacheRoot, cacheDirConfig, scope })
);

export const resolveCacheBase = (cacheRoot, identity) => resolveEmbeddingsCacheBase({
  cacheRoot,
  provider: identity?.provider,
  modelId: identity?.modelId,
  dims: identity?.dims
});

export const resolveCacheModeDir = (cacheRoot, identity, mode) => (
  resolveEmbeddingsCacheModeDir(resolveCacheBase(cacheRoot, identity), mode)
);

export const resolveCacheDir = (cacheRoot, identity, mode) => (
  path.join(resolveCacheModeDir(cacheRoot, identity, mode), 'files')
);
export const resolveCacheMetaPath = (cacheRoot, identity, mode) => (
  path.join(resolveCacheModeDir(cacheRoot, identity, mode), 'cache.meta.json')
);

export const resolveCacheIndexPath = (cacheDir) => (
  cacheDir ? path.join(cacheDir, 'cache.index.json') : null
);

export const resolveCacheShardDir = (cacheDir) => (
  cacheDir ? path.join(cacheDir, 'shards') : null
);

export const resolveCacheShardPath = (cacheDir, shardName) => (
  cacheDir && shardName ? path.join(resolveCacheShardDir(cacheDir), shardName) : null
);

const resolveCacheEntrySuffix = () => getEmbeddingsCacheSuffix();

export const resolveCacheEntryPath = (cacheDir, cacheKey, options = {}) => {
  if (!cacheDir || !cacheKey) return null;
  if (options.legacy) {
    return path.join(cacheDir, `${cacheKey}.json`);
  }
  return path.join(cacheDir, `${cacheKey}${resolveCacheEntrySuffix()}`);
};

export const readCacheEntryFile = async (filePath) => {
  if (!filePath) return null;
  if (filePath.endsWith('.json')) {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  }
  const raw = await fs.readFile(filePath);
  return decodeEmbeddingsCache(raw);
};

const createCacheIndex = (identityKey) => {
  const now = new Date().toISOString();
  return {
    version: CACHE_INDEX_VERSION,
    identityKey: identityKey || null,
    createdAt: now,
    updatedAt: now,
    nextShardId: 0,
    currentShard: null,
    entries: {},
    files: {},
    shards: {}
  };
};

const normalizeCacheIndex = (index, identityKey) => {
  if (!index || typeof index !== 'object') return createCacheIndex(identityKey);
  if (index.version !== CACHE_INDEX_VERSION) return createCacheIndex(identityKey);
  const normalized = { ...index };
  normalized.identityKey = normalized.identityKey || identityKey || null;
  normalized.entries = { ...(normalized.entries || {}) };
  normalized.files = { ...(normalized.files || {}) };
  normalized.shards = { ...(normalized.shards || {}) };
  normalized.nextShardId = Number.isFinite(Number(normalized.nextShardId))
    ? Math.max(0, Math.floor(Number(normalized.nextShardId)))
    : Object.keys(normalized.shards).length;
  return normalized;
};

export const readCacheIndex = async (cacheDir, identityKey = null) => {
  const indexPath = resolveCacheIndexPath(cacheDir);
  if (!indexPath || !fsSync.existsSync(indexPath)) return createCacheIndex(identityKey);
  try {
    const raw = await fs.readFile(indexPath, 'utf8');
    const parsed = normalizeCacheIndex(JSON.parse(raw), identityKey);
    if (identityKey && parsed.identityKey && parsed.identityKey !== identityKey) {
      return createCacheIndex(identityKey);
    }
    return parsed;
  } catch {
    return createCacheIndex(identityKey);
  }
};

export const writeCacheIndex = async (cacheDir, index) => {
  const indexPath = resolveCacheIndexPath(cacheDir);
  if (!indexPath) return;
  await fs.mkdir(path.dirname(indexPath), { recursive: true });
  await writeJsonObjectFile(indexPath, { fields: index, atomic: true });
};

const readCacheEntryFromShard = async (cacheDir, shardEntry) => {
  const shardPath = resolveCacheShardPath(cacheDir, shardEntry?.shard);
  if (!shardPath || !fsSync.existsSync(shardPath)) return null;
  const handle = await fs.open(shardPath, 'r');
  try {
    const length = Number(shardEntry?.length) || 0;
    const offset = Number(shardEntry?.offset) || 0;
    if (!length || offset < 0) return null;
    const buffer = Buffer.allocUnsafe(length);
    await handle.read(buffer, 0, length, offset);
    return decodeEmbeddingsCache(buffer);
  } finally {
    await handle.close();
  }
};

/**
 * Read a cache entry from shard or legacy file.
 *
 * @param {string} cacheDir
 * @param {string} cacheKey
 * @param {object|null} cacheIndex
 * @returns {Promise<{ path: string|null, entry: object|null, indexEntry?: object }>}
 */
export const readCacheEntry = async (cacheDir, cacheKey, cacheIndex = null) => {
  const indexEntry = cacheIndex?.entries?.[cacheKey];
  if (indexEntry?.shard) {
    const entry = await readCacheEntryFromShard(cacheDir, indexEntry);
    if (entry) {
      return { path: resolveCacheShardPath(cacheDir, indexEntry.shard), entry, indexEntry };
    }
  }
  const primaryPath = resolveCacheEntryPath(cacheDir, cacheKey);
  if (primaryPath && fsSync.existsSync(primaryPath)) {
    return { path: primaryPath, entry: await readCacheEntryFile(primaryPath) };
  }
  const legacyPath = resolveCacheEntryPath(cacheDir, cacheKey, { legacy: true });
  if (legacyPath && fsSync.existsSync(legacyPath)) {
    return { path: legacyPath, entry: await readCacheEntryFile(legacyPath) };
  }
  return { path: primaryPath, entry: null };
};

export const updateCacheIndexAccess = (cacheIndex, cacheKey) => {
  if (!cacheIndex || !cacheKey) return null;
  const entry = cacheIndex.entries?.[cacheKey];
  if (!entry) return null;
  entry.lastAccessAt = new Date().toISOString();
  entry.hits = Number.isFinite(Number(entry.hits)) ? Number(entry.hits) + 1 : 1;
  cacheIndex.entries[cacheKey] = entry;
  cacheIndex.updatedAt = entry.lastAccessAt;
  return entry;
};

const resolveShardName = (shardId) => `shard-${String(shardId).padStart(5, '0')}.bin`;

const allocateShard = (cacheIndex) => {
  const now = new Date().toISOString();
  const shardId = Number.isFinite(Number(cacheIndex.nextShardId))
    ? Math.max(0, Math.floor(Number(cacheIndex.nextShardId)))
    : Object.keys(cacheIndex.shards || {}).length;
  const shardName = resolveShardName(shardId);
  cacheIndex.nextShardId = shardId + 1;
  cacheIndex.currentShard = shardName;
  cacheIndex.shards = { ...(cacheIndex.shards || {}), [shardName]: { createdAt: now, sizeBytes: 0 } };
  return shardName;
};

const selectShardForWrite = (cacheIndex, payloadBytes, maxShardBytes) => {
  const resolvedMax = Number.isFinite(Number(maxShardBytes))
    ? Math.max(1, Math.floor(Number(maxShardBytes)))
    : DEFAULT_MAX_SHARD_BYTES;
  const currentName = cacheIndex.currentShard;
  const currentMeta = currentName ? cacheIndex.shards?.[currentName] : null;
  const currentSize = Number.isFinite(Number(currentMeta?.sizeBytes)) ? Number(currentMeta.sizeBytes) : 0;
  if (!currentName || !currentMeta) {
    return allocateShard(cacheIndex);
  }
  if (currentSize + payloadBytes + CACHE_ENTRY_PREFIX_BYTES > resolvedMax) {
    return allocateShard(cacheIndex);
  }
  return currentName;
};

const appendShardEntry = async (cacheDir, cacheIndex, buffer, options = {}) => {
  const shardDir = resolveCacheShardDir(cacheDir);
  if (!shardDir) return null;
  await fs.mkdir(shardDir, { recursive: true });
  const shardName = selectShardForWrite(cacheIndex, buffer.length, options.maxShardBytes);
  const shardPath = resolveCacheShardPath(cacheDir, shardName);
  const handle = await fs.open(shardPath, 'a');
  try {
    const stat = await handle.stat();
    const offset = stat.size;
    const prefix = Buffer.allocUnsafe(CACHE_ENTRY_PREFIX_BYTES);
    prefix.writeUInt32LE(buffer.length, 0);
    await handle.write(prefix, 0, CACHE_ENTRY_PREFIX_BYTES, offset);
    await handle.write(buffer, 0, buffer.length, offset + CACHE_ENTRY_PREFIX_BYTES);
    const totalBytes = CACHE_ENTRY_PREFIX_BYTES + buffer.length;
    const shardMeta = cacheIndex.shards?.[shardName] || { createdAt: new Date().toISOString(), sizeBytes: 0 };
    shardMeta.sizeBytes = offset + totalBytes;
    cacheIndex.shards[shardName] = shardMeta;
    return { shard: shardName, offset: offset + CACHE_ENTRY_PREFIX_BYTES, length: buffer.length, sizeBytes: totalBytes };
  } finally {
    await handle.close();
  }
};

/**
 * Write a cache entry to shard or standalone file.
 *
 * Side effects: writes to disk and updates shards when index is provided.
 *
 * @param {string} cacheDir
 * @param {string} cacheKey
 * @param {object} payload
 * @param {object} [options]
 * @returns {Promise<object|null>}
 */
export const writeCacheEntry = async (cacheDir, cacheKey, payload, options = {}) => {
  const targetPath = resolveCacheEntryPath(cacheDir, cacheKey);
  if (!targetPath) return null;
  const tempPath = createTempPath(targetPath);
  try {
    const buffer = await encodeEmbeddingsCache(payload, options);
    if (options.index) {
      const shardEntry = await appendShardEntry(cacheDir, options.index, buffer, options);
      if (shardEntry) return shardEntry;
    }
    await fs.writeFile(tempPath, buffer);
    await replaceFile(tempPath, targetPath);
  } catch (err) {
    try {
      await fs.rm(tempPath, { force: true });
    } catch {}
    throw err;
  }
  return { path: targetPath };
};

export const upsertCacheIndexEntry = (cacheIndex, cacheKey, payload, shardEntry = null) => {
  if (!cacheIndex || !cacheKey || !payload) return null;
  const now = new Date().toISOString();
  const existing = cacheIndex.entries?.[cacheKey] || {};
  const next = {
    key: cacheKey,
    file: payload.file || existing.file || null,
    hash: payload.hash || existing.hash || null,
    chunkSignature: payload.chunkSignature || existing.chunkSignature || null,
    shard: shardEntry?.shard || existing.shard || null,
    offset: Number.isFinite(Number(shardEntry?.offset)) ? Number(shardEntry.offset) : existing.offset || null,
    length: Number.isFinite(Number(shardEntry?.length)) ? Number(shardEntry.length) : existing.length || null,
    sizeBytes: Number.isFinite(Number(shardEntry?.sizeBytes)) ? Number(shardEntry.sizeBytes) : existing.sizeBytes || null,
    chunkCount: Array.isArray(payload.codeVectors) ? payload.codeVectors.length : existing.chunkCount || null,
    createdAt: existing.createdAt || now,
    lastAccessAt: now,
    hits: Number.isFinite(Number(existing.hits)) ? Number(existing.hits) : 0
  };
  cacheIndex.entries = { ...(cacheIndex.entries || {}), [cacheKey]: next };
  if (next.file) {
    cacheIndex.files = { ...(cacheIndex.files || {}), [next.file]: cacheKey };
  }
  cacheIndex.updatedAt = now;
  return next;
};

/**
 * Prune cache index entries by size or age.
 *
 * @param {string} cacheDir
 * @param {object} cacheIndex
 * @param {{ maxBytes?: number, maxAgeMs?: number }} [options]
 * @returns {Promise<{ removedKeys: string[], removedShards: string[], changed: boolean }>}
 */
export const pruneCacheIndex = async (cacheDir, cacheIndex, options = {}) => {
  if (!cacheDir || !cacheIndex) return { removedKeys: [], removedShards: [], changed: false };
  const maxBytes = Number.isFinite(Number(options.maxBytes)) ? Math.max(0, Number(options.maxBytes)) : 0;
  const maxAgeMs = Number.isFinite(Number(options.maxAgeMs)) ? Math.max(0, Number(options.maxAgeMs)) : 0;
  if (!maxBytes && !maxAgeMs) return { removedKeys: [], removedShards: [], changed: false };
  const plan = planEmbeddingsCachePrune({
    entries: cacheIndex.entries || {},
    maxBytes,
    maxAgeMs,
    now: Date.now()
  });
  if (!plan.removeKeys.length) return { removedKeys: [], removedShards: [], changed: false };
  const removeSet = new Set(plan.removeKeys);
  for (const key of plan.removeKeys) {
    delete cacheIndex.entries?.[key];
  }
  if (cacheIndex.files) {
    for (const [file, key] of Object.entries(cacheIndex.files)) {
      if (removeSet.has(key)) delete cacheIndex.files[file];
    }
  }
  const shardUsage = {};
  for (const entry of Object.values(cacheIndex.entries || {})) {
    if (entry?.shard) {
      shardUsage[entry.shard] = (shardUsage[entry.shard] || 0) + 1;
    }
  }
  const removedShards = [];
  for (const shardName of Object.keys(cacheIndex.shards || {})) {
    if (shardUsage[shardName]) continue;
    const shardPath = resolveCacheShardPath(cacheDir, shardName);
    if (shardPath) {
      try {
        await fs.rm(shardPath, { force: true });
      } catch {}
    }
    removedShards.push(shardName);
    delete cacheIndex.shards[shardName];
    if (cacheIndex.currentShard === shardName) {
      cacheIndex.currentShard = null;
    }
  }
  cacheIndex.updatedAt = new Date().toISOString();
  return { removedKeys: plan.removeKeys, removedShards, changed: true };
};

export const buildCacheKey = ({ file, hash, signature, identityKey }) => {
  if (!hash) return null;
  return sha1(`${file}:${hash}:${signature}:${identityKey}`);
};

export const isCacheValid = ({ cached, signature, identityKey, hash }) => {
  if (!cached || cached.chunkSignature !== signature) return false;
  if (hash && cached.hash && cached.hash !== hash) return false;
  return cached.cacheMeta?.identityKey === identityKey;
};

export const readCacheMeta = (cacheRoot, identity, mode) => {
  const metaPath = resolveCacheMetaPath(cacheRoot, identity, mode);
  if (!metaPath || !fsSync.existsSync(metaPath)) return null;
  try {
    const raw = fsSync.readFileSync(metaPath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

export const writeCacheMeta = async (cacheRoot, identity, mode, meta) => {
  const metaPath = resolveCacheMetaPath(cacheRoot, identity, mode);
  if (!metaPath) return;
  await fs.mkdir(path.dirname(metaPath), { recursive: true });
  await writeJsonObjectFile(metaPath, { fields: meta, atomic: true });
};
