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
import { resolveQuantizationParams } from '../../../storage/sqlite/quantization.js';

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
  const quantization = resolveQuantizationParams(embeddingsConfig.quantization);
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
    observationWrite = write.catch(() => {});
    return write;
  };
  let getChunkEmbedding = async () => [];
  let getChunkEmbeddings = async () => [];
  let embedder = null;
  let closed = false;
  let closing = null;
  const operations = new Set();
  const closeEmbeddingRuntime = () => {
    if (!closing) {
      closed = true;
      closing = (async () => {
        await closeInlineEmbeddingBatcher(getChunkEmbeddings);
        await Promise.allSettled([...operations]);
        await observationWrite;
        await embedder?.dispose?.();
      })();
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
        await publishObservation({ state: 'failed', method: 'provider-request-failed', errorCode: String(error?.code || 'UNKNOWN') });
        throw error;
      }
    };
    const admit = (input, batch) => {
      if (closed) return Promise.reject(Object.assign(new Error('Inline embedding runtime is closed.'), { code: 'ERR_EMBEDDING_RUNTIME_CLOSED' }));
      const work = execute(input, batch);
      operations.add(work);
      work.then(() => operations.delete(work), () => operations.delete(work));
      return work;
    };
    getChunkEmbedding = (text) => admit(text, false);
    getChunkEmbeddings = (texts) => admit(texts, true);
    getChunkEmbeddings.batchTokenBudget = resolveEmbeddingsBatchTokenBudget({ indexingConfig, embeddingBatchSize });
    getChunkEmbeddings.estimateTokensBatch = texts => {
      if (closed) return Promise.reject(Object.assign(new Error('Inline embedding runtime is closed.'), { code: 'ERR_EMBEDDING_RUNTIME_CLOSED' }));
      const work = Promise.resolve().then(() => ensureEmbedder().getChunkEmbeddings.estimateTokensBatch(texts));
      operations.add(work);
      work.then(() => operations.delete(work), () => operations.delete(work));
      return work;
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
  const quantRange = quantization.maxVal - quantization.minVal;
  const quantLevels = Number.isFinite(quantization.levels) ? quantization.levels : 256;
  const denseScale = quantLevels > 1 && Number.isFinite(quantRange) && quantRange !== 0
    ? quantRange / (quantLevels - 1)
    : 2 / 255;
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
      version: 1,
      minVal: quantization.minVal,
      maxVal: quantization.maxVal,
      levels: quantization.levels
    },
    onnx: embeddingProvider === 'onnx' ? {
      ...embeddingOnnx,
      resolvedModelPath: resolvedOnnxModelPath
    } : null
  });
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
