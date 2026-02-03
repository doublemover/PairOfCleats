import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { sha1 } from '../../src/shared/hash.js';
import { buildEmbeddingIdentity, buildEmbeddingIdentityKey } from '../../src/shared/embedding-identity.js';
import {
  resolveEmbeddingsCacheBase,
  resolveEmbeddingsCacheModeDir,
  resolveEmbeddingsCacheRoot
} from '../../src/shared/embeddings-cache/index.js';
import { writeJsonObjectFile } from '../../src/shared/json-stream.js';

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
