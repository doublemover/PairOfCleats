import os from 'node:os';
import path from 'node:path';
import { createCli } from '../../../src/shared/cli.js';
import { resolveAutoEmbeddingBatchSize } from '../../../src/shared/embedding-batch.js';
import { getEnvConfig } from '../../../src/shared/env.js';
import { normalizeEmbeddingProvider, normalizeOnnxConfig } from '../../../src/shared/onnx-embeddings.js';
import { normalizeHnswConfig } from '../../../src/shared/hnsw.js';
import { getModelConfig, getRepoCacheRoot, loadUserConfig, resolveIndexRoot, resolveRepoRootArg } from '../../shared/dict-utils.js';
import { loadEmbeddingsAutoTuneRecommendation } from './autotune-profile.js';

export const parseBuildEmbeddingsArgs = (rawArgs = process.argv.slice(2)) => {
  const resolvedRawArgs = Array.isArray(rawArgs) ? rawArgs : [];
  const argv = createCli({
    scriptName: 'build-embeddings',
    argv: ['node', 'tools/build/embeddings.js', ...resolvedRawArgs],
    options: {
      mode: { type: 'string', default: 'all' },
      repo: { type: 'string' },
      dims: { type: 'number' },
      batch: { type: 'number' },
      'stub-embeddings': { type: 'boolean', default: false },
      'index-root': { type: 'string' },
      progress: { type: 'string', default: 'auto' },
      verbose: { type: 'boolean', default: false },
      quiet: { type: 'boolean', default: false }
    }
  }).parse();

  const root = resolveRepoRootArg(argv.repo);
  const userConfig = loadUserConfig(root);
  const envConfig = getEnvConfig();
  const indexingConfig = userConfig.indexing || {};
  const embeddingsConfig = indexingConfig.embeddings || {};
  const embeddingProvider = normalizeEmbeddingProvider(embeddingsConfig.provider, { strict: true });
  const embeddingOnnx = normalizeOnnxConfig(embeddingsConfig.onnx || {});
  const hnswConfig = normalizeHnswConfig(embeddingsConfig.hnsw || {});
  const modelConfig = getModelConfig(root, userConfig);
  const modelId = modelConfig.id;
  const repoCacheRoot = getRepoCacheRoot(root, userConfig);
  const autoTune = loadEmbeddingsAutoTuneRecommendation({
    repoCacheRoot,
    provider: embeddingProvider,
    modelId,
    log: null
  });

  const embeddingModeRaw = typeof embeddingsConfig.mode === 'string'
    ? embeddingsConfig.mode.trim().toLowerCase()
    : 'auto';
  const baseStubEmbeddings = argv['stub-embeddings'] === true
    || envConfig.embeddings === 'stub';
  const normalizedEmbeddingMode = ['auto', 'inline', 'service', 'stub', 'off'].includes(embeddingModeRaw)
    ? embeddingModeRaw
    : 'auto';
  // build-embeddings runs inline; service mode from config is coerced here.
  const resolvedEmbeddingMode = normalizedEmbeddingMode === 'auto'
    ? (baseStubEmbeddings ? 'stub' : 'inline')
    : (normalizedEmbeddingMode === 'service'
      ? (baseStubEmbeddings ? 'stub' : 'inline')
      : normalizedEmbeddingMode);

  const useStubEmbeddings = resolvedEmbeddingMode === 'stub' || baseStubEmbeddings;

  const embeddingBatchRaw = Number(argv.batch ?? indexingConfig.embeddingBatchSize ?? autoTune?.recommended?.batchSize);
  let embeddingBatchSize = Number.isFinite(embeddingBatchRaw)
    ? Math.max(0, Math.floor(embeddingBatchRaw))
    : 0;
  if (!embeddingBatchSize) {
    const cpuCount = typeof os.availableParallelism === 'function'
      ? os.availableParallelism()
      : os.cpus().length;
    embeddingBatchSize = resolveAutoEmbeddingBatchSize(os.totalmem(), {
      provider: useStubEmbeddings ? 'stub' : embeddingProvider,
      cpuCount
    });
  }
  const maxBatchTokensRaw = Number(
    embeddingsConfig.maxBatchTokens ?? autoTune?.recommended?.maxBatchTokens
  );
  const embeddingBatchTokenBudget = Number.isFinite(maxBatchTokensRaw) && maxBatchTokensRaw > 0
    ? Math.max(1, Math.floor(maxBatchTokensRaw))
    : Math.max(embeddingBatchSize, embeddingBatchSize * 256);
  const explicitFileParallelism = Number(embeddingsConfig.fileParallelism);
  const recommendedFileParallelism = Number(autoTune?.recommended?.fileParallelism);
  if (
    (!Number.isFinite(explicitFileParallelism) || explicitFileParallelism <= 0)
    && Number.isFinite(recommendedFileParallelism)
    && recommendedFileParallelism > 0
  ) {
    indexingConfig.embeddings = {
      ...(indexingConfig.embeddings || {}),
      fileParallelism: Math.max(1, Math.floor(recommendedFileParallelism))
    };
  }
  const configuredDims = Number.isFinite(Number(argv.dims))
    ? Math.max(1, Math.floor(Number(argv.dims)))
    : null;

  const cliIndexRoot = argv['index-root'] ?? argv.indexRoot;
  const indexRoot = cliIndexRoot
    ? path.resolve(cliIndexRoot)
    : resolveIndexRoot(root, userConfig);

  const embedModeRaw = (argv.mode || 'all').toLowerCase();
  const embedMode = embedModeRaw === 'both' ? 'all' : embedModeRaw;
  const modes = embedMode === 'all'
    ? ['code', 'prose', 'extracted-prose', 'records']
    : [embedMode];

  return {
    rawArgv: resolvedRawArgs,
    argv,
    root,
    userConfig,
    envConfig,
    indexingConfig,
    embeddingsConfig,
    embeddingProvider,
    embeddingOnnx,
    hnswConfig,
    normalizedEmbeddingMode,
    resolvedEmbeddingMode,
    useStubEmbeddings,
    embeddingBatchSize,
    embeddingBatchTokenBudget,
    configuredDims,
    modelConfig,
    modelId,
    modelsDir: modelConfig.dir || null,
    indexRoot,
    modes
  };
};
