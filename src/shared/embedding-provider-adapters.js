import { assertEmbeddingArtifactCompatibility, embeddingArtifactReusable } from './embedding-artifact-identity.js';
import { resolveEmbeddingArtifactIdentityAsync } from './embedding-artifact-lease.js';
import { resolveStubDims, stubEmbedding } from './embedding.js';
import { createOnnxEmbedder } from './onnx-embeddings.js';
import { getEmbeddingCacheLeaseOwner, getEmbeddingFailureProvenance, observeEmbeddingOwnership,
  preserveEmbeddingCleanupFailure } from './embedding-cache-lifetime.js';
import { captureTransformersResource, createTransformersResourceScope, trackPendingTransformersOwner,
  transformersCleanupFailure, getTransformersFailureProvenance } from './embedding-transformers-resources.js';
import { getPreparedTextEncoderOwner } from './embedding-prepared.js';
import { resolveEmbeddingDenseContract, validateEmbeddingDenseContract } from './embedding-dense-contract.js';
import { snapshotEmbeddingMetadata } from './embedding-selection-snapshot.js';
import {
  DEFAULT_EMBEDDING_POOLING,
  normalizeEmbeddingBatchOutput
} from './embedding-utils.js';
import {
  estimateTokensHeuristic,
  isDlopenFailure,
  normalizeAdapterPrewarmTexts
} from './embedding-adapter-helpers.js';

export const createXenovaAdapter = ({ modelId, modelsDir, dims = null, normalize, loadPipeline, modelProfile, localFilesOnly = false, sessionOptions = {}, modelFileName = null, modelArtifact = null }) => {
  modelArtifact = snapshotEmbeddingMetadata(modelArtifact);
  modelProfile = snapshotEmbeddingMetadata(modelProfile);
  sessionOptions = snapshotEmbeddingMetadata(sessionOptions);
  const denseContract = resolveEmbeddingDenseContract(modelId);
  validateEmbeddingDenseContract(denseContract, { normalize });
  let embedderPromise = null;
  let resolvedEmbedder = null;
  let acquiredEmbedder = null, acquiredOwner = null;
  let startupFailure = null, startupObserver = null, startupFailureReported = false, disposed = false, disposing = null, disposeRequested = false;
  let acceptedDrained = false, stopped = false, lastWorkFailure = null;
  const acceptedWork = new Set(), outputScopes = new Set(), workFailures = new Map();
  let observedArtifact = modelArtifact;
  const measurements = { scope: 'adapter-lifetime', initializationMs: 0, runs: 0,
    providerBusyMs: 0, active: 0, peakActive: 0, failures: 0 };
  let observedDimensions = modelProfile?.dimensions ?? denseContract?.dimensions ?? dims;
  const ensureEmbedder = () => {
    if (disposed) return Promise.reject(new Error('Embedding provider adapter is disposed.'));
    if (!embedderPromise) {
      const startedAt = performance.now();
      embedderPromise = loadPipeline(modelId, modelsDir, modelProfile, localFilesOnly, sessionOptions, modelFileName, modelArtifact).then(async (embedder) => {
        acquiredEmbedder = embedder; startupFailure = null; startupObserver = null; startupFailureReported = false;
        acquiredOwner = captureTransformersResource(embedder, 'Xenova acquired pipeline lease');
        try {
          observedArtifact = await resolveEmbeddingArtifactIdentityAsync({ provider: 'xenova', modelId, modelsDir, modelProfile, modelFileName }, { phase: 'loaded' });
          if (embeddingArtifactReusable(modelArtifact)) assertEmbeddingArtifactCompatibility(modelArtifact, observedArtifact);
        } catch (error) {
          try {
            await acquiredOwner.retire();
          } catch (cleanup) { throw preserveEmbeddingCleanupFailure(error, cleanup); }
          throw error;
        }
        measurements.initializationMs += performance.now() - startedAt;
        resolvedEmbedder = embedder;
        return embedder;
      }).catch((err) => {
        startupFailure = err; startupObserver = observeEmbeddingOwnership(err);
        // An original pending child cannot authorize a fresh pipeline or be
        // erased by the existing ordinary initialization recovery policy.
        if (!startupObserver) embedderPromise = null;
        resolvedEmbedder = null;
        throw err;
      });
    }
    return embedderPromise;
  };
  const independentBlockers = error => {
    const cacheOwner = getEmbeddingCacheLeaseOwner(acquiredEmbedder);
    const encoderOwner = getPreparedTextEncoderOwner(acquiredEmbedder) || getPreparedTextEncoderOwner(cacheOwner?.resource);
    const owns = owner => owner === acquiredOwner || owner === cacheOwner || outputScopes.has(owner)
      || (encoderOwner && (owner === encoderOwner || owner === encoderOwner.components
        || encoderOwner.components.resources.includes(owner) || encoderOwner.pendingTensorScopes.includes(owner)
        || encoderOwner.pendingTensorScopes.some(scope => scope.resources.includes(owner))));
    const pending = [error], seen = new Set(), blockers = [];
    while (pending.length) {
      const value = pending.pop(), observe = observeEmbeddingOwnership(value);
      if (!observe || observe()) continue;
      if (seen.has(value)) continue;
      seen.add(value);
      const provenance = getTransformersFailureProvenance(value) || getEmbeddingFailureProvenance(value);
      // Only original producer records may split a composed receipt. A copied
      // owner field/cause cannot authorize skipping its independent observer.
      if (!provenance || (provenance.owner && !owns(provenance.owner))) {
        blockers.push({ error: value, observe }); continue;
      }
      for (const child of provenance.children) pending.push(child);
    }
    return blockers;
  };
  const retainWorkFailure = error => {
    const observe = observeEmbeddingOwnership(error);
    if (!observe || observe()) return;
    stopped = true; lastWorkFailure = error;
    for (const blocker of independentBlockers(error)) if (!workFailures.has(blocker.error)) workFailures.set(blocker.error, blocker.observe);
    trackPendingTransformersOwner(providerOwner);
  };
  const track = invoke => {
    if (disposed) return Promise.reject(new Error('Embedding provider adapter is disposed.'));
    if (stopped) return Promise.reject(lastWorkFailure);
    const work = Promise.resolve().then(invoke); acceptedWork.add(work);
    work.then(() => acceptedWork.delete(work), error => { acceptedWork.delete(work); retainWorkFailure(error); });
    return work;
  };
  const captureOutput = (scope, output) => {
    const pending = [output], seen = new Set();
    while (pending.length) {
      const value = pending.pop();
      if (!value || (typeof value !== 'object' && typeof value !== 'function') || ArrayBuffer.isView(value) || seen.has(value)) continue;
      seen.add(value);
      if ('dispose' in value) { scope.adopt(value, 'Xenova output tensor'); continue; }
      if (Array.isArray(value)) { for (const entry of value) pending.push(entry); continue; }
      const prototype = Object.getPrototypeOf(value);
      if (prototype === Object.prototype || prototype === null) for (const key of Object.keys(value)) pending.push(value[key]);
    }
  };
  const pipelineOptions = {
    pooling: denseContract?.pooling ?? DEFAULT_EMBEDDING_POOLING,
    normalize: normalize !== false,
    ...(denseContract ? { truncation: true, max_length: denseContract.maxLength } : {})
  };
  const embed = (texts, options = {}) => {
    const list = Array.isArray(texts) ? texts.slice() : [];
    const requested = { ...options };
    return track(async () => {
      if (!list.length) return [];
      const embedder = await ensureEmbedder();
      const startedAt = performance.now();
      measurements.runs++; measurements.active++; measurements.peakActive = Math.max(measurements.peakActive, measurements.active);
      const batchId = measurements.runs;
      const scope = createTransformersResourceScope('Xenova output tensors', { drainFailuresBeforeResources: true });
      outputScopes.add(scope);
      let result, primaryError, hasPrimary = false, cleanupError, cleanupFailed = false;
      try {
        const output = await embedder(list, modelProfile ? requested : pipelineOptions);
        captureOutput(scope, output);
        result = normalizeEmbeddingBatchOutput(output, list.length, { provider: 'xenova',
          batchId, dimensions: observedDimensions, requireNonzero: Boolean(denseContract), copyVectors: scope.resources.length > 0 });
        observedDimensions ??= result[0].length;
      } catch (error) {
        hasPrimary = true; primaryError = error;
        // Delegate only producer-proven owned closure; every unrelated original
        // observer remains a blocker even in a mixed known/unknown aggregate.
        if (scope.resources.length) scope.retainFailure(error);
        else for (const blocker of independentBlockers(error)) scope.retainFailure(blocker.error);
        measurements.failures++;
      }
      finally { measurements.active--; measurements.providerBusyMs += performance.now() - startedAt; }
      try { await scope.close(); } catch (error) { cleanupFailed = true; cleanupError = error; }
      if (!scope.pending) outputScopes.delete(scope);
      if (cleanupFailed) throw hasPrimary ? preserveEmbeddingCleanupFailure(primaryError, cleanupError) : cleanupError;
      if (hasPrimary) throw primaryError;
      return result;
    });
  };
  const embedOne = async (text, options = {}) => {
    const list = await embed([text], options);
    return list[0] || new Float32Array(0);
  };
  const providerOwner = Object.freeze({ kind: 'Xenova provider lifetime',
    get pending() { return !disposeRequested || !acceptedDrained || outputScopes.size > 0 || acquiredOwner?.pending === true
      || [...workFailures.values()].some(observe => !observe()) || Boolean(startupObserver && !startupObserver()); },
    get resource() { return acquiredEmbedder; }, get pipelineOwner() { return acquiredOwner; },
    get pendingOutputScopes() { return Object.freeze([...outputScopes]); }, release: () => adapter.dispose() });
  const adapter = {
    embed,
    embedOne,
    prepare: (texts, options = {}) => {
      const selected = Array.isArray(texts) ? texts.slice() : texts, requested = { ...options };
      return track(async () => {
        const embedder = await ensureEmbedder();
        if (!embedder.prepare) throw new Error('Prepared token inputs require the EG2 adapter.');
        return embedder.prepare(selected, requested);
      });
    },
    embedPrepared: (items, options = {}) => {
      const selected = Array.isArray(items) ? items.slice() : items, requested = { ...options };
      return track(async () => {
        const embedder = await ensureEmbedder();
        if (!embedder.embedPrepared) throw new Error('Prepared token inputs require the EG2 adapter.');
        const output = await embedder.embedPrepared(selected, requested);
        const vectors = normalizeEmbeddingBatchOutput(output, selected.length, { provider: 'xenova',
          dimensions: observedDimensions });
        if (vectors.length) observedDimensions ??= vectors[0].length;
        return vectors;
      });
    },
    executionInfo: () => ({
      provider: 'xenova', requestedProvider: 'xenova', stub: false, measurements: { ...measurements },
      denseEncoding: denseContract ? { ...denseContract } : null,
      loaded: resolvedEmbedder !== null, loading: embedderPromise !== null && resolvedEmbedder === null,
      modelArtifact: observedArtifact, modelRevision: observedArtifact?.revision ?? null, effectiveSessionOptions: null,
      preparedInputs: !!modelProfile, device: null,
      executionProviders: null,
      modelFileName, requestedSessionOptions: structuredClone(sessionOptions),
      effectiveNativeThreads: null, effectiveGraphExecutionMode: null, sessions: [],
      maxLength: modelProfile?.maxLength ?? null, maxConcurrentInference: modelProfile ? 1 : null,
      profilingEnabled: sessionOptions.enableProfiling === true, profilingEnded: false,
      optimizedModelFilePath: sessionOptions.optimizedModelFilePath ?? null,
      ...(resolvedEmbedder?.executionInfo?.() ?? {})
    }),
    endProfiling: () => track(async () => {
      const embedder = await ensureEmbedder();
      return embedder.endProfiling?.() ?? { enabled: false, sessions: [] };
    }),
    dispose: () => {
      if (!disposing) {
        const retry = disposeRequested; disposeRequested = true;
        disposed = true;
        disposing = Promise.resolve().then(async () => {
          await Promise.allSettled([...acceptedWork]); acceptedDrained = true;
          if (embedderPromise) { try { await embedderPromise; } catch {} }
          const errors = [];
          for (const scope of outputScopes) {
            try { await scope.close({ retry }); } catch (error) { errors.push(error); }
            if (!scope.pending) outputScopes.delete(scope);
          }
          for (const [error, observe] of workFailures) if (!observe()) errors.push(error);
          const observe = startupObserver;
          if (observe && !observe() && !startupFailureReported) {
            startupFailureReported = true; errors.push(startupFailure);
          }
          if (errors.length) {
            const unique = [...new Set(errors)];
            if (unique.length === 1 && unique[0] === startupFailure) throw startupFailure;
            throw transformersCleanupFailure(providerOwner, unique);
          }
          if (acquiredEmbedder) { if (retry) await acquiredOwner.release(); else await acquiredOwner.retire(); }
          if (observe && !observe()) throw startupFailure;
          trackPendingTransformersOwner(providerOwner);
        }).catch(error => { disposing = null; trackPendingTransformersOwner(providerOwner); throw error; });
      }
      return disposing;
    },
    estimateTokensBatch: async (texts) => {
      const list = Array.isArray(texts) ? texts : [];
      return list.map((text) => estimateTokensHeuristic(text));
    },
    get embedderPromise() {
      return ensureEmbedder();
    },
    provider: 'xenova',
    supportsParallelDispatch: !modelProfile
  };
  return adapter;
};

export const createEmbeddingProviderAdapter = ({
  rootDir,
  useStub,
  modelId,
  dims,
  modelsDir,
  provider,
  onnxConfig,
  modelProfile,
  modelArtifact = null,
  localFilesOnly = false,
  sessionOptions = {},
  modelFileName = null,
  normalize,
  loadPipeline,
  normalizeEmbeddingProvider
}) => {
  const resolvedProvider = normalizeEmbeddingProvider(provider, { strict: true });
  onnxConfig = snapshotEmbeddingMetadata(onnxConfig);
  if (useStub) {
    const safeDims = resolveStubDims(modelProfile?.dimensions ?? dims);
    const embed = async (texts) => {
      const list = Array.isArray(texts) ? texts : [];
      if (!list.length) return [];
      return list.map((text) => stubEmbedding(text, safeDims, normalize !== false));
    };
    const embedOne = async (text) => stubEmbedding(text, safeDims, normalize !== false);
    return {
      embed,
      embedOne,
      executionInfo: () => ({
        provider: resolvedProvider, requestedProvider: resolvedProvider, stub: true,
        loaded: false, loading: false, device: null, executionProviders: null,
        effectiveNativeThreads: null, effectiveGraphExecutionMode: null,
        modelArtifact: null, effectiveSessionOptions: null
      }),
      estimateTokensBatch: async (texts) => {
        const list = Array.isArray(texts) ? texts : [];
        return list.map((text) => estimateTokensHeuristic(text));
      },
      embedderPromise: null,
      provider: resolvedProvider,
      supportsParallelDispatch: true
    };
  }

  if (resolvedProvider === 'onnx') {
    const onnxEmbedder = createOnnxEmbedder({
      rootDir,
      modelId,
      dims,
      modelsDir,
      onnxConfig,
      modelArtifact,
      normalize
    });
    let fallbackAdapter = null;
    let activeProvider = resolvedProvider;
    let warned = false;
    let fallbackReason = null;
    let loaded = false;
    let loading = !!onnxEmbedder.embedderPromise;
    // The ONNX owner acknowledges only session construction here. Requested
    // providers/threads are not proof of effective native execution settings.
    onnxEmbedder.embedderPromise?.then(() => {
      loaded = true;
      loading = false;
    }, () => {
      loaded = false;
      loading = false;
    });
    const ensureFallback = (err) => {
      if (!fallbackAdapter) {
        fallbackAdapter = createXenovaAdapter({ modelId, modelsDir, dims, normalize, loadPipeline });
        fallbackReason = {
          from: resolvedProvider, to: 'xenova', reason: 'native-load-failed',
          code: err?.code || err?.cause?.code || 'ERR_DLOPEN_FAILED'
        };
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
        if (fallbackAdapter) return fallbackAdapter.embed(texts);
        try {
          return await onnxEmbedder.getEmbeddings(texts);
        } catch (err) {
          const observe = observeEmbeddingOwnership(err);
          if (observe && !observe()) throw err;
          if (isDlopenFailure(err)) {
            warnFallback(err);
            return ensureFallback(err).embed(texts);
          }
          throw err;
        }
      },
      embedOne: async (text) => {
        if (fallbackAdapter) return fallbackAdapter.embedOne(text);
        try {
          return await onnxEmbedder.getEmbedding(text);
        } catch (err) {
          const observe = observeEmbeddingOwnership(err);
          if (observe && !observe()) throw err;
          if (isDlopenFailure(err)) {
            warnFallback(err);
            return ensureFallback(err).embedOne(text);
          }
          throw err;
        }
      },
      estimateTokensBatch: async (texts) => {
        if (fallbackAdapter) return fallbackAdapter.estimateTokensBatch(texts);
        try {
          return await onnxEmbedder.estimateTokens(texts);
        } catch (err) {
          const observe = observeEmbeddingOwnership(err);
          if (observe && !observe()) throw err;
          if (isDlopenFailure(err)) {
            warnFallback(err);
            return ensureFallback(err).estimateTokensBatch(texts);
          }
          throw err;
        }
      },
      prewarm: async ({
        tokenizer = true,
        model = false,
        texts = null
      } = {}) => {
        try {
          await onnxEmbedder.prewarm({ tokenizer, model, texts });
        } catch (err) {
          const observe = observeEmbeddingOwnership(err);
          if (observe && !observe()) throw err;
          if (isDlopenFailure(err)) {
            warnFallback(err);
            const fallback = ensureFallback(err);
            const warmTexts = normalizeAdapterPrewarmTexts(texts);
            const shouldWarmModel = model === true;
            if (shouldWarmModel && warmTexts?.length) {
              await fallback.embed(warmTexts);
            } else {
              const preloadPromise = fallback?.embedderPromise;
              if (preloadPromise && typeof preloadPromise.then === 'function') {
                await preloadPromise;
              }
            }
            return;
          }
          throw err;
        }
      },
      executionInfo: () => ({
        ...(fallbackAdapter?.executionInfo() ?? {
          provider: activeProvider, stub: false, loaded, loading,
          device: null, executionProviders: null,
          effectiveNativeThreads: null, effectiveGraphExecutionMode: null,
          ...onnxEmbedder.executionInfo(), effectiveSessionOptions: onnxEmbedder.executionInfo().effectiveSessionOptions,
          requestedSessionOptions: Object.fromEntries([
            'executionProviders', 'intraOpNumThreads', 'interOpNumThreads', 'graphOptimizationLevel'
          ].filter((key) => onnxConfig?.[key] != null)
            .map((key) => [key, structuredClone(onnxConfig[key])]))
        }),
        requestedProvider: resolvedProvider,
        requestedOnnxConfig: structuredClone(onnxConfig ?? {}),
        fallback: fallbackReason ? { ...fallbackReason } : null
      }),
      dispose: async () => {
        await onnxEmbedder.dispose();
        await fallbackAdapter?.dispose?.();
      },
      embedderPromise: onnxEmbedder.embedderPromise,
      get provider() {
        return activeProvider;
      },
      supportsParallelDispatch: true
    };
  }

  return createXenovaAdapter({ modelId, modelsDir, dims, normalize, loadPipeline, modelProfile, localFilesOnly, sessionOptions, modelFileName, modelArtifact });
};
