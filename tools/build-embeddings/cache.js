import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { sha1 } from '../../src/shared/hash.js';
import { buildEmbeddingIdentity, buildEmbeddingIdentityKey } from '../../src/shared/embedding-identity.js';
import {
  decodeEmbeddingsCache,
  encodeEmbeddingsCache,
  getEmbeddingsCacheSuffix,
  resolveEmbeddingsCacheBase,
  resolveEmbeddingsCacheModeDir,
  resolveEmbeddingsCacheRoot
} from '../../src/shared/embeddings-cache/index.js';
import { writeJsonObjectFile } from '../../src/shared/json-stream.js';
import { createTempPath, replaceFile } from './atomic.js';

export const buildCacheIdentity = (input = {}) => {
  const identity = buildEmbeddingIdentity(input);
  const key = buildEmbeddingIdentityKey(identity);
  return { identity, key };
};

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

export const readCacheEntry = async (cacheDir, cacheKey) => {
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

export const writeCacheEntry = async (cacheDir, cacheKey, payload, options = {}) => {
  const targetPath = resolveCacheEntryPath(cacheDir, cacheKey);
  if (!targetPath) return null;
  const tempPath = createTempPath(targetPath);
  try {
    const buffer = await encodeEmbeddingsCache(payload, options);
    await fs.writeFile(tempPath, buffer);
    await replaceFile(tempPath, targetPath);
  } catch (err) {
    try {
      await fs.rm(tempPath, { force: true });
    } catch {}
    throw err;
  }
  return targetPath;
};

export const buildCacheKey = ({ file, hash, signature, identityKey }) => {
  if (!hash) return null;
  return sha1(`${file}:${hash}:${signature}:${identityKey}`);
};

export const isCacheValid = ({ cached, signature, identityKey }) => {
  if (!cached || cached.chunkSignature !== signature) return false;
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
