import path from 'node:path';
import { createCli } from '../../../src/shared/cli.js';
import { resolveAutoEmbeddingBatchSize } from '../../../src/shared/embedding-batch.js';
import { getEnvConfig } from '../../../src/shared/env.js';
import { normalizeEmbeddingProvider, normalizeOnnxConfig } from '../../../src/shared/onnx-embeddings.js';
import { normalizeHnswConfig } from '../../../src/shared/hnsw.js';
import { getModelConfig, loadUserConfig, resolveIndexRoot, resolveRepoRootArg } from '../../shared/dict-utils.js';

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

  const embeddingBatchRaw = Number(argv.batch ?? indexingConfig.embeddingBatchSize);
  let embeddingBatchSize = Number.isFinite(embeddingBatchRaw)
    ? Math.max(0, Math.floor(embeddingBatchRaw))
    : 0;
  if (!embeddingBatchSize) {
    embeddingBatchSize = resolveAutoEmbeddingBatchSize();
  }

  const useStubEmbeddings = resolvedEmbeddingMode === 'stub' || baseStubEmbeddings;
  const configuredDims = Number.isFinite(Number(argv.dims))
    ? Math.max(1, Math.floor(Number(argv.dims)))
    : null;

  const modelConfig = getModelConfig(root, userConfig);
  const indexRoot = argv['index-root']
    ? path.resolve(argv['index-root'])
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
    configuredDims,
    modelConfig,
    modelId: modelConfig.id,
    modelsDir: modelConfig.dir || null,
    indexRoot,
    modes
  };
};
