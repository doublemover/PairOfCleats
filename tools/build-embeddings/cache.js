import path from 'node:path';
import { sha1 } from '../../src/shared/hash.js';

export const buildCacheIdentity = ({ modelId, provider, mode, stub, dims, scale }) => {
  const identity = {
    version: 1,
    modelId: modelId || null,
    provider: provider || null,
    mode: mode || null,
    stub: stub === true,
    dims: dims ?? null,
    scale
  };
  const key = sha1(JSON.stringify(identity));
  return { identity, key };
};

export const resolveCacheRoot = ({ repoCacheRoot, cacheDirConfig }) => {
  if (cacheDirConfig) return path.resolve(cacheDirConfig);
  return path.join(repoCacheRoot, 'embeddings');
};

export const resolveCacheDir = (cacheRoot, mode) => path.join(cacheRoot, mode, 'files');

export const buildCacheKey = ({ file, hash, signature, identityKey }) => {
  if (!hash) return null;
  return sha1(`${file}:${hash}:${signature}:${identityKey}`);
};

export const isCacheValid = ({ cached, signature, identityKey }) => {
  if (!cached || cached.chunkSignature !== signature) return false;
  return cached.cacheMeta?.identityKey === identityKey;
};
