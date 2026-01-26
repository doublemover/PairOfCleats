import { isPlainObject } from './config.js';

const normalizeString = (value) => {
  if (typeof value !== 'string') return '';
  return value.trim();
};

const normalizeBoolean = (value) => value === '1' || value === 'true';

const normalizeOptionalBoolean = (value) => {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text) return null;
  return normalizeBoolean(text);
};

const normalizeNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const isTesting = (env) => env?.PAIROFCLEATS_TESTING === '1' || env?.PAIROFCLEATS_TESTING === 'true';

export const isTestingEnv = (env = process.env) => isTesting(env);

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
    verbose: normalizeBoolean(env.PAIROFCLEATS_VERBOSE),
    logLevel: normalizeString(env.PAIROFCLEATS_LOG_LEVEL),
    logFormat: normalizeString(env.PAIROFCLEATS_LOG_FORMAT),
    stage: normalizeString(env.PAIROFCLEATS_STAGE),
    xxhashBackend: normalizeString(env.PAIROFCLEATS_XXHASH_BACKEND),
    debugCrash: normalizeBoolean(env.PAIROFCLEATS_DEBUG_CRASH),
    fileCacheMax: normalizeNumber(env.PAIROFCLEATS_FILE_CACHE_MAX),
    summaryCacheMax: normalizeNumber(env.PAIROFCLEATS_SUMMARY_CACHE_MAX),
    importGraph: normalizeOptionalBoolean(env.PAIROFCLEATS_IMPORT_GRAPH),
    discoveryStatConcurrency: normalizeNumber(env.PAIROFCLEATS_DISCOVERY_STAT_CONCURRENCY),
    mcpQueueMax: normalizeNumber(env.PAIROFCLEATS_MCP_QUEUE_MAX),
    mcpMaxBufferBytes: normalizeNumber(env.PAIROFCLEATS_MCP_MAX_BUFFER_BYTES),
    mcpToolTimeoutMs: normalizeNumber(env.PAIROFCLEATS_MCP_TOOL_TIMEOUT_MS)
  };
}

export function getTestEnvConfig(env = process.env) {
  if (!isTesting(env)) {
    return {
      testing: false,
      config: null,
      maxJsonBytes: null,
      allowMissingCompatKey: false
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
    maxJsonBytes: normalizeNumber(env.PAIROFCLEATS_TEST_MAX_JSON_BYTES),
    allowMissingCompatKey: normalizeOptionalBoolean(env.PAIROFCLEATS_TEST_ALLOW_MISSING_COMPAT_KEY)
  };
}

export function setVerboseEnv(enabled, env = process.env) {
  if (enabled) {
    env.PAIROFCLEATS_VERBOSE = '1';
  } else if (env.PAIROFCLEATS_VERBOSE != null) {
    delete env.PAIROFCLEATS_VERBOSE;
  }
}
