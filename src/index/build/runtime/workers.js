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
    configConcurrencySource: 'config.indexing.concurrency',
    configSourceTag: 'config',
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
  embeddingConcurrency,
  pendingLimits
}) => {
  // Bound the number of in-flight tasks we allow `runWithQueue()` to schedule.
  //
  // Rationale:
  // - We enforce deterministic ordering when appending results (stable chunk ids).
  // - If one early file is slow, many later files can finish first.
  // - Those results must be buffered until the missing orderIndex arrives.
  // - A very large pending window (e.g. 10k) can therefore create a transient but
  //   extreme peak in retained chunk payloads, which is timing-sensitive (often
  //   disappears under `--inspect`) and can trigger V8 OOM.
  //
  // Keep a small, CPU-scaled window to cap worst-case buffering without requiring
  // users to tweak configuration.
  const maxFilePending = Number.isFinite(pendingLimits?.cpu?.maxPending)
    ? pendingLimits.cpu.maxPending
    : Math.max(16, cpuConcurrency * 4);
  const maxIoPending = Number.isFinite(pendingLimits?.io?.maxPending)
    ? pendingLimits.io.maxPending
    : Math.max(8, ioConcurrency * 4);
  const effectiveEmbeddingConcurrency = Number.isFinite(embeddingConcurrency) && embeddingConcurrency > 0
    ? embeddingConcurrency
    : Math.max(1, Math.min(cpuConcurrency || 1, fileConcurrency || 1));
  const maxEmbeddingPending = Number.isFinite(pendingLimits?.embedding?.maxPending)
    ? pendingLimits.embedding.maxPending
    : Math.max(16, effectiveEmbeddingConcurrency * 4);
  const procConcurrency = Number.isFinite(pendingLimits?.proc?.concurrency)
    ? Math.max(1, Math.floor(pendingLimits.proc.concurrency))
    : null;
  const procPendingLimit = Number.isFinite(pendingLimits?.proc?.maxPending)
    ? Math.max(1, Math.floor(pendingLimits.proc.maxPending))
    : null;

  const queues = createTaskQueues({
    ioConcurrency,
    cpuConcurrency,
    embeddingConcurrency,
    procConcurrency,
    ioPendingLimit: maxIoPending,
    cpuPendingLimit: maxFilePending,
    embeddingPendingLimit: maxEmbeddingPending,
    procPendingLimit
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
