import { getAutoPolicy, getDictConfig, getMetricsDir, getModelConfig, loadUserConfig } from '../../shared/dict-utils.js';
import { getRepoRoot } from '../../shared/repo-paths.js';
import { getEnvConfig } from '../../shared/env/runtime.js';
import { resolveEmbeddingIntent } from '../../shared/embedding-intent.js';
import { throwIfAborted } from '../../shared/abort.js';
import { parseSearchArgs } from '../cli-args.js';
import { normalizeSearchOptions } from '../cli/normalize-options.js';
import { captureEffectiveSearchPlan } from '../cli/effective-plan.js';
import { buildCoreSearchInvocation } from '../../integrations/core/search-invocation.js';

/** Load once per repository; reuse the same captured precedence across modes. */
export const loadFederatedSearchPolicy = async (root, signal) => {
  throwIfAborted(signal);
  const rootDir = getRepoRoot(root), userConfig = loadUserConfig(rootDir);
  const policy = await getAutoPolicy(rootDir, userConfig);
  throwIfAborted(signal);
  return { rootDir, userConfig, policy, metricsDir: getMetricsDir(rootDir, userConfig),
    modelConfig: getModelConfig(rootDir, userConfig), dictConfig: getDictConfig(rootDir, userConfig) };
};

export const captureFederatedSearchPolicy = (inputs, { args, query, exactMode }) => {
  const { rawArgs } = buildCoreSearchInvocation(inputs.rootDir, { args, query, argsMode: 'complete' });
  const argv = parseSearchArgs(rawArgs);
  const normalized = normalizeSearchOptions({ ...inputs, argv, rawArgs, exactMode });
  if (normalized.missingValueMessages.length) throw new Error(normalized.missingValueMessages.join('\n'));
  const { useStubEmbeddings } = resolveEmbeddingIntent({ argv, embeddingsConfig: inputs.userConfig.indexing?.embeddings,
    envConfig: getEnvConfig(), execution: 'query' });
  return captureEffectiveSearchPlan({ ...inputs, normalized, rawArgs, exactMode, useStubEmbeddings,
    modelConfig: { ...inputs.modelConfig, id: argv.model || inputs.modelConfig.id } });
};
