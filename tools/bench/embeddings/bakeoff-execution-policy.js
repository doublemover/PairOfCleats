import { createEmbeddingExecutionPlan } from '../../../src/shared/embedding-execution-plan.js';
import { resolveEmbeddingIntent } from '../../../src/shared/embedding-intent.js';
import { getEnvConfig } from '../../../src/shared/env/runtime.js';
import { resolveEmbeddingSamplingConfig } from '../../build/embeddings/sampling.js';

export const BAKEOFF_EXECUTION_POLICY_VERSION = 1;
const freeze = value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};
const envValues = env => Object.fromEntries(Object.entries(env).filter(([, value]) => value != null)
  .map(([key, value]) => [process.platform === 'win32' ? key.toUpperCase() : key, String(value)]));

/** Profile/explicit sampling is a decision, including zero; omission would
 * revive inherited/configured positive sampling. Raw values stay private. */
export const createBakeoffExecutionPolicy = ({ root, userConfig = {}, baseEnv, mode,
  embeddingSampleFiles, embeddingSampleSeed, stubRequested = false }) => {
  if (!Number.isSafeInteger(embeddingSampleFiles) || embeddingSampleFiles < 0) throw new TypeError('Bakeoff sampling requires its resolved nonnegative file limit.');
  const env = { ...envValues(baseEnv), PAIROFCLEATS_EMBEDDINGS_SAMPLE_FILES: String(embeddingSampleFiles),
    PAIROFCLEATS_EMBEDDINGS_SAMPLE_SEED: String(embeddingSampleSeed) };
  if (stubRequested) env.PAIROFCLEATS_EMBEDDINGS = 'stub';
  const normalized = getEnvConfig(env);
  const intent = resolveEmbeddingIntent({ argv: { 'stub-embeddings': stubRequested },
    embeddingsConfig: userConfig.indexing?.embeddings, envConfig: normalized });
  const sampling = resolveEmbeddingSamplingConfig({ embeddingsConfig: userConfig.indexing?.embeddings, env: normalized });
  const receipt = freeze({ version: BAKEOFF_EXECUTION_POLICY_VERSION,
    requested: { sampleFiles: embeddingSampleFiles, sampleSeed: embeddingSampleSeed, stubEmbeddings: stubRequested },
    effective: { sampling, embeddingMode: intent.resolvedEmbeddingMode, embeddingEnabled: intent.embeddingEnabled,
      stubEmbeddings: intent.useStubEmbeddings, intentSource: intent.reason },
    coverage: 'requested-child-policy-observed-index-coverage-is-separate' });
  const policy = { receipt,
    forModel({ modelId, cacheRoot, sharedModelsDir, sharedDictDir, heapMb }) {
      const childEnv = { ...env, PAIROFCLEATS_MODEL: modelId, PAIROFCLEATS_CACHE_ROOT: cacheRoot };
      if (sharedModelsDir) childEnv.PAIROFCLEATS_MODELS_DIR = sharedModelsDir;
      if (sharedDictDir) childEnv.PAIROFCLEATS_DICT_DIR = sharedDictDir;
      if (heapMb > 0) childEnv.PAIROFCLEATS_MAX_OLD_SPACE_MB = String(heapMb);
      const execution = freeze(createEmbeddingExecutionPlan({ root, modes: mode === 'code' ? ['code'] : mode === 'prose'
        ? ['prose', 'extracted-prose'] : ['code', 'prose', 'extracted-prose', 'records'], modelId,
      rawEnv: childEnv, userConfig, argv: { 'stub-embeddings': intent.useStubEmbeddings } }));
      const plan = { receipt, execution };
      Object.defineProperty(plan, 'env', { value: Object.freeze(childEnv) });
      return Object.freeze(plan);
    },
    compareArgs(args) { return Object.freeze(intent.useStubEmbeddings && !args.includes('--stub-embeddings') ? [...args, '--stub-embeddings'] : [...args]); }
  };
  Object.defineProperty(policy, 'env', { value: Object.freeze(env) });
  return Object.freeze(policy);
};
