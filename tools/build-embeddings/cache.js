import path from 'node:path';
import { sha1 } from '../../src/shared/hash.js';

// Keep in sync with src/index/embedding.js defaults.
const DEFAULT_POOLING = 'mean';
const DEFAULT_NORMALIZE = true;
const DEFAULT_TRUNCATION = true;
const DEFAULT_QUANT_MIN = -1;
const DEFAULT_QUANT_MAX = 1;
const DEFAULT_QUANT_LEVELS = 256;

export const buildCacheIdentity = ({
  modelId,
  provider,
  mode,
  stub,
  dims,
  scale,
  onnx,
  preprocess,
  quantization
} = {}) => {
  const providerValue = provider || null;
  const resolvedPreprocess = preprocess && typeof preprocess === 'object' ? preprocess : {};
  const resolvedQuant = quantization && typeof quantization === 'object' ? quantization : {};
  const resolvedOnnx = onnx && typeof onnx === 'object' ? onnx : null;

  const identity = {
    // Bump to invalidate caches when embedding semantics change.
    version: 2,
    modelId: modelId || null,
    provider: providerValue,
    mode: mode || null,
    stub: stub === true,
    dims: dims ?? null,
    scale,
    preprocess: {
      pooling: resolvedPreprocess.pooling ?? DEFAULT_POOLING,
      normalize: resolvedPreprocess.normalize ?? DEFAULT_NORMALIZE,
      truncation: resolvedPreprocess.truncation ?? DEFAULT_TRUNCATION,
      // Reserved for future use (explicit max_length / tokenizer policy).
      maxLength: resolvedPreprocess.maxLength ?? null
    },
    quantization: {
      // Allows future changes (e.g., asymmetric / per-channel / float16) to invalidate caches.
      version: resolvedQuant.version ?? 1,
      minVal: resolvedQuant.minVal ?? DEFAULT_QUANT_MIN,
      maxVal: resolvedQuant.maxVal ?? DEFAULT_QUANT_MAX,
      levels: resolvedQuant.levels ?? DEFAULT_QUANT_LEVELS
    },
    onnx: providerValue === 'onnx' && resolvedOnnx ? {
      modelPath: resolvedOnnx.modelPath ?? null,
      tokenizerId: resolvedOnnx.tokenizerId ?? null,
      executionProviders: resolvedOnnx.executionProviders ?? null,
      intraOpNumThreads: resolvedOnnx.intraOpNumThreads ?? null,
      interOpNumThreads: resolvedOnnx.interOpNumThreads ?? null,
      graphOptimizationLevel: resolvedOnnx.graphOptimizationLevel ?? null
    } : null
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
