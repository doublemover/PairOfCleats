import { sha1 } from '../../../shared/hash.js';
import { stableStringify } from '../../../shared/stable-json.js';

export const normalizeContentConfig = (config) => {
  if (!config || typeof config !== 'object') return config || {};
  const cloned = JSON.parse(JSON.stringify(config));
  if (cloned.indexing && typeof cloned.indexing === 'object') {
    delete cloned.indexing.shards;
    delete cloned.indexing.fileListSampleSize;
    delete cloned.indexing.concurrency;
    delete cloned.indexing.importConcurrency;
    delete cloned.indexing.workerPool;
    delete cloned.indexing.debugCrash;
  }
  return cloned;
};

export const buildContentConfigHash = (config, envConfig) => {
  const normalizedEnv = { ...envConfig, cacheRoot: '' };
  const payload = {
    config: normalizeContentConfig(config),
    env: normalizedEnv
  };
  return sha1(stableStringify(payload));
};
