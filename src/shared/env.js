import { isPlainObject } from './config.js';

const normalizeString = (value) => {
  if (typeof value !== 'string') return '';
  return value.trim();
};

const normalizeBoolean = (value) => value === '1' || value === 'true';

const normalizeNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const isTesting = (env) => env?.PAIROFCLEATS_TESTING === '1' || env?.PAIROFCLEATS_TESTING === 'true';

export function getEnvSecrets(env = process.env) {
  return {
    apiToken: normalizeString(env.PAIROFCLEATS_API_TOKEN)
  };
}

export function getEnvConfig(env = process.env) {
  const secrets = getEnvSecrets(env);
  if (!isTesting(env)) return secrets;
  return {
    ...secrets,
    cacheRoot: normalizeString(env.PAIROFCLEATS_CACHE_ROOT),
    embeddings: normalizeString(env.PAIROFCLEATS_EMBEDDINGS),
    workerPool: normalizeString(env.PAIROFCLEATS_WORKER_POOL),
    threads: normalizeNumber(env.PAIROFCLEATS_THREADS),
    bundleThreads: normalizeNumber(env.PAIROFCLEATS_BUNDLE_THREADS),
    watcherBackend: normalizeString(env.PAIROFCLEATS_WATCHER_BACKEND),
    logLevel: normalizeString(env.PAIROFCLEATS_LOG_LEVEL),
    logFormat: normalizeString(env.PAIROFCLEATS_LOG_FORMAT),
    stage: normalizeString(env.PAIROFCLEATS_STAGE),
    xxhashBackend: normalizeString(env.PAIROFCLEATS_XXHASH_BACKEND),
    debugCrash: normalizeBoolean(env.PAIROFCLEATS_DEBUG_CRASH),
    fileCacheMax: normalizeNumber(env.PAIROFCLEATS_FILE_CACHE_MAX),
    summaryCacheMax: normalizeNumber(env.PAIROFCLEATS_SUMMARY_CACHE_MAX)
  };
}

export function getTestEnvConfig(env = process.env) {
  if (!isTesting(env)) {
    return {
      testing: false,
      config: null,
      maxJsonBytes: null
    };
  }
  const rawConfig = normalizeString(env.PAIROFCLEATS_TEST_CONFIG);
  let config = null;
  if (rawConfig) {
    let parsed;
    try {
      parsed = JSON.parse(rawConfig);
    } catch (err) {
      throw new Error(`Invalid PAIROFCLEATS_TEST_CONFIG: ${err?.message || err}`);
    }
    if (!isPlainObject(parsed)) {
      throw new Error('PAIROFCLEATS_TEST_CONFIG must be a JSON object.');
    }
    config = parsed;
  }
  return {
    testing: true,
    config,
    maxJsonBytes: normalizeNumber(env.PAIROFCLEATS_TEST_MAX_JSON_BYTES)
  };
}
