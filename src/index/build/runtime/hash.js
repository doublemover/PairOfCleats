import { sha1 } from '../../../shared/hash.js';
import { canonicalizeForSignature, stableStringifyForSignature } from '../../../shared/stable-json.js';
import { GENERATED_ARTIFACT_POLICY_VERSION } from '../../../shared/generated-artifact.js';

export const CONTENT_CONFIG_PROJECTION_VERSION = 2;
const SEMANTIC_ENV_FIELDS = Object.freeze([
  'embeddings', 'embeddingsSampleFiles', 'embeddingsSampleSeed', 'importGraph',
  'regexEngine', 'docExtract', 'dictDir', 'extensionsDir'
]);
export const projectSemanticEnvironment = (env = {}) => Object.fromEntries(
  SEMANTIC_ENV_FIELDS.filter((key) => env[key] !== undefined && env[key] !== null)
    .map((key) => [key, env[key]])
);

export const normalizeContentConfig = (config) => {
  if (!config || typeof config !== 'object') return config || {};
  const cloned = canonicalizeForSignature(config);
  delete cloned.threads;
  delete cloned.runtime;
  delete cloned.cache;
  delete cloned.logging;
  if (cloned.indexing && typeof cloned.indexing === 'object') {
    delete cloned.indexing.shards;
    delete cloned.indexing.fileListSampleSize;
    delete cloned.indexing.concurrency;
    delete cloned.indexing.importConcurrency;
    delete cloned.indexing.workerPool;
    delete cloned.indexing.debugCrash;
    delete cloned.indexing.memory;
    delete cloned.indexing.scheduler;
    delete cloned.indexing.ioConcurrencyCap;
    delete cloned.indexing.embeddingBatchSize;
    if (cloned.indexing.embeddings && typeof cloned.indexing.embeddings === 'object') {
      for (const key of ['concurrency', 'fileParallelism', 'maxBatchTokens', 'queue', 'cache', 'maintenance']) {
        delete cloned.indexing.embeddings[key];
      }
    }
  }
  return cloned;
};

export const buildContentConfigHash = (config, envConfig) => {
  const normalizedEnv = projectSemanticEnvironment(envConfig);
  const payload = {
    contentConfigProjectionVersion: CONTENT_CONFIG_PROJECTION_VERSION,
    generatedArtifactPolicyVersion: GENERATED_ARTIFACT_POLICY_VERSION,
    config: normalizeContentConfig(config),
    env: normalizedEnv
  };
  return sha1(stableStringifyForSignature(payload));
};
