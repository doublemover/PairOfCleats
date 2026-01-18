const normalizeString = (value) => {
  if (typeof value !== 'string') return '';
  return value.trim();
};

const normalizeNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const normalizeOptionalString = (value) => {
  const normalized = normalizeString(value);
  return normalized ? normalized : null;
};

export function parseEnvBool(value) {
  if (typeof value === 'boolean') return value;
  if (value == null) return null;
  const normalized = String(value).trim().toLowerCase();
  if (!normalized) return null;
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return null;
}

export function getEnvConfig(env = process.env) {
  const homeRoot = normalizeOptionalString(env.PAIROFCLEATS_HOME);
  const cacheRoot = normalizeOptionalString(env.PAIROFCLEATS_CACHE_ROOT);
  return {
    profile: normalizeOptionalString(env.PAIROFCLEATS_PROFILE),
    cacheRoot: homeRoot || cacheRoot,
    dictDir: normalizeOptionalString(env.PAIROFCLEATS_DICT_DIR),
    modelsDir: normalizeOptionalString(env.PAIROFCLEATS_MODELS_DIR),
    toolingDir: normalizeOptionalString(env.PAIROFCLEATS_TOOLING_DIR),
    extensionsDir: normalizeOptionalString(env.PAIROFCLEATS_EXTENSIONS_DIR),
    vectorExtension: normalizeOptionalString(env.PAIROFCLEATS_VECTOR_EXTENSION),
    modelId: normalizeOptionalString(env.PAIROFCLEATS_MODEL),
    embeddings: normalizeOptionalString(env.PAIROFCLEATS_EMBEDDINGS),
    threads: normalizeNumber(env.PAIROFCLEATS_THREADS),
    bundleThreads: normalizeNumber(env.PAIROFCLEATS_BUNDLE_THREADS),
    maxOldSpaceMb: normalizeNumber(env.PAIROFCLEATS_MAX_OLD_SPACE_MB),
    nodeOptions: normalizeOptionalString(env.PAIROFCLEATS_NODE_OPTIONS),
    uvThreadpoolSize: normalizeNumber(env.PAIROFCLEATS_UV_THREADPOOL_SIZE),
    stage: normalizeOptionalString(env.PAIROFCLEATS_STAGE),
    workerPool: normalizeOptionalString(env.PAIROFCLEATS_WORKER_POOL),
    watcherBackend: normalizeOptionalString(env.PAIROFCLEATS_WATCHER_BACKEND),
    verbose: parseEnvBool(env.PAIROFCLEATS_VERBOSE) === true,
    debugCrash: parseEnvBool(env.PAIROFCLEATS_DEBUG_CRASH) === true,
    xxhashBackend: normalizeOptionalString(env.PAIROFCLEATS_XXHASH_BACKEND),
    logFormat: normalizeOptionalString(env.PAIROFCLEATS_LOG_FORMAT),
    logLevel: normalizeOptionalString(env.PAIROFCLEATS_LOG_LEVEL),
    ftsProfile: normalizeOptionalString(env.PAIROFCLEATS_FTS_PROFILE),
    progressFiles: parseEnvBool(env.PAIROFCLEATS_PROGRESS_FILES),
    progressLines: parseEnvBool(env.PAIROFCLEATS_PROGRESS_LINES),
    fileCacheMax: normalizeNumber(env.PAIROFCLEATS_FILE_CACHE_MAX),
    summaryCacheMax: normalizeNumber(env.PAIROFCLEATS_SUMMARY_CACHE_MAX),
    maxJsonBytes: normalizeNumber(env.PAIROFCLEATS_MAX_JSON_BYTES)
  };
}

export function getEnvSecrets(env = process.env) {
  return {
    apiToken: normalizeString(env.PAIROFCLEATS_API_TOKEN)
  };
}
