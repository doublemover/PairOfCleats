import { sanitizeRuntimeReceipt, observeRuntimePath } from './receipt.js';
import { getCacheRoot, getRepoCacheRoot, getModelConfig } from '../dict-utils.js';
import { getEnvConfig } from '../env/runtime.js';
import { resolveEmbeddingIntent } from '../embedding-intent.js';

/** A new invocation's read-only projection, never evidence of another run. */
export const createRuntimePreview = async ({ repoRoot, userConfig, policy, envelope, argv = {}, configSources = null } = {}) => {
  const model = getModelConfig(repoRoot, userConfig);
  const cacheRoot = userConfig.cache?.root || getCacheRoot();
  const intent = resolveEmbeddingIntent({ argv, embeddingsConfig: userConfig.indexing?.embeddings || {}, envConfig: getEnvConfig(), policyEnabled: policy?.indexing?.embeddings?.enabled });
  const safeEnvelope = { ...envelope };
  delete safeEnvelope.envPatch;
  return sanitizeRuntimeReceipt({
    ...safeEnvelope,
    diagnostic: { kind: 'configuration-preview', liveRunReceipt: false, generatedAt: new Date().toISOString() },
    repoRoot, configSources,
    embeddings: { selectedModel: argv.model || model.id, modelSource: argv.model ? 'cli' : userConfig.indexing?.embeddings?.model ? 'config.indexing.embeddings.model' : userConfig.models?.id ? 'config.models.id' : 'default', ...intent, observation: { state: 'not-started', provider: null, device: null } },
    paths: {
      repo: await observeRuntimePath(repoRoot), cache: await observeRuntimePath(cacheRoot),
      repoCache: await observeRuntimePath(getRepoCacheRoot(repoRoot, userConfig)), models: await observeRuntimePath(model.dir)
    }
  });
};
