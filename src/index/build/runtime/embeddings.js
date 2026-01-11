import fs from 'node:fs/promises';
import os from 'node:os';
import { DEFAULT_MODEL_ID, getModelConfig } from '../../../../tools/dict-utils.js';
import { createEmbedder } from '../../embedding.js';
import { normalizeEmbeddingProvider, normalizeOnnxConfig } from '../../../shared/onnx-embeddings.js';

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
    const totalGb = os.totalmem() / (1024 ** 3);
    const autoBatch = Math.floor(totalGb * 16);
    embeddingBatchSize = Math.min(128, Math.max(16, autoBatch));
  }
  const embeddingProvider = normalizeEmbeddingProvider(embeddingsConfig.provider);
  const embeddingOnnx = normalizeOnnxConfig(embeddingsConfig.onnx || {});
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
    : null;
  const embeddingCacheDir = typeof embeddingCacheConfig.dir === 'string'
    ? embeddingCacheConfig.dir.trim()
    : '';
  const embeddingConcurrencyRaw = Number(embeddingsConfig.concurrency);
  let embeddingConcurrency = Number.isFinite(embeddingConcurrencyRaw) && embeddingConcurrencyRaw > 0
    ? Math.floor(embeddingConcurrencyRaw)
    : 0;
  if (!embeddingConcurrency) {
    const defaultEmbedding = process.platform === 'win32'
      ? Math.min(2, cpuConcurrency)
      : Math.min(4, cpuConcurrency);
    embeddingConcurrency = Math.max(1, defaultEmbedding);
  }
  embeddingConcurrency = Math.max(1, Math.min(embeddingConcurrency, cpuConcurrency));
  const baseStubEmbeddings = argv['stub-embeddings'] === true
    || envConfig.embeddings === 'stub';
  const normalizedEmbeddingMode = ['auto', 'inline', 'service', 'stub', 'off'].includes(embeddingModeRaw)
    ? embeddingModeRaw
    : 'auto';
  const resolvedEmbeddingMode = normalizedEmbeddingMode === 'auto'
    ? (baseStubEmbeddings ? 'stub' : 'inline')
    : normalizedEmbeddingMode;
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
    const embedder = createEmbedder({
      rootDir,
      useStubEmbeddings,
      modelId,
      dims: argv.dims,
      modelsDir,
      provider: embeddingProvider,
      onnx: embeddingOnnx
    });
    getChunkEmbedding = embedder.getChunkEmbedding;
    getChunkEmbeddings = embedder.getChunkEmbeddings;
  }

  return {
    embeddingBatchSize,
    embeddingConcurrency,
    embeddingEnabled,
    embeddingMode: resolvedEmbeddingMode,
    embeddingService,
    embeddingProvider,
    embeddingOnnx,
    embeddingQueue: {
      dir: embeddingQueueDir || null,
      maxQueued: embeddingQueueMaxQueued
    },
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
