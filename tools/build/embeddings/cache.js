import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { sha1 } from '../../../src/shared/hash.js';
import { buildEmbeddingIdentity, buildEmbeddingIdentityKey } from '../../../src/shared/embedding-identity.js';
import { writeJsonObjectFile } from '../../../src/shared/json-stream.js';

export const buildCacheIdentity = (input = {}) => {
  const identity = buildEmbeddingIdentity(input);
  const key = buildEmbeddingIdentityKey(identity);
  return { identity, key };
};

export const resolveCacheRoot = ({ repoCacheRoot, cacheDirConfig }) => {
  if (cacheDirConfig) return path.resolve(cacheDirConfig);
  return path.join(repoCacheRoot, 'embeddings');
};

export const resolveCacheDir = (cacheRoot, mode) => path.join(cacheRoot, mode, 'files');
export const resolveCacheMetaPath = (cacheRoot, mode) => path.join(cacheRoot, mode, 'cache.meta.json');

export const buildCacheKey = ({ file, hash, signature, identityKey }) => {
  if (!hash) return null;
  return sha1(`${file}:${hash}:${signature}:${identityKey}`);
};

export const isCacheValid = ({ cached, signature, identityKey }) => {
  if (!cached || cached.chunkSignature !== signature) return false;
  return cached.cacheMeta?.identityKey === identityKey;
};

export const readCacheMeta = (cacheRoot, mode) => {
  const metaPath = resolveCacheMetaPath(cacheRoot, mode);
  if (!metaPath || !fsSync.existsSync(metaPath)) return null;
  try {
    const raw = fsSync.readFileSync(metaPath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

export const writeCacheMeta = async (cacheRoot, mode, meta) => {
  const metaPath = resolveCacheMetaPath(cacheRoot, mode);
  if (!metaPath) return;
  await fs.mkdir(path.dirname(metaPath), { recursive: true });
  await writeJsonObjectFile(metaPath, { fields: meta, atomic: true });
};
