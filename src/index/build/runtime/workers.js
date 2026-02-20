import os from 'node:os';
import { createSchedulerQueueAdapter, createTaskQueues } from '../../../shared/concurrency.js';
import { logLine } from '../../../shared/progress.js';
import { SCHEDULER_QUEUE_NAMES } from './scheduler.js';
import { resolveThreadLimits } from '../../../shared/threads.js';
import { createIndexerWorkerPools, resolveWorkerPoolConfig } from '../worker-pool.js';
import { resolveWorkerHeapBudgetPolicy } from '../workers/config.js';
import { createCrashLogger } from '../crash-log.js';

/**
 * Resolve runtime thread/concurrency limits from CLI, env, and config, and
 * emit advisory warnings when IO concurrency is likely to outpace libuv.
 *
 * @param {object} input
 * @param {object} input.argv
 * @param {string[]} input.rawArgv
 * @param {object} input.envConfig
 * @param {object} input.indexingConfig
 * @param {(line:string)=>void} [input.log]
 * @returns {{
 *   threadLimits:object,
 *   cpuCount:number,
 *   maxConcurrencyCap:number,
 *   fileConcurrency:number,
 *   importConcurrency:number,
 *   ioConcurrency:number,
 *   cpuConcurrency:number
 * }}
 */
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
    const warning =
      `[threads] ioConcurrency=${ioConcurrency} exceeds UV_THREADPOOL_SIZE=${effectiveUvThreadpoolSize}. `
      + 'Consider aligning runtime.uvThreadpoolSize/UV_THREADPOOL_SIZE with your I/O concurrency for best throughput.';
    if (typeof log === 'function') log(`[warn] ${warning}`);
    else logLine(warning, { kind: 'warning' });
  } else if (!effectiveUvThreadpoolSize && envConfig.verbose && ioConcurrency >= 16) {
    const warning =
      `[threads] ioConcurrency=${ioConcurrency} with default UV threadpool. `
      + 'Consider setting runtime.uvThreadpoolSize (or UV_THREADPOOL_SIZE) for I/O-heavy indexing.';
    if (typeof log === 'function') log(`[warn] ${warning}`);
    else logLine(warning, { kind: 'warning' });
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

/**
 * Resolve explicit memory budgets used by worker pools and stage write buffers.
 * The default policy reserves 1-2GB worker heaps and shifts additional
 * headroom to per-worker caches/write buffers when system RSS headroom exists.
 *
 * @param {object} input
 * @param {object} input.indexingConfig
 * @param {number} input.cpuConcurrency
 * @returns {{
 *   totalMemMb:number|null,
 *   maxGlobalRssMb:number|null,
 *   reserveRssMb:number,
 *   workerHeapPolicy:{targetPerWorkerMb:number,minPerWorkerMb:number,maxPerWorkerMb:number},
 *   perWorkerCacheMb:number,
 *   perWorkerWriteBufferMb:number,
 *   queueHeadroomScale:number
 * }}
 */
export const resolveRuntimeMemoryPolicy = ({ indexingConfig, cpuConcurrency }) => {
  const totalMemMb = Number.isFinite(Number(os.totalmem()))
    ? Math.floor(os.totalmem() / (1024 * 1024))
    : null;
  const memoryConfig = indexingConfig?.memory && typeof indexingConfig.memory === 'object'
    ? indexingConfig.memory
    : {};
  const workerHeapPolicy = resolveWorkerHeapBudgetPolicy({
    targetPerWorkerMb: memoryConfig.workerHeapTargetMb,
    minPerWorkerMb: memoryConfig.workerHeapMinMb,
    maxPerWorkerMb: memoryConfig.workerHeapMaxMb
  });
  const reserveRssMb = Number.isFinite(Number(memoryConfig.reserveRssMb))
    ? Math.max(512, Math.floor(Number(memoryConfig.reserveRssMb)))
    : 2048;
  const maxGlobalRssMb = Number.isFinite(totalMemMb) && totalMemMb > 0
    ? Math.max(2048, Math.floor(totalMemMb * 0.9))
    : null;
  const perWorkerCacheMb = Number.isFinite(Number(memoryConfig.perWorkerCacheMb))
    ? Math.max(64, Math.floor(Number(memoryConfig.perWorkerCacheMb)))
    : Math.max(128, Math.min(512, Math.floor(workerHeapPolicy.targetPerWorkerMb * 0.35)));
  const perWorkerWriteBufferMb = Number.isFinite(Number(memoryConfig.perWorkerWriteBufferMb))
    ? Math.max(64, Math.floor(Number(memoryConfig.perWorkerWriteBufferMb)))
    : Math.max(128, Math.min(768, Math.floor(workerHeapPolicy.targetPerWorkerMb * 0.45)));
  const workerCount = Number.isFinite(cpuConcurrency)
    ? Math.max(1, Math.floor(cpuConcurrency))
    : 1;
  const projectedBudgetMb = workerCount * (
    workerHeapPolicy.targetPerWorkerMb + perWorkerCacheMb + perWorkerWriteBufferMb
  );
  const queueHeadroomScale = Number.isFinite(maxGlobalRssMb) && maxGlobalRssMb > 0
    ? (projectedBudgetMb < Math.max(512, maxGlobalRssMb - reserveRssMb) ? 3 : 2)
    : 2;
  return {
    totalMemMb,
    maxGlobalRssMb,
    reserveRssMb,
    workerHeapPolicy,
    perWorkerCacheMb,
    perWorkerWriteBufferMb,
    queueHeadroomScale
  };
};

/**
 * Create stage runtime queues with bounded pending windows.
 *
 * Scheduler-backed adapters are preferred when available; otherwise plain
 * in-process queues are used. Pending limits intentionally stay conservative to
 * cap out-of-order buffering pressure and avoid transient memory spikes.
 *
 * @param {object} options
 * @param {number} options.ioConcurrency
 * @param {number} options.cpuConcurrency
 * @param {number} options.fileConcurrency
 * @param {number} options.embeddingConcurrency
 * @param {object|null} options.pendingLimits
 * @param {object|null} options.scheduler
 * @param {object|null} [options.stage1Queues]
 * @param {number|null} [options.procConcurrency]
 * @returns {{queues:object,maxFilePending:number,maxIoPending:number,maxEmbeddingPending:number}}
 */
export const createRuntimeQueues = ({
  ioConcurrency,
  cpuConcurrency,
  fileConcurrency,
  embeddingConcurrency,
  pendingLimits,
  scheduler,
  stage1Queues = null,
  procConcurrency = null,
  memoryPolicy = null
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
  const schedulerAdaptive = scheduler
    && scheduler.enabled
    && scheduler.lowResourceMode !== true;
  const memoryPendingScale = Number.isFinite(Number(memoryPolicy?.queueHeadroomScale))
    ? Math.max(1, Math.floor(Number(memoryPolicy.queueHeadroomScale)))
    : 1;
  const pendingScale = schedulerAdaptive
    ? Math.max(2, memoryPendingScale)
    : memoryPendingScale;
  const maxFilePending = coercePositiveInt(tokenizeConfig?.maxPending)
    ?? (Number.isFinite(pendingLimits?.cpu?.maxPending)
      ? pendingLimits.cpu.maxPending
      : Math.max(64, effectiveCpuConcurrency * 8 * pendingScale));
  const maxIoPending = Number.isFinite(pendingLimits?.io?.maxPending)
    ? pendingLimits.io.maxPending
    : Math.max(16, ioConcurrency * 4 * pendingScale);
  const effectiveEmbeddingConcurrency = Number.isFinite(embeddingConcurrency) && embeddingConcurrency > 0
    ? embeddingConcurrency
    : Math.max(1, Math.min(cpuConcurrency || 1, fileConcurrency || 1));
  const maxEmbeddingPending = Number.isFinite(pendingLimits?.embedding?.maxPending)
    ? pendingLimits.embedding.maxPending
    : Math.max(64, effectiveEmbeddingConcurrency * 8 * pendingScale);
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
    for (const queue of Object.values(queues)) {
      queue.inflightBytes = 0;
    }
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
  for (const queue of Object.values(queues)) {
    queue.inflightBytes = 0;
  }
  return { queues, maxFilePending, maxIoPending, maxEmbeddingPending };
};

/**
 * Resolve worker-pool runtime config by combining queue-derived concurrency
 * targets with user/env worker-pool overrides.
 *
 * @param {object} input
 * @param {object} input.indexingConfig
 * @param {object} input.envConfig
 * @param {number} input.cpuConcurrency
 * @param {number} input.fileConcurrency
 * @returns {object}
 */
export const resolveWorkerPoolRuntimeConfig = ({ indexingConfig, envConfig, cpuConcurrency, fileConcurrency }) => {
  const cpuTarget = Number.isFinite(cpuConcurrency)
    ? Math.max(1, Math.floor(cpuConcurrency))
    : 1;
  const fileTarget = Number.isFinite(fileConcurrency)
    ? Math.max(1, Math.floor(fileConcurrency))
    : cpuTarget;
  const dynamicHardMaxWorkers = Math.max(
    32,
    cpuTarget,
    fileTarget
  );
  const oversubscribeTarget = Math.max(cpuTarget, Math.min(32, cpuTarget * 2));
  const fileBoundTarget = Math.max(cpuTarget, Math.min(32, fileTarget));
  const workerPoolDefaultMax = Math.max(
    1,
    Math.min(dynamicHardMaxWorkers, Math.max(oversubscribeTarget, fileBoundTarget))
  );
  return resolveWorkerPoolConfig(
    indexingConfig.workerPool || {},
    envConfig,
    {
      cpuLimit: cpuConcurrency,
      defaultMaxWorkers: workerPoolDefaultMax,
      hardMaxWorkers: dynamicHardMaxWorkers
    }
  );
};

/**
 * Instantiate worker pools (tokenize and optional quantize) and wire crash
 * logging so pool failures are captured in repo cache diagnostics.
 *
 * @param {object} input
 * @param {object} input.workerPoolConfig
 * @param {string} input.repoCacheRoot
 * @param {Set<string>} input.dictWords
 * @param {object|null} input.dictSharedPayload
 * @param {object} input.dictConfig
 * @param {Set<string>|null} input.codeDictWords
 * @param {Map<string,Set<string>>|object|null} input.codeDictWordsByLanguage
 * @param {Set<string>|string[]|null} input.codeDictLanguages
 * @param {object} input.postingsConfig
 * @param {object} input.treeSitterConfig
 * @param {boolean} input.debugCrash
 * @param {(line:string)=>void} input.log
 * @returns {Promise<{workerPools:object,workerPool:object|null,quantizePool:object|null}>}
 */
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
      if (workerPool.heapPolicy) {
        log(
          `Worker heap policy: target=${workerPool.heapPolicy.targetPerWorkerMb}MB ` +
          `(min=${workerPool.heapPolicy.minPerWorkerMb}MB, max=${workerPool.heapPolicy.maxPerWorkerMb}MB).`
        );
      }
      if (workerPoolConfig.enabled === 'auto') {
        log(`Worker pool auto threshold: maxFileBytes=${workerPoolConfig.maxFileBytes}.`);
      }
    } else {
      log('Worker pool disabled (fallback to main thread).');
    }
  }

  return { workerPools, workerPool, quantizePool };
};
