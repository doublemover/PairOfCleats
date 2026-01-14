import { createTaskQueues } from '../../../shared/concurrency.js';
import { resolveThreadLimits } from '../../../shared/threads.js';
import { createIndexerWorkerPools, resolveWorkerPoolConfig } from '../worker-pool.js';
import { createCrashLogger } from '../crash-log.js';

export const resolveThreadLimitsConfig = ({ argv, rawArgv, envConfig, indexingConfig, log }) => {
  const configConcurrency = Number(indexingConfig.concurrency);
  const importConcurrencyConfig = Number(indexingConfig.importConcurrency);
  const ioConcurrencyCapConfig = Number(indexingConfig.ioConcurrencyCap);
  const threadLimits = resolveThreadLimits({
    argv,
    rawArgv,
    envConfig,
    configConcurrency,
    importConcurrencyConfig,
    ioConcurrencyCapConfig
  });
  const {
    cpuCount,
    maxConcurrencyCap,
    fileConcurrency,
    importConcurrency,
    ioConcurrency,
    cpuConcurrency
  } = threadLimits;
  const effectiveUvRaw = Number(process.env.UV_THREADPOOL_SIZE);
  const effectiveUvThreadpoolSize = Number.isFinite(effectiveUvRaw) && effectiveUvRaw > 0
    ? Math.floor(effectiveUvRaw)
    : null;
  if (effectiveUvThreadpoolSize && ioConcurrency > effectiveUvThreadpoolSize * 2) {
    console.warn(
      `[threads] ioConcurrency=${ioConcurrency} exceeds UV_THREADPOOL_SIZE=${effectiveUvThreadpoolSize}. `
        + 'Consider aligning runtime.uvThreadpoolSize/UV_THREADPOOL_SIZE with your I/O concurrency for best throughput.'
    );
  } else if (!effectiveUvThreadpoolSize && envConfig.verbose && ioConcurrency >= 16) {
    console.warn(
      `[threads] ioConcurrency=${ioConcurrency} with default UV threadpool. `
        + 'Consider setting runtime.uvThreadpoolSize (or UV_THREADPOOL_SIZE) for I/O-heavy indexing.'
    );
  }

  if (envConfig.verbose) {
    log(`Thread limits (${threadLimits.source}): cpu=${cpuCount}, cap=${maxConcurrencyCap}, files=${fileConcurrency}, imports=${importConcurrency}, io=${ioConcurrency}, cpuWork=${cpuConcurrency}.`);
  }
  return {
    threadLimits,
    cpuCount,
    maxConcurrencyCap,
    fileConcurrency,
    importConcurrency,
    ioConcurrency,
    cpuConcurrency
  };
};

export const createRuntimeQueues = ({
  ioConcurrency,
  cpuConcurrency,
  fileConcurrency,
  embeddingConcurrency
}) => {
  const maxFilePending = Math.min(10000, fileConcurrency * 1000);
  const maxIoPending = Math.min(10000, Math.max(ioConcurrency, fileConcurrency) * 1000);
  const maxEmbeddingPending = Math.min(64, embeddingConcurrency * 8);
  const queues = createTaskQueues({
    ioConcurrency,
    cpuConcurrency,
    embeddingConcurrency,
    ioPendingLimit: maxIoPending,
    cpuPendingLimit: maxFilePending,
    embeddingPendingLimit: maxEmbeddingPending
  });
  return { queues, maxFilePending, maxIoPending, maxEmbeddingPending };
};

export const resolveWorkerPoolRuntimeConfig = ({ indexingConfig, envConfig, cpuConcurrency, fileConcurrency }) => {
  const workerPoolDefaultMax = Math.min(8, fileConcurrency);
  return resolveWorkerPoolConfig(
    indexingConfig.workerPool || {},
    envConfig,
    {
      cpuLimit: cpuConcurrency,
      defaultMaxWorkers: workerPoolDefaultMax,
      hardMaxWorkers: 16
    }
  );
};

export const createRuntimeWorkerPools = async ({
  workerPoolConfig,
  repoCacheRoot,
  dictWords,
  dictSharedPayload,
  dictConfig,
  postingsConfig,
  debugCrash,
  log
}) => {
  const workerCrashLogger = await createCrashLogger({
    repoCacheRoot,
    enabled: debugCrash,
    log: null
  });

  let workerPools = { tokenizePool: null, quantizePool: null, destroy: async () => {} };
  let workerPool = null;
  let quantizePool = null;
  if (workerPoolConfig.enabled !== false) {
    workerPools = await createIndexerWorkerPools({
      config: workerPoolConfig,
      dictWords,
      dictSharedPayload,
      dictConfig,
      postingsConfig,
      crashLogger: workerCrashLogger,
      log
    });
    workerPool = workerPools.tokenizePool;
    quantizePool = workerPools.quantizePool;
    if (workerPool) {
      const modeLabel = workerPoolConfig.enabled === 'auto' ? 'auto' : 'on';
      const maxThreads = workerPool?.options?.maxThreads ?? workerPoolConfig.maxWorkers;
      const splitLabel = workerPoolConfig.splitByTask
        ? `, split tasks (quantizeMax=${workerPoolConfig.quantizeMaxWorkers || Math.max(1, Math.floor(workerPoolConfig.maxWorkers / 2))})`
        : '';
      log(`Worker pool enabled (${modeLabel}, maxThreads=${maxThreads}${splitLabel}).`);
      if (workerPoolConfig.enabled === 'auto') {
        log(`Worker pool auto threshold: maxFileBytes=${workerPoolConfig.maxFileBytes}.`);
      }
    } else {
      log('Worker pool disabled (fallback to main thread).');
    }
  }

  return { workerPools, workerPool, quantizePool };
};
