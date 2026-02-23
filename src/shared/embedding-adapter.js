import { resolveStubDims, stubEmbedding } from './embedding.js';
import { createOnnxEmbedder, normalizeEmbeddingProvider, normalizeOnnxConfig } from './onnx-embeddings.js';
import {
  DEFAULT_EMBEDDING_POOLING,
  normalizeEmbeddingBatchOutput
} from './embedding-utils.js';

const PIPELINE_CACHE_TTL_MS = 10 * 60 * 1000;
const PIPELINE_CACHE_MAX_ENTRIES = 16;
const ADAPTER_CACHE_TTL_MS = 15 * 60 * 1000;
const ADAPTER_CACHE_MAX_ENTRIES = 64;

let transformersModuleLoader = () => import('@xenova/transformers');
let transformersModulePromise = null;
const pipelineCache = new Map();
const adapterCache = new Map();

const isDlopenFailure = (err) => {
  const code = err?.code || err?.cause?.code;
  if (code === 'ERR_DLOPEN_FAILED') return true;
  const message = err?.message || '';
  return message.includes('ERR_DLOPEN_FAILED');
};

const touchEntry = (entry, ttlMs, now = Date.now()) => {
  if (!entry || typeof entry !== 'object') return;
  entry.lastAccessAt = now;
  entry.expiresAt = now + ttlMs;
};

const pruneCache = (cache, { maxEntries, now = Date.now() } = {}) => {
  for (const [key, entry] of cache.entries()) {
    if (!entry || typeof entry !== 'object') {
      cache.delete(key);
      continue;
    }
    if (entry.expiresAt && entry.expiresAt <= now) {
      cache.delete(key);
    }
  }
  if (!Number.isFinite(Number(maxEntries)) || cache.size <= maxEntries) return;
  const overflow = cache.size - maxEntries;
  const oldest = Array.from(cache.entries())
    .sort((a, b) => (a[1]?.lastAccessAt || 0) - (b[1]?.lastAccessAt || 0))
    .slice(0, overflow);
  for (const [key] of oldest) {
    cache.delete(key);
  }
};

const resetEmbeddingAdapterCachesInternal = () => {
  transformersModulePromise = null;
  pipelineCache.clear();
  adapterCache.clear();
};

export const __resetEmbeddingAdapterCachesForTests = () => {
  resetEmbeddingAdapterCachesInternal();
};

export const __setTransformersModuleLoaderForTests = (loader) => {
  transformersModuleLoader = typeof loader === 'function'
    ? loader
    : (() => import('@xenova/transformers'));
  resetEmbeddingAdapterCachesInternal();
};

/**
 * Load transformers module singleton and apply optional model cache directory.
 *
 * @param {string|null} modelsDir
 * @returns {Promise<object>}
 */
async function loadTransformersModule(modelsDir) {
  if (!transformersModulePromise) {
    transformersModulePromise = transformersModuleLoader().catch((err) => {
      transformersModulePromise = null;
      throw err;
    });
  }
  const mod = await transformersModulePromise;
  if (modelsDir && mod?.env) {
    mod.env.cacheDir = modelsDir;
  }
  return mod;
}

async function loadPipeline(modelId, modelsDir) {
  const cacheKey = `${modelId || ''}:${modelsDir || ''}`;
  const now = Date.now();
  pruneCache(pipelineCache, { maxEntries: PIPELINE_CACHE_MAX_ENTRIES, now });
  const cached = pipelineCache.get(cacheKey);
  if (cached) {
    touchEntry(cached, PIPELINE_CACHE_TTL_MS, now);
    return cached.promise;
  }
  const entry = {
    promise: loadTransformersModule(modelsDir)
      .then(({ pipeline }) => pipeline('feature-extraction', modelId))
      .catch((err) => {
        pipelineCache.delete(cacheKey);
        throw err;
      }),
    lastAccessAt: now,
    expiresAt: now + PIPELINE_CACHE_TTL_MS
  };
  pipelineCache.set(cacheKey, entry);
  pruneCache(pipelineCache, { maxEntries: PIPELINE_CACHE_MAX_ENTRIES, now });
  return entry.promise;
}

const createXenovaAdapter = ({ modelId, modelsDir, normalize }) => {
  let embedderPromise = null;
  const ensureEmbedder = () => {
    if (!embedderPromise) {
      embedderPromise = loadPipeline(modelId, modelsDir).catch((err) => {
        embedderPromise = null;
        throw err;
      });
    }
    return embedderPromise;
  };
  const pipelineOptions = {
    pooling: DEFAULT_EMBEDDING_POOLING,
    normalize: normalize !== false
  };
  const embed = async (texts) => {
    const list = Array.isArray(texts) ? texts : [];
    if (!list.length) return [];
    const embedder = await ensureEmbedder();
    const output = await embedder(list, pipelineOptions);
    return normalizeEmbeddingBatchOutput(output, list.length);
  };
  const embedOne = async (text) => {
    const list = await embed([text]);
    return list[0] || new Float32Array(0);
  };
  return {
    embed,
    embedOne,
    get embedderPromise() {
      return ensureEmbedder();
    },
    provider: 'xenova',
    // Xenova inference is stateless per call, so callers may dispatch
    // independent code/doc embedding batches concurrently.
    supportsParallelDispatch: true
  };
};

/**
 * Create provider-specific embedding adapter with optional fallback behavior.
 *
 * @param {object} input
 * @returns {object}
 */
const createAdapter = ({
  rootDir,
  useStub,
  modelId,
  dims,
  modelsDir,
  provider,
  onnxConfig,
  normalize
}) => {
  const resolvedProvider = normalizeEmbeddingProvider(provider, { strict: true });
  if (useStub) {
    const safeDims = resolveStubDims(dims);
    const embed = async (texts) => {
      const list = Array.isArray(texts) ? texts : [];
      if (!list.length) return [];
      return list.map((text) => stubEmbedding(text, safeDims, normalize !== false));
    };
    const embedOne = async (text) => stubEmbedding(text, safeDims, normalize !== false);
    return {
      embed,
      embedOne,
      embedderPromise: null,
      provider: resolvedProvider,
      // Stub adapter has no shared model state and is always concurrency-safe.
      supportsParallelDispatch: true
    };
  }

  if (resolvedProvider === 'onnx') {
    const onnxEmbedder = createOnnxEmbedder({
      rootDir,
      modelId,
      modelsDir,
      onnxConfig,
      normalize
    });
    let fallbackAdapter = null;
    let activeProvider = resolvedProvider;
    let warned = false;
    const ensureFallback = () => {
      if (!fallbackAdapter) {
        fallbackAdapter = createXenovaAdapter({ modelId, modelsDir, normalize });
      }
      activeProvider = 'xenova';
      return fallbackAdapter;
    };
    const warnFallback = (err) => {
      if (warned) return;
      warned = true;
      const code = err?.code || err?.cause?.code || 'ERR_DLOPEN_FAILED';
      console.warn(`[embeddings] onnxruntime-node failed to load (${code}); falling back to xenova.`);
    };
    return {
      embed: async (texts) => {
        try {
          return await onnxEmbedder.getEmbeddings(texts);
        } catch (err) {
          if (isDlopenFailure(err)) {
            warnFallback(err);
            return ensureFallback().embed(texts);
          }
          throw err;
        }
      },
      embedOne: async (text) => {
        try {
          return await onnxEmbedder.getEmbedding(text);
        } catch (err) {
          if (isDlopenFailure(err)) {
            warnFallback(err);
            return ensureFallback().embedOne(text);
          }
          throw err;
        }
      },
      embedderPromise: onnxEmbedder.embedderPromise,
      get provider() {
        return activeProvider;
      },
      // ONNX adapter executes batch calls independently; callers may parallelize
      // code/doc dispatch at the orchestration layer.
      supportsParallelDispatch: true
    };
  }

  return createXenovaAdapter({ modelId, modelsDir, normalize });
};

/**
 * Get cached embedding adapter instance for normalized provider/model config.
 *
 * Caches adapters with TTL+LRU pruning to avoid repeated model/provider
 * initialization during repeated indexing/search sessions.
 *
 * @param {object} options
 * @returns {object}
 */
export function getEmbeddingAdapter(options) {
  const resolvedProvider = normalizeEmbeddingProvider(options?.provider, { strict: true });
  const normalizedOnnxConfig = normalizeOnnxConfig(options?.onnxConfig);
  const normalize = options?.normalize !== false;
  const cacheKey = JSON.stringify({
    provider: resolvedProvider,
    modelId: options?.modelId || null,
    modelsDir: options?.modelsDir || null,
    onnxConfig: normalizedOnnxConfig,
    rootDir: options?.rootDir || null,
    useStub: options?.useStub === true,
    dims: options?.dims ?? null,
    normalize
  });
  const now = Date.now();
  pruneCache(adapterCache, { maxEntries: ADAPTER_CACHE_MAX_ENTRIES, now });
  const cached = adapterCache.get(cacheKey);
  if (cached) {
    touchEntry(cached, ADAPTER_CACHE_TTL_MS, now);
    return cached.adapter;
  }
  const adapter = createAdapter({
    rootDir: options?.rootDir,
    useStub: options?.useStub === true,
    modelId: options?.modelId,
    dims: options?.dims,
    modelsDir: options?.modelsDir,
    provider: resolvedProvider,
    onnxConfig: normalizedOnnxConfig,
    normalize
  });
  adapterCache.set(cacheKey, {
    adapter,
    lastAccessAt: now,
    expiresAt: now + ADAPTER_CACHE_TTL_MS
  });
  pruneCache(adapterCache, { maxEntries: ADAPTER_CACHE_MAX_ENTRIES, now });
  return adapter;
}

/**
 * Resolve and optionally preload cached embedding adapter.
 *
 * @param {object} [options]
 * @returns {Promise<object|null>}
 */
export const warmEmbeddingAdapter = async (options = {}) => {
  const adapter = getEmbeddingAdapter(options);
  if (!adapter) return null;
  if (options?.preloadModel === false) return adapter;
  try {
    const preloadPromise = adapter?.embedderPromise;
    if (preloadPromise && typeof preloadPromise.then === 'function') {
      await preloadPromise;
    }
  } catch {}
  return adapter;
};
