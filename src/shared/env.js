const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);
const FALSE_VALUES = new Set(['0', 'false', 'no', 'off']);

const normalizeString = (value) => {
  if (typeof value !== 'string') return '';
  return value.trim();
};

const parseBool = (value) => {
  if (value == null) return null;
  const normalized = String(value).trim().toLowerCase();
  if (TRUE_VALUES.has(normalized)) return true;
  if (FALSE_VALUES.has(normalized)) return false;
  return null;
};

const parseNumber = (value) => {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export function getEnvConfig(env = process.env) {
  return {
    profile: normalizeString(env.PAIROFCLEATS_PROFILE),
    cacheRoot: normalizeString(env.PAIROFCLEATS_CACHE_ROOT),
    home: normalizeString(env.PAIROFCLEATS_HOME),
    dictDir: normalizeString(env.PAIROFCLEATS_DICT_DIR),
    model: normalizeString(env.PAIROFCLEATS_MODEL),
    modelsDir: normalizeString(env.PAIROFCLEATS_MODELS_DIR),
    toolingDir: normalizeString(env.PAIROFCLEATS_TOOLING_DIR),
    toolingInstallScope: normalizeString(env.PAIROFCLEATS_TOOLING_INSTALL_SCOPE),
    extensionsDir: normalizeString(env.PAIROFCLEATS_EXTENSIONS_DIR),
    embeddings: normalizeString(env.PAIROFCLEATS_EMBEDDINGS),
    debugCrash: parseBool(env.PAIROFCLEATS_DEBUG_CRASH),
    threads: parseNumber(env.PAIROFCLEATS_THREADS),
    bundleThreads: parseNumber(env.PAIROFCLEATS_BUNDLE_THREADS),
    workerPool: normalizeString(env.PAIROFCLEATS_WORKER_POOL),
    maxOldSpaceMb: parseNumber(env.PAIROFCLEATS_MAX_OLD_SPACE_MB),
    uvThreadpoolSize: parseNumber(env.PAIROFCLEATS_UV_THREADPOOL_SIZE),
    nodeOptions: normalizeString(env.PAIROFCLEATS_NODE_OPTIONS),
    stage: normalizeString(env.PAIROFCLEATS_STAGE),
    ftsProfile: normalizeString(env.PAIROFCLEATS_FTS_PROFILE),
    vectorExtension: normalizeString(env.PAIROFCLEATS_VECTOR_EXTENSION),
    verbose: parseBool(env.PAIROFCLEATS_VERBOSE),
    progressFiles: parseBool(env.PAIROFCLEATS_PROGRESS_FILES),
    progressLines: parseBool(env.PAIROFCLEATS_PROGRESS_LINES),
    fileCacheMax: parseNumber(env.PAIROFCLEATS_FILE_CACHE_MAX),
    summaryCacheMax: parseNumber(env.PAIROFCLEATS_SUMMARY_CACHE_MAX),
    logFormat: normalizeString(env.PAIROFCLEATS_LOG_FORMAT),
    logLevel: normalizeString(env.PAIROFCLEATS_LOG_LEVEL)
  };
}

export function parseEnvBool(value) {
  return parseBool(value);
}

export function normalizeEnvString(value) {
  return normalizeString(value);
}

export function parseEnvNumber(value) {
  return parseNumber(value);
}
