import { embeddingArtifactReusable } from '../../../shared/embedding-artifact-identity.js';
import { resolveEmbeddingArtifactIdentityAsync } from '../../../shared/embedding-artifact-lease.js';
import fs from 'node:fs/promises';
import { resolveEmbeddingIntent } from '../../../shared/embedding-intent.js';
import { DEFAULT_MODEL_ID, getModelConfig } from '../../../shared/dict-utils.js';
import { createEmbedder } from '../../embedding.js';
import { resolveAutoEmbeddingBatchSize, resolveEmbeddingsBatchTokenBudget } from '../../../shared/embedding-batch.js';
import { closeInlineEmbeddingBatcher } from '../../../shared/embedding-inline-batcher.js';
import { buildEmbeddingIdentity, buildEmbeddingIdentityKey } from '../../../shared/embedding-identity.js';
import { resolveEmbeddingInputFormatting } from '../../../shared/embedding-input-format.js';
import { resolveStubDims } from '../../../shared/embedding.js';
import { resolveEmbeddingModelProfile, validateEmbeddingModelProfile } from '../../../shared/embedding-model-profile.js';
import { normalizeEmbeddingProvider, resolveOnnxConfig, resolveOnnxModelPath } from '../../../shared/onnx-embeddings.js';
import { resolveEmbeddingQuantizationSpec } from '../../../shared/embedding-quantization-spec.js';
import { addStorageFailureContext, readStorageFailureContext } from '../../../shared/storage/operation-error.js';
import { captureRuntimeFailureObservation, composeRuntimeTeardownFailures } from './failure.js';

const runtimeClosed = () => Object.assign(new Error('Inline embedding runtime is closed.'), { code: 'ERR_EMBEDDING_RUNTIME_CLOSED' });

/**
 * Resolve embedding runtime configuration and lazy embedding adapters.
 *
 * This function applies CLI/env/config precedence, computes effective batch and
 * concurrency limits, derives identity metadata, and returns lazy embedding
 * callables so the model is only initialized when embeddings are requested.
 *
 * @param {{
 *   rootDir:string,
 *   userConfig:object,
 *   indexingConfig:object,
 *   envConfig:object,
 *   argv:object,
 *   cpuConcurrency:number
 * }} input
 * @returns {Promise<object>}
 */
export const resolveEmbeddingRuntime = async ({
  rootDir,
  userConfig,
  indexingConfig,
  envConfig,
  argv,
  cpuConcurrency,
  rawEnv = process.env,
  memorySnapshot = null,
  onEmbeddingObservation = async () => {}
}) => {
  const embeddingsConfig = indexingConfig.embeddings || {};
  const embeddingBatchRaw = Number(indexingConfig.embeddingBatchSize);
  let embeddingBatchSize = Number.isFinite(embeddingBatchRaw)
    ? Math.max(0, Math.floor(embeddingBatchRaw))
    : 0;
  if (!embeddingBatchSize) {
    embeddingBatchSize = resolveAutoEmbeddingBatchSize(memorySnapshot?.totalBytes);
  }
  const embeddingProvider = normalizeEmbeddingProvider(embeddingsConfig.provider, { strict: true });
  const embeddingOnnx = resolveOnnxConfig(embeddingsConfig.onnx || {}, rawEnv);
  const quantization = resolveEmbeddingQuantizationSpec(embeddingsConfig.quantization);
  const embeddingNormalize = embeddingsConfig.normalize !== false;
  const embeddingQueueConfig = embeddingsConfig.queue || {};
  const embeddingCacheConfig = embeddingsConfig.cache || {};
  const embeddingQueueDir = typeof embeddingQueueConfig.dir === 'string'
    ? embeddingQueueConfig.dir.trim()
    : '';
  const embeddingQueueMaxRaw = Number(embeddingQueueConfig.maxQueued);
  const embeddingQueueMaxQueued = Number.isFinite(embeddingQueueMaxRaw)
    ? Math.max(0, Math.floor(embeddingQueueMaxRaw))
    : 32;
  const embeddingCacheDir = typeof embeddingCacheConfig.dir === 'string'
    ? embeddingCacheConfig.dir.trim()
    : '';
  const embeddingConcurrencyRaw = Number(embeddingsConfig.concurrency);
  let embeddingConcurrency = Number.isFinite(embeddingConcurrencyRaw) && embeddingConcurrencyRaw > 0
    ? Math.floor(embeddingConcurrencyRaw)
    : 0;
  if (!embeddingConcurrency) {
    const defaultEmbedding = cpuConcurrency;
    embeddingConcurrency = Math.max(1, defaultEmbedding);
  }
  embeddingConcurrency = Math.max(1, Math.min(embeddingConcurrency, cpuConcurrency));
  if (embeddingProvider === 'onnx') {
    const onnxThreads = Math.max(
      1,
      Number(embeddingOnnx.intraOpNumThreads) || 0,
      Number(embeddingOnnx.interOpNumThreads) || 0
    );
    const maxConcurrency = Math.max(1, Math.floor(cpuConcurrency / onnxThreads));
    if (embeddingConcurrency > maxConcurrency) {
      embeddingConcurrency = maxConcurrency;
    }
  }
  const intent = resolveEmbeddingIntent({ argv, embeddingsConfig, envConfig });
  const { resolvedEmbeddingMode, embeddingService, useStubEmbeddings } = intent;
  const embeddingEnabled = intent.embeddingEnabled && !embeddingService;
  if (!embeddingEnabled) embeddingConcurrency = 0;
  const modelConfig = getModelConfig(rootDir, userConfig);
  const modelId = argv.model || modelConfig.id || DEFAULT_MODEL_ID;
  const modelProfile = resolveEmbeddingModelProfile(modelId, embeddingsConfig.embeddinggemma2);
  if (embeddingEnabled) {
    validateEmbeddingModelProfile(modelProfile, { provider: embeddingProvider, normalize: embeddingNormalize });
  }
  const embeddingInputFormatting = resolveEmbeddingInputFormatting(modelId);
  const modelsDir = modelConfig.dir;
  if (modelsDir && embeddingEnabled) {
    try {
      await fs.mkdir(modelsDir, { recursive: true });
    } catch {}
  }

  const modelArtifact = embeddingEnabled ? await resolveEmbeddingArtifactIdentityAsync({
    provider: embeddingProvider, modelId, modelsDir, rootDir, onnx: embeddingOnnx, modelProfile, stub: useStubEmbeddings
  }) : null;
  if (embeddingEnabled && !embeddingArtifactReusable(modelArtifact)) {
    throw Object.assign(new Error('Inline embeddings require verified model artifacts before cache/signature selection. Download/verify the selected model, then retry the build.'), {
      code: 'ERR_EMBEDDING_ARTIFACT_UNVERIFIED'
    });
  }
  let observation = { state: 'not-started', provider: null, dims: null, device: null, dtype: null, observedAt: null, method: null };
  let embeddingIdentity = null;
  let embeddingIdentityKey = null;
  const failureObservations = new WeakMap(), pendingFailures = new Map();
  let failureOverflow = null;
  const settled = captured => captured.observe() && readStorageFailureContext(captured.context)?.complete === true;
  const rememberFailure = (error, gatesDispose = true) => {
    const objectLike = error !== null && (typeof error === 'object' || typeof error === 'function');
    let captured = objectLike && failureObservations.get(error);
    if (!captured) {
      captured = captureRuntimeFailureObservation(error);
      if (objectLike) failureObservations.set(error, captured);
    }
    const existing = pendingFailures.get(error);
    if (existing && gatesDispose) existing.gatesDispose = true;
    if (!settled(captured) && !existing) {
      if (pendingFailures.size < 128) pendingFailures.set(error, { captured, gatesDispose });
      else failureOverflow ||= captureRuntimeFailureObservation(Object.assign(new Error(
        'Inline embedding unresolved failure inventory exceeded its bounded allowance.', { cause: error }),
      { code: 'ERR_EMBEDDING_RUNTIME_FAILURE_INVENTORY', cacheOwnershipPending: true, cacheOwnershipReleased: () => false }));
    }
    return captured;
  };
  const retainedFailures = ({ beforeDispose = false } = {}) => {
    for (const [error, { captured }] of pendingFailures) if (settled(captured)) pendingFailures.delete(error);
    return [...pendingFailures.values()].filter(({ captured, gatesDispose }) => {
      if (!beforeDispose || gatesDispose) return true;
      const context = readStorageFailureContext(captured.context);
      return !context?.complete || context.inspectionObservations.some(item => !item.observe());
    }).map(item => item.captured).concat(failureOverflow ? [failureOverflow] : []);
  };
  let observationWrite = Promise.resolve();
  const publishObservation = (next) => {
    const write = observationWrite.then(async () => {
      if (next.state === observation.state && next.provider === observation.provider && next.dims === observation.dims) return;
      const candidate = { ...observation, ...next, observedAt: new Date().toISOString() };
      let identity = embeddingIdentity;
      if (candidate.state === 'ready' && Number.isFinite(candidate.dims)) {
        if ((identity?.dims != null && identity.dims !== candidate.dims)
          || (observation.state === 'ready' && observation.dims !== candidate.dims)) {
          throw Object.assign(new Error(`Embedding dimensions mismatch: expected ${identity.dims}, observed ${candidate.dims}.`), { code: 'ERR_EMBEDDING_DIMS_MISMATCH' });
        }
        // Inline signatures/cache keys have already selected their identity.
        // A previously undeclared dimension is observed evidence only.
      }
      if (candidate.provider && identity?.provider !== candidate.provider) {
        identity = { ...identity, provider: candidate.provider, onnx: candidate.provider === 'onnx' ? identity.onnx : null };
      }
      const identityKey = identity ? buildEmbeddingIdentityKey(identity) : null;
      await onEmbeddingObservation({ observation: candidate, resolvedIdentity: identity, identityKey });
      observation = candidate;
      embeddingIdentity = identity;
      embeddingIdentityKey = identityKey;
    });
    // The queue may continue after a rejected notification, but its original
    // independent resource observation survives through runtime close.
    observationWrite = write.catch(error => { rememberFailure(error); });
    return write;
  };
  let closed = false;
  let getChunkEmbedding = async () => { if (closed) throw runtimeClosed(); return []; };
  let getChunkEmbeddings = async () => { if (closed) throw runtimeClosed(); return []; };
  let embedder = null;
  let closing = null;
  let batcherClosed = false;
  let workDrained = false;
  let observationsDrained = false;
  let embedderDisposed = false;
  let disposeEmbedder = null;
  let completelyClosed = false;
  const operations = new Set();
  const trackOperation = work => {
    const tracked = Promise.resolve(work).catch(error => {
      throw composeRuntimeTeardownFailures([rememberFailure(error)]);
    });
    operations.add(tracked);
    tracked.then(() => operations.delete(tracked), () => operations.delete(tracked));
    return tracked;
  };
  const closeEmbeddingRuntime = () => {
    if (!closing) {
      closed = true;
      closing = (async () => {
        const failures = [];
        const closeStep = async (done, action, confirm, gatesDispose = true) => {
          if (done) return;
          try { await action(); confirm(); }
          catch (error) { failures.push(rememberFailure(error, gatesDispose)); }
        };
        await closeStep(batcherClosed, () => closeInlineEmbeddingBatcher(getChunkEmbeddings), () => { batcherClosed = true; });
        // A batcher failure cannot skip the runtime's original inference work.
        await closeStep(workDrained, () => Promise.allSettled([...operations]), () => { workDrained = true; });
        await closeStep(observationsDrained, () => observationWrite, () => { observationsDrained = true; });
        // Rejected work may already have left operations. Its captured native
        // or diagnostic child still prevents releasing the parent lease.
        if (!retainedFailures({ beforeDispose: true }).length) await closeStep(embedderDisposed, async () => {
          if (!disposeEmbedder && embedder) {
            const owner = embedder, dispose = owner.dispose;
            if (typeof dispose !== 'function') throw new TypeError('Inline embedder has no disposal control.');
            disposeEmbedder = () => dispose.call(owner);
          }
          if (await disposeEmbedder?.() === false) throw Object.assign(new Error('Inline embedding disposal was explicitly unconfirmed.'),
            { code: 'ERR_EMBEDDING_RUNTIME_DISPOSAL_UNCONFIRMED' });
        }, () => { embedderDisposed = true; }, false);
        for (const captured of retainedFailures()) if (!failures.includes(captured)) failures.push(captured);
        if (failures.length) throw composeRuntimeTeardownFailures(failures);
        completelyClosed = true;
      })().catch(error => {
        // Only a subsequent explicit close retries failed steps. Admissions stay
        // closed, confirmed steps stay complete, and the original lease survives.
        closing = null;
        throw addStorageFailureContext(error, { cacheOwnershipPending: true,
          cacheOwnershipReleased: () => completelyClosed, closeEmbeddingRuntime }, null,
        { forceAggregate: true, nonEnumerable: ['closeEmbeddingRuntime'] });
      });
    }
    return closing;
  };
  if (embeddingEnabled) {
    const ensureEmbedder = () => {
      if (!embedder) {
        embedder = createEmbedder({
          rootDir,
          useStubEmbeddings,
          modelId,
          dims: argv.dims,
          modelsDir,
          provider: embeddingProvider,
          onnx: embeddingOnnx,
          normalize: embeddingNormalize,
          modelProfile,
          modelArtifact
        });
      }
      return embedder;
    };
    const execute = async (input, batch) => {
      if (batch && (!Array.isArray(input) || input.length === 0)) return [];
      if (!embedder) await publishObservation({ state: 'loading', method: 'provider-request-started' });
      try {
        const active = ensureEmbedder();
        const result = await (batch ? active.getChunkEmbeddings(input) : active.getChunkEmbedding(input));
        const actualProvider = active.getActiveProvider();
        if (actualProvider !== embeddingProvider) {
          await publishObservation({ state: 'failed', provider: actualProvider, requestedProvider: embeddingProvider,
            method: 'provider-changed-after-identity-selection', errorCode: 'ERR_EMBEDDING_PROVIDER_CHANGED' });
          throw Object.assign(new Error(`Embedding provider changed from ${embeddingProvider} to ${actualProvider} after cache/signature selection. Retry with indexing.embeddings.provider=${actualProvider}; this attempt cannot publish mixed identity.`), { code: 'ERR_EMBEDDING_PROVIDER_CHANGED' });
        }
        const vectors = batch ? result : [result];
        const vector = vectors[0];
        if (!Array.isArray(vectors) || (batch && vectors.length !== input.length) || !vector?.length || vectors.some((item) => !item?.length || item.length !== vector.length)) {
          throw Object.assign(new Error('Embedding batch did not return consistent nonempty vectors.'), { code: 'ERR_EMBEDDING_DIMS_MISMATCH' });
        }
        {
          const info = active.executionInfo?.() || {};
          await publishObservation({
            state: 'ready', provider: active.getActiveProvider(), dims: vector.length,
            method: useStubEmbeddings ? 'stub-vector-returned' : 'successful-inference',
            device: info.device ?? null, dtype: info.dtype ?? null,
            modelRevision: info.modelRevision ?? null, modelArtifact: info.modelArtifact ?? null,
            sessionOptions: info.effectiveSessionOptions ?? null,
            requestedSessionOptions: info.requestedSessionOptions ?? null,
            effectiveNativeThreads: info.effectiveNativeThreads ?? null
          });
        }
        return result;
      } catch (error) {
        const primary = rememberFailure(error);
        try {
          const code = primary.context.code;
          await publishObservation({ state: 'failed', method: 'provider-request-failed', errorCode: typeof code === 'string' ? code : 'UNKNOWN' });
        } catch (notificationError) {
          throw composeRuntimeTeardownFailures([primary, rememberFailure(notificationError)]);
        }
        throw composeRuntimeTeardownFailures([primary]);
      }
    };
    const admit = (input, batch) => {
      if (closed) return Promise.reject(runtimeClosed());
      return trackOperation(execute(input, batch));
    };
    getChunkEmbedding = (text) => admit(text, false);
    getChunkEmbeddings = (texts) => admit(texts, true);
    getChunkEmbeddings.batchTokenBudget = resolveEmbeddingsBatchTokenBudget({ indexingConfig, embeddingBatchSize });
    getChunkEmbeddings.estimateTokensBatch = texts => {
      if (closed) return Promise.reject(runtimeClosed());
      return trackOperation(Promise.resolve().then(() => ensureEmbedder().getChunkEmbeddings.estimateTokensBatch(texts)));
    };
  }

  const resolvedOnnxModelPath = embeddingEnabled && embeddingProvider === 'onnx'
    ? resolveOnnxModelPath({
      rootDir,
      modelPath: embeddingOnnx.modelPath,
      modelsDir,
      modelId
    })
    : null;
  const denseScale = quantization.scale;
  embeddingIdentity = buildEmbeddingIdentity({
    modelProfile,
    modelArtifact,
    modelId,
    provider: embeddingProvider,
    mode: resolvedEmbeddingMode,
    stub: useStubEmbeddings,
    dims: useStubEmbeddings ? resolveStubDims(argv.dims) : (Number.isFinite(Number(argv.dims)) ? Math.floor(Number(argv.dims)) : null),
    scale: denseScale,
    pooling: 'mean',
    normalize: embeddingNormalize,
    truncation: 'truncate',
    maxLength: null,
    inputFormatting: embeddingInputFormatting,
    quantization: {
      version: quantization.version,
      minVal: quantization.minVal,
      maxVal: quantization.maxVal,
      levels: quantization.levels
    },
    onnx: embeddingProvider === 'onnx' ? {
      ...embeddingOnnx,
      resolvedModelPath: resolvedOnnxModelPath
    } : null
  });
  if (!embeddingEnabled) embeddingIdentity.modelArtifact = null;
  embeddingIdentityKey = buildEmbeddingIdentityKey(embeddingIdentity);

  return {
    embeddingBatchSize,
    embeddingConcurrency,
    embeddingEnabled,
    embeddingMode: resolvedEmbeddingMode,
    embeddingService,
    embeddingProvider,
    embeddingOnnx,
    embeddingNormalize,
    embeddingQuantization: quantization,
    embeddingInputFormatting,
    embeddingQueue: {
      dir: embeddingQueueDir || null,
      maxQueued: embeddingQueueMaxQueued
    },
    get embeddingIdentity() { return embeddingIdentity; },
    get embeddingIdentityKey() { return embeddingIdentityKey; },
    getEmbeddingObservation: () => ({ ...observation }),
    embeddingCache: {
      dir: embeddingCacheDir || null
    },
    useStubEmbeddings,
    modelConfig,
    modelId,
    modelsDir,
    getChunkEmbedding,
    getChunkEmbeddings,
    closeEmbeddingRuntime
  };
};
