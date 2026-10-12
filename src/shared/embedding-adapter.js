import { embeddingArtifactReusable, resolveEmbeddingArtifactIdentity } from './embedding-artifact-identity.js';
import { createPreparedTextEncoder, normalizeEg2SessionOptions, normalizeEg2ModelFileName } from './embedding-prepared.js';
import { normalizeEmbeddingProvider, normalizeOnnxConfig } from './onnx-embeddings.js';
import {
  normalizeAdapterPrewarmTexts,
  pruneCache,
  touchEntry
} from './embedding-adapter-helpers.js';
import { createEmbeddingProviderAdapter } from './embedding-provider-adapters.js';
import {
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
const retiringAdapters = new Set();
let adapterFactory = null;

const retirePipelineEntry = (entry) => {
  if (!entry || entry.references || entry.releasing) return entry?.releasing;
  if (pipelineCache.get(entry.key) === entry) pipelineCache.delete(entry.key);
  entry.releasing = entry.promise.then(pipeline => pipeline.dispose?.());
  entry.releasing.catch(() => {});
  return entry.releasing;
};
const acquirePipeline = async (entry) => {
  entry.references++;
  let pipeline;
  try { pipeline = await entry.promise; }
  catch (error) { entry.references--; throw error; }
  let disposed = false, disposing = null;
  const operations = new Set(), methods = new Map();
  const run = (fn, args) => {
    if (disposed) return Promise.reject(new Error('Embedding pipeline lease is disposed.'));
    const work = Promise.resolve().then(() => fn.apply(pipeline, args));
    operations.add(work);
    work.then(() => operations.delete(work), () => operations.delete(work));
    return work;
  };
  const dispose = () => {
    if (!disposing) {
      disposed = true;
      disposing = Promise.allSettled([...operations]).then(() => {
        entry.references--;
        return entry.references ? undefined : retirePipelineEntry(entry);
      });
    }
    return disposing;
  };
  return new Proxy(pipeline, {
    apply(target, thisArg, args) { return run(target, args); },
    get(target, key) {
      if (key === 'dispose') return dispose;
      const value = Reflect.get(target, key, target);
      if (typeof value !== 'function') return value;
      // executionInfo is a synchronous observation; task methods own async work.
      if (key === 'executionInfo') return value.bind(target);
      if (!methods.has(key)) methods.set(key, (...args) => run(value, args));
      return methods.get(key);
    }
  });
};

const retireAdapterEntry = (entry) => {
  if (!entry) return;
  entry.cacheOwned = false;
  clearTimeout(entry.retentionTimer);
  if (adapterCache.get(entry.key) === entry) adapterCache.delete(entry.key);
  if (!entry.retirement) {
    entry.retirement = new Promise((resolve, reject) => {
      entry.resolveRetirement = resolve; entry.rejectRetirement = reject;
    });
    retiringAdapters.add(entry.retirement);
    entry.retirement.then(() => retiringAdapters.delete(entry.retirement),
      () => retiringAdapters.delete(entry.retirement));
  }
  if (!entry.references && !entry.releasing) {
    entry.releasing = Promise.resolve().then(() => entry.adapter.dispose?.());
    entry.releasing.then(entry.resolveRetirement, entry.rejectRetirement);
  }
  return entry.retirement;
};
const retainAdapterEntry = (entry, now) => {
  entry.cacheOwned = true;
  touchEntry(entry, ADAPTER_CACHE_TTL_MS, now);
  clearTimeout(entry.retentionTimer);
  entry.retentionTimer = setTimeout(() => { void retireAdapterEntry(entry); }, ADAPTER_CACHE_TTL_MS);
  entry.retentionTimer.unref?.();
};
const releaseAdapterEntry = (entry) => {
  entry.references = Math.max(0, entry.references - 1);
  return entry.references || entry.cacheOwned ? Promise.resolve() : retireAdapterEntry(entry);
};
const adapterLeaseOwners = new FinalizationRegistry(entry => { void releaseAdapterEntry(entry); });
const LEASE_OPERATIONS = new Set(['embed', 'embedOne', 'prepare', 'embedPrepared', 'prewarm', 'estimateTokensBatch', 'endProfiling']);
const leaseAdapter = (entry) => {
  entry.references += 1;
  const token = {}, methods = new Map(), operations = new Set();
  let disposed = false, disposing = null;
  const dispose = () => {
    if (!disposing) {
      disposed = true;
      adapterLeaseOwners.unregister(token);
      disposing = Promise.allSettled([...operations]).then(() => releaseAdapterEntry(entry));
    }
    return disposing;
  };
  const lease = new Proxy(entry.adapter, {
    get(target, key) {
      if (key === 'dispose') return dispose;
      const value = Reflect.get(target, key, target);
      if (typeof value !== 'function') return value;
      if (!LEASE_OPERATIONS.has(key)) return value.bind(target);
      if (!methods.has(key)) methods.set(key, (...args) => {
        if (disposed) return Promise.reject(new Error('Embedding adapter lease is disposed.'));
        const work = Promise.resolve().then(() => value.apply(target, args));
        operations.add(work);
        work.then(() => operations.delete(work), () => {
          operations.delete(work);
          if (entry.cacheOwned) void retireAdapterEntry(entry);
        });
        return work;
      });
      return methods.get(key);
    }
  });
  adapterLeaseOwners.register(lease, entry, token);
  return lease;
};

/** Release cache ownership, joining native disposal after outstanding leases drain. */
export const disposeEmbeddingAdapterCaches = () => {
  for (const entry of [...adapterCache.values()]) retireAdapterEntry(entry);
  for (const entry of pipelineCache.values()) retirePipelineEntry(entry);
  pipelineCache.clear();
  return Promise.all([...retiringAdapters]);
};

const resetEmbeddingAdapterCachesInternal = () => {
  transformersModulePromise = null;
  const disposing = disposeEmbeddingAdapterCaches();
  disposing.catch(() => {});
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

async function loadPipeline(modelId, modelsDir, modelProfile = null, localFilesOnly = false, sessionOptions = {}, modelFileName = null, modelArtifact = null) {
  const cacheKey = JSON.stringify([modelId || '', modelsDir || '', modelProfile, localFilesOnly, sessionOptions, modelFileName, modelArtifact]);
  const now = Date.now();
  pruneCache(pipelineCache, { maxEntries: PIPELINE_CACHE_MAX_ENTRIES, now, onEvict: retirePipelineEntry });
  const cached = pipelineCache.get(cacheKey);
  if (cached) {
    touchEntry(cached, PIPELINE_CACHE_TTL_MS, now);
    return acquirePipeline(cached);
  }
  const entry = {
    key: cacheKey, references: 0, releasing: null,
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
          ...options, config, device: 'cpu', dtype: modelProfile.dtype, session_options: sessionOptions,
          ...(modelFileName ? { model_file_name: modelFileName } : {})
        });
        return createPreparedTextEncoder({ tokenizer, model, Tensor: mod.Tensor, profile: modelProfile, sessionOptions, modelFileName });
      })
      .catch((err) => {
        if (pipelineCache.get(cacheKey) === entry) pipelineCache.delete(cacheKey);
        throw err;
      }),
    lastAccessAt: now,
    expiresAt: now + PIPELINE_CACHE_TTL_MS
  };
  pipelineCache.set(cacheKey, entry);
  pruneCache(pipelineCache, { maxEntries: PIPELINE_CACHE_MAX_ENTRIES, now, onEvict: retirePipelineEntry });
  return acquirePipeline(entry);
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
 * @param {boolean} [options.retainInCache] Keep a bounded cache owner after query leases return.
 * @returns {object}
 */
export function getEmbeddingAdapter(options) {
  const resolvedProvider = normalizeEmbeddingProvider(options?.provider, { strict: true });
  const normalizedOnnxConfig = normalizeOnnxConfig(options?.onnxConfig);
  const normalize = options?.normalize !== false;
  const sessionOptions = normalizeEg2SessionOptions(options?.sessionOptions);
  const modelFileName = normalizeEg2ModelFileName(options?.modelFileName);
  const modelProfile = resolveEmbeddingModelProfile(options?.modelId, options?.modelProfile);
  if (modelFileName && !modelProfile) throw new Error('modelFileName requires the qualified EG2 profile.');
  validateEmbeddingModelProfile(modelProfile, { provider: resolvedProvider, normalize });
  const modelArtifact = options?.modelArtifact || resolveEmbeddingArtifactIdentity({
    provider: resolvedProvider, modelId: options?.modelId, modelsDir: options?.modelsDir,
    rootDir: options?.rootDir, onnx: normalizedOnnxConfig, modelProfile, stub: options?.useStub === true
  });
  const retainInCache = options?.retainInCache === true && embeddingArtifactReusable(modelArtifact);
  const cacheKey = JSON.stringify({
    modelArtifact,
    provider: resolvedProvider,
    modelId: options?.modelId || null,
    modelsDir: options?.modelsDir || null,
    onnxConfig: normalizedOnnxConfig,
    rootDir: options?.rootDir || null,
    useStub: options?.useStub === true,
    dims: options?.dims ?? null,
    normalize,
    modelProfile,
    sessionOptions,
    modelFileName,
    localFilesOnly: options?.localFilesOnly === true
  });
  const now = Date.now();
  pruneCache(adapterCache, { maxEntries: ADAPTER_CACHE_MAX_ENTRIES, now, onEvict: retireAdapterEntry });
  const cached = adapterCache.get(cacheKey);
  if (cached) {
    touchEntry(cached, ADAPTER_CACHE_TTL_MS, now);
    if (retainInCache || cached.cacheOwned) retainAdapterEntry(cached, now);
    return leaseAdapter(cached);
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
    modelArtifact,
    sessionOptions,
    modelFileName,
    localFilesOnly: options?.localFilesOnly === true
  });
  const entry = { key: cacheKey, adapter, references: 0, releasing: null,
    lastAccessAt: now, expiresAt: now + ADAPTER_CACHE_TTL_MS };
  adapterCache.set(cacheKey, entry);
  if (retainInCache) retainAdapterEntry(entry, now);
  pruneCache(adapterCache, { maxEntries: ADAPTER_CACHE_MAX_ENTRIES, now, onEvict: retireAdapterEntry });
  return leaseAdapter(entry);
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
