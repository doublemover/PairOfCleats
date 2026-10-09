import { normalizeEmbeddingProvider, normalizeOnnxConfig } from './onnx-embeddings.js';
import {
  normalizeAdapterPrewarmTexts,
  pruneCache,
  touchEntry
} from './embedding-adapter-helpers.js';
import { createEmbeddingProviderAdapter } from './embedding-provider-adapters.js';
import {
  normalizeEmbeddingGemma2Output,
  resolveEmbeddingModelProfile,
  validateEmbeddingModelProfile
} from './embedding-model-profile.js';

const PIPELINE_CACHE_TTL_MS = 10 * 60 * 1000;
const PIPELINE_CACHE_MAX_ENTRIES = 16;
const ADAPTER_CACHE_TTL_MS = 15 * 60 * 1000;
const ADAPTER_CACHE_MAX_ENTRIES = 64;

let transformersModuleLoader = () => import('@huggingface/transformers');
let transformersModulePromise = null;
const pipelineCache = new Map();
const adapterCache = new Map();
let adapterFactory = null;

const resetEmbeddingAdapterCachesInternal = () => {
  transformersModulePromise = null;
  pipelineCache.clear();
  adapterCache.clear();
  adapterFactory = createAdapter;
};

export const __resetEmbeddingAdapterCachesForTests = () => {
  resetEmbeddingAdapterCachesInternal();
};

export const __setTransformersModuleLoaderForTests = (loader) => {
  transformersModuleLoader = typeof loader === 'function'
    ? loader
    : (() => import('@huggingface/transformers'));
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

async function loadPipeline(modelId, modelsDir, modelProfile = null, localFilesOnly = false) {
  const cacheKey = JSON.stringify([modelId || '', modelsDir || '', modelProfile, localFilesOnly]);
  const now = Date.now();
  pruneCache(pipelineCache, { maxEntries: PIPELINE_CACHE_MAX_ENTRIES, now });
  const cached = pipelineCache.get(cacheKey);
  if (cached) {
    touchEntry(cached, PIPELINE_CACHE_TTL_MS, now);
    return cached.promise;
  }
  const entry = {
    promise: loadTransformersModule(modelsDir)
      // v2 selected model_quantized.onnx by default. Keep the same weights and
      // cache identity after the Transformers.js migration (Node defaults to fp32).
      .then(async (mod) => {
        if (!modelProfile) return mod.pipeline('feature-extraction', modelId, { dtype: 'q8', ...(localFilesOnly ? { local_files_only: true } : {}), ...(modelsDir ? { cache_dir: modelsDir } : {}) });
        const { AutoConfig, AutoTokenizer, AutoModel } = mod;
        if (!mod.EmbeddingGemma2Model || !AutoConfig || !AutoTokenizer || !AutoModel) {
          throw new Error('EmbeddingGemma 2 requires the qualified Transformers.js 4.3.1 dependency.');
        }
        if (`transformers.js@${mod.env?.version}` !== modelProfile.runtime) {
          throw new Error('EmbeddingGemma 2 runtime differs from its qualified cache identity. Rebuild with the pinned dependency.');
        }
        const options = { ...(localFilesOnly ? { local_files_only: true } : {}), revision: modelProfile.revision, ...(modelsDir ? { cache_dir: modelsDir } : {}) };
        const config = await AutoConfig.from_pretrained(modelId, options);
        if (config.model_type !== 'embedding_gemma2') {
          throw new Error('EmbeddingGemma 2 model configuration has an unexpected model_type.');
        }
        // Only the text encoder is required for code search. Do not load media encoders.
        config.vision_config = null;
        config.audio_config = null;
        const tokenizer = await AutoTokenizer.from_pretrained(modelId, options);
        const model = await AutoModel.from_pretrained(modelId, {
          ...options, config, device: 'cpu', dtype: modelProfile.dtype
        });
        return async (texts) => {
          const inputs = await tokenizer(texts, {
            padding: true, truncation: true, max_length: modelProfile.maxLength
          });
          return normalizeEmbeddingGemma2Output(await model(inputs), texts.length, modelProfile.dimensions);
        };
      })
      .catch((err) => {
        if (pipelineCache.get(cacheKey) === entry) pipelineCache.delete(cacheKey);
        throw err;
      }),
    lastAccessAt: now,
    expiresAt: now + PIPELINE_CACHE_TTL_MS
  };
  pipelineCache.set(cacheKey, entry);
  pruneCache(pipelineCache, { maxEntries: PIPELINE_CACHE_MAX_ENTRIES, now });
  return entry.promise;
}

const createAdapter = (options) => createEmbeddingProviderAdapter({
  ...options,
  loadPipeline,
  normalizeEmbeddingProvider
});

adapterFactory = createAdapter;

export const __setAdapterFactoryForTests = (factory) => {
  resetEmbeddingAdapterCachesInternal();
  adapterFactory = typeof factory === 'function' ? factory : createAdapter;
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
  const modelProfile = resolveEmbeddingModelProfile(options?.modelId, options?.modelProfile);
  validateEmbeddingModelProfile(modelProfile, { provider: resolvedProvider, normalize });
  const cacheKey = JSON.stringify({
    provider: resolvedProvider,
    modelId: options?.modelId || null,
    modelsDir: options?.modelsDir || null,
    onnxConfig: normalizedOnnxConfig,
    rootDir: options?.rootDir || null,
    useStub: options?.useStub === true,
    dims: options?.dims ?? null,
    normalize,
    modelProfile,
    localFilesOnly: options?.localFilesOnly === true
  });
  const now = Date.now();
  pruneCache(adapterCache, { maxEntries: ADAPTER_CACHE_MAX_ENTRIES, now });
  const cached = adapterCache.get(cacheKey);
  if (cached) {
    touchEntry(cached, ADAPTER_CACHE_TTL_MS, now);
    return cached.adapter;
  }
  const adapter = adapterFactory({
    rootDir: options?.rootDir,
    useStub: options?.useStub === true,
    modelId: options?.modelId,
    dims: options?.dims,
    modelsDir: options?.modelsDir,
    provider: resolvedProvider,
    onnxConfig: normalizedOnnxConfig,
    normalize,
    modelProfile,
    localFilesOnly: options?.localFilesOnly === true
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
  const skipPreload = options?.preloadModel === false;
  try {
    if (!skipPreload) {
      const preloadPromise = adapter?.embedderPromise;
      if (preloadPromise && typeof preloadPromise.then === 'function') {
        await preloadPromise;
      }
    }
    const shouldPrewarmTokenizer = options?.prewarmTokenizer === true;
    const shouldPrewarmModel = options?.prewarmModel === true;
    if ((shouldPrewarmTokenizer || shouldPrewarmModel) && typeof adapter?.prewarm === 'function') {
      await adapter.prewarm({
        tokenizer: shouldPrewarmTokenizer,
        model: shouldPrewarmModel,
        texts: normalizeAdapterPrewarmTexts(options?.prewarmTexts)
      });
    }
  } catch {}
  return adapter;
};
