import { createSchedulerQueueAdapter, createTaskQueues } from '../../../shared/concurrency.js';
import { SCHEDULER_QUEUE_NAMES } from './scheduler.js';
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
    const memLabel = Number.isFinite(threadLimits.totalMemGiB)
      ? `, mem=${threadLimits.totalMemGiB.toFixed(1)}GiB`
      : '';
    log(`Thread limits (${threadLimits.source}): cpu=${cpuCount}${memLabel}, cap=${maxConcurrencyCap}, files=${fileConcurrency}, imports=${importConcurrency}, io=${ioConcurrency}, cpuWork=${cpuConcurrency}.`);
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

const coercePositiveInt = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.floor(parsed);
};

export const createRuntimeQueues = ({
  ioConcurrency,
  cpuConcurrency,
  fileConcurrency,
  embeddingConcurrency,
  pendingLimits,
  scheduler,
  stage1Queues = null,
  procConcurrency = null
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
  const tokenizeConfig = stage1Queues?.tokenize || {};
  const tokenizeConcurrency = coercePositiveInt(tokenizeConfig?.concurrency);
  const effectiveCpuConcurrency = tokenizeConcurrency ?? cpuConcurrency;
  const maxFilePending = coercePositiveInt(tokenizeConfig?.maxPending)
    ?? (Number.isFinite(pendingLimits?.cpu?.maxPending)
      ? pendingLimits.cpu.maxPending
      : Math.max(16, effectiveCpuConcurrency * 4));
  const maxIoPending = Number.isFinite(pendingLimits?.io?.maxPending)
    ? pendingLimits.io.maxPending
    : Math.max(8, ioConcurrency * 4);
  const effectiveEmbeddingConcurrency = Number.isFinite(embeddingConcurrency) && embeddingConcurrency > 0
    ? embeddingConcurrency
    : Math.max(1, Math.min(cpuConcurrency || 1, fileConcurrency || 1));
  const maxEmbeddingPending = Number.isFinite(pendingLimits?.embedding?.maxPending)
    ? pendingLimits.embedding.maxPending
    : Math.max(16, effectiveEmbeddingConcurrency * 4);
  const resolvedProcConcurrency = coercePositiveInt(procConcurrency)
    ?? (Number.isFinite(pendingLimits?.proc?.concurrency)
      ? Math.max(1, Math.floor(pendingLimits.proc.concurrency))
      : null);
  const procPendingLimit = Number.isFinite(pendingLimits?.proc?.maxPending)
    ? Math.max(1, Math.floor(pendingLimits.proc.maxPending))
    : (resolvedProcConcurrency ? Math.max(4, resolvedProcConcurrency * 4) : null);

  if (scheduler && scheduler.enabled && scheduler.lowResourceMode !== true && typeof scheduler.schedule === 'function') {
    const cpuQueue = createSchedulerQueueAdapter({
      scheduler,
      queueName: SCHEDULER_QUEUE_NAMES.stage1Cpu,
      tokens: { cpu: 1 },
      maxPending: maxFilePending,
      concurrency: effectiveCpuConcurrency
    });
    const ioQueue = createSchedulerQueueAdapter({
      scheduler,
      queueName: SCHEDULER_QUEUE_NAMES.stage1Io,
      tokens: { io: 1 },
      maxPending: maxIoPending,
      concurrency: ioConcurrency
    });
    const embeddingQueue = createSchedulerQueueAdapter({
      scheduler,
      queueName: SCHEDULER_QUEUE_NAMES.embeddingsCompute,
      tokens: { cpu: 1 },
      maxPending: maxEmbeddingPending,
      concurrency: effectiveEmbeddingConcurrency
    });
    const procQueue = resolvedProcConcurrency
      ? createSchedulerQueueAdapter({
        scheduler,
        queueName: SCHEDULER_QUEUE_NAMES.stage1Proc,
        // Proc queue tasks are awaited from within Stage1 CPU tasks; charging them
        // against the same CPU token pool can deadlock when cpuTokens is small
        // (e.g. --threads 1). Use memory tokens to preserve backpressure without
        // blocking nested scheduling.
        tokens: { mem: 1 },
        maxPending: procPendingLimit,
        concurrency: resolvedProcConcurrency
      })
      : null;
    const queues = procQueue
      ? { io: ioQueue, cpu: cpuQueue, embedding: embeddingQueue, proc: procQueue }
      : { io: ioQueue, cpu: cpuQueue, embedding: embeddingQueue };
    return { queues, maxFilePending, maxIoPending, maxEmbeddingPending };
  }

  const queues = createTaskQueues({
    ioConcurrency,
    cpuConcurrency: effectiveCpuConcurrency,
    embeddingConcurrency,
    procConcurrency: resolvedProcConcurrency,
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
  codeDictWords,
  codeDictWordsByLanguage,
  codeDictLanguages,
  postingsConfig,
  treeSitterConfig,
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
      codeDictWords,
      codeDictWordsByLanguage,
      codeDictLanguages,
      postingsConfig,
      treeSitterConfig,
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
