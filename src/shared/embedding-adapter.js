import { embeddingArtifactReusable, resolveEmbeddingArtifactIdentity } from './embedding-artifact-identity.js';
import { resolveEmbeddingArtifactIdentityAsync } from './embedding-artifact-lease.js';
import { createDeferredEmbeddingAdapter } from './embedding-deferred-adapter.js';
import { createPreparedTextEncoder, normalizeEg2SessionOptions, normalizeEg2ModelFileName } from './embedding-prepared.js';
import { normalizeEmbeddingProvider, normalizeOnnxConfig } from './onnx-embeddings.js';
import {
  normalizeAdapterPrewarmTexts,
  pruneCache,
  touchEntry
} from './embedding-adapter-helpers.js';
import { createEmbeddingProviderAdapter } from './embedding-provider-adapters.js';
import { loadEmbeddingModelComponents } from './embedding-model-loading.js';
import { isAbortError } from './abort.js';
import { createEmbeddingCacheLifetime, observeEmbeddingOwnership, preserveEmbeddingCleanupFailure } from './embedding-cache-lifetime.js';
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
const pipelineLifetime = createEmbeddingCacheLifetime({ cache: pipelineCache, kind: 'embedding-pipeline-cache-entry' });
const adapterLifetime = createEmbeddingCacheLifetime({ cache: adapterCache, kind: 'embedding-adapter-cache-entry' });
let adapterFactory = null;

const retirePipelineEntry = entry => {
  const work = pipelineLifetime.retire(entry); work.catch(() => {}); return work;
};
const pipelineLeaseOwners = new FinalizationRegistry(reference => {
  pipelineLifetime.releaseReference(reference).catch(() => {});
});
const acquirePipeline = async (entry) => {
  entry.references++;
  const operations = new Set(), methods = new Map(), token = {};
  const reference = pipelineLifetime.createReference(entry, operations);
  let pipeline;
  try { pipeline = await entry.promise; }
  catch (error) {
    try { await pipelineLifetime.releaseReference(reference); }
    catch (cleanup) { throw preserveEmbeddingCleanupFailure(error, cleanup); }
    throw error;
  }
  let disposed = false, disposing = null;
  const run = (fn, args) => {
    if (disposed || reference.released) return Promise.reject(new Error('Embedding pipeline lease is disposed.'));
    const work = Promise.resolve().then(() => fn.apply(pipeline, args));
    operations.add(work);
    work.then(() => operations.delete(work), error => {
      operations.delete(work); pipelineLifetime.recordFailure(entry, error);
    });
    return work;
  };
  const dispose = () => {
    if (!disposing) {
      disposed = true; pipelineLeaseOwners.unregister(token);
      disposing = pipelineLifetime.releaseReference(reference, { retry: reference.released });
      disposing = disposing.catch(error => { disposing = null; throw error; });
    }
    return disposing;
  };
  const lease = new Proxy(pipeline, {
    apply(target, thisArg, args) { return run(target, args); },
    get(target, key) {
      if (key === 'dispose') return dispose;
      let value;
      try { value = Reflect.get(target, key, target); }
      catch (error) { pipelineLifetime.recordFailure(entry, error); throw error; }
      if (typeof value !== 'function') return value;
      // executionInfo is a synchronous observation; task methods own async work.
      if (key === 'executionInfo') return (...args) => {
        try { return value.apply(target, args); }
        catch (error) { pipelineLifetime.recordFailure(entry, error); throw error; }
      };
      if (!methods.has(key)) methods.set(key, (...args) => run(value, args));
      return methods.get(key);
    }
  });
  pipelineLeaseOwners.register(lease, reference, token);
  return lease;
};

const retireAdapterEntry = entry => {
  const work = adapterLifetime.retire(entry); work.catch(() => {}); return work;
};
const retainAdapterEntry = (entry, now) => {
  entry.cacheOwned = true;
  touchEntry(entry, ADAPTER_CACHE_TTL_MS, now);
  clearTimeout(entry.retentionTimer);
  entry.retentionTimer = setTimeout(() => { void retireAdapterEntry(entry); }, ADAPTER_CACHE_TTL_MS);
  entry.retentionTimer.unref?.();
};
const adapterLeaseOwners = new FinalizationRegistry(reference => {
  adapterLifetime.releaseReference(reference).catch(() => {});
});
const LEASE_OPERATIONS = new Set(['embed', 'embedOne', 'prepare', 'embedPrepared', 'prewarm', 'estimateTokensBatch', 'endProfiling']);
const leaseAdapter = (entry) => {
  entry.references += 1;
  const token = {}, methods = new Map(), operations = new Set();
  const reference = adapterLifetime.createReference(entry, operations);
  let disposed = false, disposing = null;
  const dispose = () => {
    if (!disposing) {
      disposed = true;
      adapterLeaseOwners.unregister(token);
      disposing = adapterLifetime.releaseReference(reference, { retry: reference.released });
      disposing = disposing.catch(error => { disposing = null; throw error; });
    }
    return disposing;
  };
  const track = work => {
    operations.add(work);
    work.then(() => operations.delete(work), error => {
      operations.delete(work); adapterLifetime.recordFailure(entry, error);
      const admissionRejected = isAbortError(error)
        || ['ERR_EMBEDDING_QUEUE_FULL', 'ERR_EMBEDDING_QUEUE_CLOSED'].includes(error?.code);
      if (entry.cacheOwned && !admissionRejected) retireAdapterEntry(entry).catch(() => {});
    });
    return work;
  };
  const lease = new Proxy(entry.adapter, {
    get(target, key) {
      if (key === 'dispose') return dispose;
      if (key === 'embedderPromise' && (disposed || reference.released)) {
        return Promise.reject(new Error('Embedding adapter lease is disposed.'));
      }
      let value;
      try { value = Reflect.get(target, key, target); }
      catch (error) {
        adapterLifetime.recordFailure(entry, error);
        if (entry.cacheOwned) retireAdapterEntry(entry).catch(() => {});
        throw error;
      }
      if (key === 'embedderPromise' && value && typeof value.then === 'function') {
        return track(Promise.resolve(value));
      }
      if (typeof value !== 'function') return value;
      if (!LEASE_OPERATIONS.has(key)) return (...args) => {
        try { return value.apply(target, args); }
        catch (error) {
          adapterLifetime.recordFailure(entry, error);
          if (entry.cacheOwned) retireAdapterEntry(entry).catch(() => {});
          throw error;
        }
      };
      if (!methods.has(key)) methods.set(key, (...args) => {
        if (disposed || reference.released) return Promise.reject(new Error('Embedding adapter lease is disposed.'));
        return track(Promise.resolve().then(() => value.apply(target, args)));
      });
      return methods.get(key);
    }
  });
  adapterLeaseOwners.register(lease, reference, token);
  return lease;
};

/** Release cache ownership, joining native disposal after outstanding leases drain. */
export const disposeEmbeddingAdapterCaches = () => {
  const retirements = [...adapterLifetime.retireAll(), ...pipelineLifetime.retireAll()];
  return Promise.allSettled(retirements).then(results => {
    const errors = results.filter(result => result.status === 'rejected').map(result => result.reason);
    if (errors.length) throw errors.slice(1).reduce(preserveEmbeddingCleanupFailure, errors[0]);
  });
};

/** Scoped existing-owner capabilities; reconciliation never loads a model. */
export const getRetiredEmbeddingCacheOwners = () => Object.freeze([
  ...adapterLifetime.retiredOwners(), ...pipelineLifetime.retiredOwners()
]);

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
  const entry = pipelineLifetime.adopt({
    key: cacheKey, references: 0, releasing: null,
    lastAccessAt: now,
    expiresAt: now + PIPELINE_CACHE_TTL_MS
  });
  entry.promise = loadTransformersModule(modelsDir)
      // v2 selected model_quantized.onnx by default. Keep the same weights and
      // cache identity after the Transformers.js migration (Node defaults to fp32).
      .then(async (mod) => {
        const components = await loadEmbeddingModelComponents(mod, {
          modelId, modelsDir, modelProfile, localFilesOnly, sessionOptions, modelFileName
        });
        if (components.pipeline) return pipelineLifetime.loaded(entry, components.pipeline);
        const { tokenizer, model } = components;
        try {
          return pipelineLifetime.loaded(entry, createPreparedTextEncoder({ tokenizer, model, Tensor: mod.Tensor, profile: modelProfile,
            sessionOptions, modelFileName, resourceOwner: components.resourceOwner }));
        } catch (error) {
          components.resourceOwner.retainFailure(error);
          try { await components.resourceOwner.close(); }
          catch (cleanup) { throw preserveEmbeddingCleanupFailure(error, cleanup); }
          throw error;
        }
      })
      .catch(err => { throw pipelineLifetime.failed(entry, err); });
  pipelineCache.set(cacheKey, entry);
  const lease = acquirePipeline(entry);
  pruneCache(pipelineCache, { maxEntries: PIPELINE_CACHE_MAX_ENTRIES, now, onEvict: retirePipelineEntry });
  return lease;
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
function getVerifiedEmbeddingAdapter(options) {
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
  const entry = adapterLifetime.adopt({ key: cacheKey, adapter, references: 0,
    lastAccessAt: now, expiresAt: now + ADAPTER_CACHE_TTL_MS });
  try { adapterLifetime.loaded(entry, adapter); }
  catch (error) {
    entry.promise = Promise.reject(adapterLifetime.failed(entry, error)); entry.promise.catch(() => {});
    entry.releaseError = adapterLifetime.retainFailure(entry, error);
    throw entry.releaseError;
  }
  entry.promise = Promise.resolve(adapter);
  adapterCache.set(cacheKey, entry);
  if (retainInCache) retainAdapterEntry(entry, now);
  const lease = leaseAdapter(entry);
  pruneCache(adapterCache, { maxEntries: ADAPTER_CACHE_MAX_ENTRIES, now, onEvict: retireAdapterEntry });
  return lease;
}

export function getEmbeddingAdapter(options = {}) {
  if (options.modelArtifact) return getVerifiedEmbeddingAdapter(options);
  const provider = normalizeEmbeddingProvider(options.provider, { strict: true });
  const modelProfile = resolveEmbeddingModelProfile(options.modelId, options.modelProfile);
  const sessionOptions = normalizeEg2SessionOptions(options.sessionOptions), modelFileName = normalizeEg2ModelFileName(options.modelFileName);
  if (modelFileName && !modelProfile) throw new Error('modelFileName requires the qualified EG2 profile.');
  validateEmbeddingModelProfile(modelProfile, { provider, normalize: options.normalize !== false });
  const verification = { provider, modelId: options.modelId, modelsDir: options.modelsDir,
    rootDir: options.rootDir, onnx: normalizeOnnxConfig(options.onnxConfig), modelProfile, stub: options.useStub === true };
  if (verification.stub || modelProfile?.revision) return getVerifiedEmbeddingAdapter({ ...options, modelArtifact: resolveEmbeddingArtifactIdentity(verification) });
  return createDeferredEmbeddingAdapter({ provider, methods: [...LEASE_OPERATIONS],
    acquire: async () => getVerifiedEmbeddingAdapter({ ...options, sessionOptions, modelFileName, modelProfile, modelArtifact: await resolveEmbeddingArtifactIdentityAsync(verification) }) });
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
  } catch (error) {
    let failure = error;
    try { await adapter.dispose?.(); }
    catch (cleanupError) { failure = preserveEmbeddingCleanupFailure(error, cleanupError); }
    const observe = observeEmbeddingOwnership(failure);
    if (options.throwOnError === true || (observe && !observe())) throw failure;
    return null;
  }
  return adapter;
};
