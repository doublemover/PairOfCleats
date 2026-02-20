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
const normalizeNonNegativeInt = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.floor(parsed));
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
  const mcpMode = normalizeString(env.PAIROFCLEATS_MCP_MODE)
    || normalizeString(env.MCP_MODE);
  return {
    ...secrets,
    mcpMode,
    homeRoot: normalizeString(env.PAIROFCLEATS_HOME),
    cacheRoot: normalizeString(env.PAIROFCLEATS_CACHE_ROOT),
    cacheNamespace: normalizeString(env.PAIROFCLEATS_CACHE_NAMESPACE),
    cacheRebuild: normalizeBoolean(env.PAIROFCLEATS_CACHE_REBUILD),
    cacheMetricsSampleRate: normalizeNumber(env.PAIROFCLEATS_CACHE_METRICS_SAMPLE_RATE),
    embeddings: normalizeString(env.PAIROFCLEATS_EMBEDDINGS),
    workerPool: normalizeString(env.PAIROFCLEATS_WORKER_POOL),
    workerPoolMaxWorkers: normalizeNumber(env.PAIROFCLEATS_WORKER_POOL_MAX_WORKERS),
    workerPoolHeapTargetMb: normalizeNumber(env.PAIROFCLEATS_WORKER_POOL_HEAP_TARGET_MB),
    workerPoolHeapMinMb: normalizeNumber(env.PAIROFCLEATS_WORKER_POOL_HEAP_MIN_MB),
    workerPoolHeapMaxMb: normalizeNumber(env.PAIROFCLEATS_WORKER_POOL_HEAP_MAX_MB),
    threads: normalizeNumber(env.PAIROFCLEATS_THREADS),
    bundleThreads: normalizeNumber(env.PAIROFCLEATS_BUNDLE_THREADS),
    watcherBackend: normalizeString(env.PAIROFCLEATS_WATCHER_BACKEND),
    verbose: normalizeBoolean(env.PAIROFCLEATS_VERBOSE),
    logLevel: normalizeString(env.PAIROFCLEATS_LOG_LEVEL),
    logFormat: normalizeString(env.PAIROFCLEATS_LOG_FORMAT),
    stage: normalizeString(env.PAIROFCLEATS_STAGE),
    xxhashBackend: normalizeString(env.PAIROFCLEATS_XXHASH_BACKEND),
    debugOrdered: normalizeBoolean(env.PAIROFCLEATS_DEBUG_ORDERED),
    debugCrash: normalizeBoolean(env.PAIROFCLEATS_DEBUG_CRASH),
    debugPerfEvents: normalizeBoolean(env.PAIROFCLEATS_DEBUG_PERF_EVENTS),
    fileCacheMax: normalizeNumber(env.PAIROFCLEATS_FILE_CACHE_MAX),
    summaryCacheMax: normalizeNumber(env.PAIROFCLEATS_SUMMARY_CACHE_MAX),
    importGraph: normalizeOptionalBoolean(env.PAIROFCLEATS_IMPORT_GRAPH),
    discoveryStatConcurrency: normalizeNumber(env.PAIROFCLEATS_DISCOVERY_STAT_CONCURRENCY),
    regexEngine: normalizeString(env.PAIROFCLEATS_REGEX_ENGINE),
    compression: normalizeString(env.PAIROFCLEATS_COMPRESSION),
    docExtract: normalizeString(env.PAIROFCLEATS_DOC_EXTRACT),
    schedulerEnabled: normalizeOptionalBoolean(env.PAIROFCLEATS_SCHEDULER),
    schedulerCpuTokens: normalizeNumber(env.PAIROFCLEATS_SCHEDULER_CPU),
    schedulerIoTokens: normalizeNumber(env.PAIROFCLEATS_SCHEDULER_IO),
    schedulerMemoryTokens: normalizeNumber(env.PAIROFCLEATS_SCHEDULER_MEM),
    schedulerAdaptive: normalizeOptionalBoolean(env.PAIROFCLEATS_SCHEDULER_ADAPTIVE),
    schedulerMaxCpuTokens: normalizeNumber(env.PAIROFCLEATS_SCHEDULER_MAX_CPU),
    schedulerMaxIoTokens: normalizeNumber(env.PAIROFCLEATS_SCHEDULER_MAX_IO),
    schedulerMaxMemoryTokens: normalizeNumber(env.PAIROFCLEATS_SCHEDULER_MAX_MEM),
    schedulerTargetUtilization: normalizeNumber(env.PAIROFCLEATS_SCHEDULER_TARGET_UTILIZATION),
    schedulerAdaptiveStep: normalizeNumber(env.PAIROFCLEATS_SCHEDULER_ADAPTIVE_STEP),
    schedulerMemoryReserveMb: normalizeNumber(env.PAIROFCLEATS_SCHEDULER_MEMORY_RESERVE_MB),
    schedulerMemoryPerTokenMb: normalizeNumber(env.PAIROFCLEATS_SCHEDULER_MEMORY_PER_TOKEN_MB),
    schedulerStarvationMs: normalizeNumber(env.PAIROFCLEATS_SCHEDULER_STARVATION_MS),
    schedulerLowResource: normalizeOptionalBoolean(env.PAIROFCLEATS_SCHEDULER_LOW_RESOURCE),
    mcpTransport: normalizeString(env.PAIROFCLEATS_MCP_TRANSPORT),
    traceArtifactIo: normalizeBoolean(env.PAIROFCLEATS_TRACE_ARTIFACT_IO),
    incrementalBundleUpdateConcurrency: normalizeNumber(env.PAIROFCLEATS_INCREMENTAL_BUNDLE_UPDATE_CONCURRENCY),
    buildIndexLockWaitMs: normalizeNumber(env.PAIROFCLEATS_BUILD_INDEX_LOCK_WAIT_MS),
    buildIndexLockPollMs: normalizeNumber(env.PAIROFCLEATS_BUILD_INDEX_LOCK_POLL_MS),
    storageTier: normalizeString(env.PAIROFCLEATS_STORAGE_TIER),
    queryCacheStrategy: normalizeString(env.PAIROFCLEATS_QUERY_CACHE_STRATEGY),
    queryCachePrewarm: normalizeOptionalBoolean(env.PAIROFCLEATS_QUERY_CACHE_PREWARM),
    queryCachePrewarmMaxEntries: normalizeNumber(env.PAIROFCLEATS_QUERY_CACHE_PREWARM_MAX_ENTRIES),
    queryCacheMemoryFreshMs: normalizeNumber(env.PAIROFCLEATS_QUERY_CACHE_MEMORY_FRESH_MS),
    sqliteTailLatencyTuning: normalizeOptionalBoolean(env.PAIROFCLEATS_SQLITE_TAIL_LATENCY_TUNING),
    sqliteFtsOverfetchRowCap: normalizeNumber(env.PAIROFCLEATS_SQLITE_FTS_OVERFETCH_ROW_CAP),
    sqliteFtsOverfetchTimeBudgetMs: normalizeNumber(env.PAIROFCLEATS_SQLITE_FTS_OVERFETCH_TIME_BUDGET_MS),
    sqliteFtsOverfetchChunkSize: normalizeNumber(env.PAIROFCLEATS_SQLITE_FTS_OVERFETCH_CHUNK_SIZE),
    preferMemoryBackendOnCacheHit: normalizeOptionalBoolean(env.PAIROFCLEATS_PREFER_MEMORY_BACKEND_ON_CACHE_HIT),
    modelsDir: normalizeString(env.PAIROFCLEATS_MODELS_DIR),
    dictDir: normalizeString(env.PAIROFCLEATS_DICT_DIR),
    extensionsDir: normalizeString(env.PAIROFCLEATS_EXTENSIONS_DIR),
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
      allowMissingCompatKey: false,
      mcpDelayMs: null
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
    allowMissingCompatKey: normalizeOptionalBoolean(env.PAIROFCLEATS_TEST_ALLOW_MISSING_COMPAT_KEY),
    mcpDelayMs: normalizeNumber(env.PAIROFCLEATS_TEST_MCP_DELAY_MS)
  };
}

export function getDocumentExtractorTestConfig(env = process.env) {
  const testing = isTesting(env);
  if (!testing) {
    return {
      testing: false,
      forceDocxMissing: false,
      forcePdfMissing: false,
      stubDocxExtract: false,
      stubPdfExtract: false,
      stubPdfExtractDelayMs: 0
    };
  }
  return {
    testing: true,
    forceDocxMissing: normalizeBoolean(env.PAIROFCLEATS_TEST_FORCE_DOCX_MISSING),
    forcePdfMissing: normalizeBoolean(env.PAIROFCLEATS_TEST_FORCE_PDF_MISSING),
    stubDocxExtract: normalizeBoolean(env.PAIROFCLEATS_TEST_STUB_DOCX_EXTRACT),
    stubPdfExtract: normalizeBoolean(env.PAIROFCLEATS_TEST_STUB_PDF_EXTRACT),
    stubPdfExtractDelayMs: normalizeNonNegativeInt(env.PAIROFCLEATS_TEST_STUB_PDF_EXTRACT_DELAY_MS)
  };
}

export function getLanceDbEnv(env = process.env) {
  return {
    child: normalizeBoolean(env.PAIROFCLEATS_LANCEDB_CHILD),
    isolate: normalizeBoolean(env.PAIROFCLEATS_LANCEDB_ISOLATE),
    payload: normalizeString(env.PAIROFCLEATS_LANCEDB_PAYLOAD)
  };
}

export function setVerboseEnv(enabled, env = process.env) {
  if (enabled) {
    env.PAIROFCLEATS_VERBOSE = '1';
  } else if (env.PAIROFCLEATS_VERBOSE != null) {
    delete env.PAIROFCLEATS_VERBOSE;
  }
}

export function setCacheRebuildEnv(enabled, env = process.env) {
  if (enabled) {
    env.PAIROFCLEATS_CACHE_REBUILD = '1';
  } else if (env.PAIROFCLEATS_CACHE_REBUILD != null) {
    delete env.PAIROFCLEATS_CACHE_REBUILD;
  }
}
