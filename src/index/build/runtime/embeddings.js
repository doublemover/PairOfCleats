import fs from 'node:fs/promises';
import { DEFAULT_MODEL_ID, getModelConfig } from '../../../shared/dict-utils.js';
import { createEmbedder } from '../../embedding.js';
import { resolveAutoEmbeddingBatchSize } from '../../../shared/embedding-batch.js';
import { buildEmbeddingIdentity, buildEmbeddingIdentityKey } from '../../../shared/embedding-identity.js';
import { resolveStubDims } from '../../../shared/embedding.js';
import { normalizeEmbeddingProvider, normalizeOnnxConfig, resolveOnnxModelPath } from '../../../shared/onnx-embeddings.js';
import { resolveQuantizationParams } from '../../../storage/sqlite/vector.js';

export const resolveEmbeddingRuntime = async ({
  rootDir,
  userConfig,
  indexingConfig,
  envConfig,
  argv,
  cpuConcurrency
}) => {
  const embeddingsConfig = indexingConfig.embeddings || {};
  const embeddingBatchRaw = Number(indexingConfig.embeddingBatchSize);
  let embeddingBatchSize = Number.isFinite(embeddingBatchRaw)
    ? Math.max(0, Math.floor(embeddingBatchRaw))
    : 0;
  if (!embeddingBatchSize) {
    embeddingBatchSize = resolveAutoEmbeddingBatchSize();
  }
  const embeddingProvider = normalizeEmbeddingProvider(embeddingsConfig.provider, { strict: true });
  const embeddingOnnx = normalizeOnnxConfig(embeddingsConfig.onnx || {});
  const quantization = resolveQuantizationParams(embeddingsConfig.quantization);
  const embeddingNormalize = embeddingsConfig.normalize !== false;
  const embeddingQueueConfig = embeddingsConfig.queue || {};
  const embeddingCacheConfig = embeddingsConfig.cache || {};
  const embeddingModeRaw = typeof embeddingsConfig.mode === 'string'
    ? embeddingsConfig.mode.trim().toLowerCase()
    : 'auto';
  const embeddingQueueDir = typeof embeddingQueueConfig.dir === 'string'
    ? embeddingQueueConfig.dir.trim()
    : '';
  const embeddingQueueMaxRaw = Number(embeddingQueueConfig.maxQueued);
  const embeddingQueueMaxQueued = Number.isFinite(embeddingQueueMaxRaw)
    ? Math.max(0, Math.floor(embeddingQueueMaxRaw))
    : 10;
  const embeddingCacheDir = typeof embeddingCacheConfig.dir === 'string'
    ? embeddingCacheConfig.dir.trim()
    : '';
  const embeddingConcurrencyRaw = Number(embeddingsConfig.concurrency);
  let embeddingConcurrency = Number.isFinite(embeddingConcurrencyRaw) && embeddingConcurrencyRaw > 0
    ? Math.floor(embeddingConcurrencyRaw)
    : 0;
  if (!embeddingConcurrency) {
    const defaultEmbedding = process.platform === 'win32'
      ? cpuConcurrency
      : Math.min(4, cpuConcurrency);
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
  const baseStubEmbeddings = argv['stub-embeddings'] === true
    || envConfig.embeddings === 'stub';
  const envEmbeddingMode = typeof envConfig.embeddings === 'string'
    ? envConfig.embeddings.trim().toLowerCase()
    : '';
  const envForcesOff = ['off', 'false', '0', 'disabled', 'none'].includes(envEmbeddingMode);
  const envForcesStub = envEmbeddingMode === 'stub';
  const normalizedEmbeddingMode = ['auto', 'inline', 'service', 'stub', 'off'].includes(embeddingModeRaw)
    ? embeddingModeRaw
    : 'auto';
  const resolvedEmbeddingMode = envForcesOff
    ? 'off'
    : (envForcesStub
      ? 'stub'
      : (normalizedEmbeddingMode === 'auto'
        ? (baseStubEmbeddings ? 'stub' : 'inline')
        : normalizedEmbeddingMode));
  const embeddingService = embeddingsConfig.enabled !== false
    && resolvedEmbeddingMode === 'service';
  const embeddingEnabled = embeddingsConfig.enabled !== false
    && resolvedEmbeddingMode !== 'off'
    && !embeddingService;
  const useStubEmbeddings = resolvedEmbeddingMode === 'stub' || baseStubEmbeddings;
  const modelConfig = getModelConfig(rootDir, userConfig);
  const modelId = argv.model || modelConfig.id || DEFAULT_MODEL_ID;
  const modelsDir = modelConfig.dir;
  if (modelsDir) {
    try {
      await fs.mkdir(modelsDir, { recursive: true });
    } catch {}
  }

  let getChunkEmbedding = async () => [];
  let getChunkEmbeddings = async () => [];
  if (embeddingEnabled) {
    let embedder = null;
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
          normalize: embeddingNormalize
        });
      }
      return embedder;
    };
    getChunkEmbedding = async (text) => ensureEmbedder().getChunkEmbedding(text);
    getChunkEmbeddings = async (texts) => ensureEmbedder().getChunkEmbeddings(texts);
  }

  const resolvedOnnxModelPath = embeddingProvider === 'onnx'
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
  const embeddingIdentity = buildEmbeddingIdentity({
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
  const embeddingIdentityKey = buildEmbeddingIdentityKey(embeddingIdentity);

  return {
    embeddingBatchSize,
    embeddingConcurrency,
    embeddingEnabled,
    embeddingMode: resolvedEmbeddingMode,
    embeddingService,
    embeddingProvider,
    embeddingOnnx,
    embeddingNormalize,
    embeddingQueue: {
      dir: embeddingQueueDir || null,
      maxQueued: embeddingQueueMaxQueued
    },
    embeddingIdentity,
    embeddingIdentityKey,
    embeddingCache: {
      dir: embeddingCacheDir || null
    },
    useStubEmbeddings,
    modelConfig,
    modelId,
    modelsDir,
    getChunkEmbedding,
    getChunkEmbeddings
  };
};
