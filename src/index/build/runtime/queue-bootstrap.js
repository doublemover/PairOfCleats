import { createBuildScheduler } from '../../../shared/concurrency.js';
import { isPlainObject, mergeConfig } from '../../../shared/config.js';
import { loadSchedulerAutoTuneProfile } from './scheduler-autotune-profile.js';
import { resolveSchedulerConfig } from './scheduler.js';
import { resolveStage1Queues } from './queues.js';
import {
  createRuntimeQueues,
  resolveRuntimeMemoryPolicy,
  resolveWorkerPoolRuntimeConfig
} from './workers.js';

/**
 * Load scheduler auto-tune profile ahead of scheduler construction.
 *
 * @param {{repoCacheRoot:string,log:(line:string)=>void}} input
 * @returns {Promise<object|null>}
 */
export const prefetchSchedulerAutoTuneProfile = ({ repoCacheRoot, log }) => (
  loadSchedulerAutoTuneProfile({
    repoCacheRoot,
    log: (line) => log(line)
  })
);

/**
 * Normalize envelope concurrency fields into runtime-friendly primitives.
 *
 * @param {object} envelope
 * @returns {{
 *   cpuCount:number,
 *   maxConcurrencyCap:number,
 *   fileConcurrency:number,
 *   importConcurrency:number,
 *   ioConcurrency:number,
 *   cpuConcurrency:number
 * }}
 */
export const resolveRuntimeConcurrency = (envelope) => ({
  cpuCount: envelope.concurrency.cpuCount,
  maxConcurrencyCap: envelope.concurrency.maxConcurrencyCap,
  fileConcurrency: envelope.concurrency.fileConcurrency.value,
  importConcurrency: envelope.concurrency.importConcurrency.value,
  ioConcurrency: envelope.concurrency.ioConcurrency.value,
  cpuConcurrency: envelope.concurrency.cpuConcurrency.value
});

/**
 * Build scheduler + stage1 queue policy from envelope/config inputs.
 *
 * Sequencing contract:
 * - This phase runs after envelope resolution because scheduler defaults depend
 *   on envelope-derived concurrency.
 * - The returned `stage1Queues` and `scheduler` must be reused for later queue
 *   assembly; recomputing them after worker/embedding setup can desynchronize
 *   pending limits and scheduling tokens.
 *
 * @param {{
 *   argv:object,
 *   rawArgv:string[]|undefined,
 *   envConfig:object,
 *   indexingConfig:object,
 *   runtimeConfig:object|null,
 *   envelope:object,
 *   repoCacheRoot:string,
 *   log:(line:string)=>void,
 *   schedulerAutoTuneProfilePromise?:Promise<object|null>|null
 * }} input
 * @returns {Promise<{
 *   preRuntimeMemoryPolicy:object,
 *   schedulerConfig:object,
 *   scheduler:object,
 *   stage1Queues:object,
 *   schedulerAutoTuneProfile:object|null
 * }>}
 */
export const createRuntimeSchedulerSetup = async ({
  argv,
  rawArgv,
  envConfig,
  indexingConfig,
  runtimeConfig,
  envelope,
  repoCacheRoot,
  log,
  schedulerAutoTuneProfilePromise = null
}) => {
  const preRuntimeMemoryPolicy = resolveRuntimeMemoryPolicy({
    indexingConfig,
    cpuConcurrency: envelope?.concurrency?.cpuConcurrency?.value
  });
  const schedulerAutoTuneProfile = schedulerAutoTuneProfilePromise
    ? await schedulerAutoTuneProfilePromise
    : await prefetchSchedulerAutoTuneProfile({ repoCacheRoot, log });
  const schedulerConfig = resolveSchedulerConfig({
    argv,
    rawArgv,
    envConfig,
    indexingConfig,
    runtimeConfig,
    envelope,
    autoTuneProfile: schedulerAutoTuneProfile
  });
  const scheduler = createBuildScheduler({
    enabled: schedulerConfig.enabled,
    lowResourceMode: schedulerConfig.lowResourceMode,
    cpuTokens: schedulerConfig.cpuTokens,
    ioTokens: schedulerConfig.ioTokens,
    memoryTokens: schedulerConfig.memoryTokens,
    adaptive: schedulerConfig.adaptive,
    adaptiveTargetUtilization: schedulerConfig.adaptiveTargetUtilization,
    adaptiveStep: schedulerConfig.adaptiveStep,
    adaptiveMemoryReserveMb: Math.max(
      schedulerConfig.adaptiveMemoryReserveMb,
      preRuntimeMemoryPolicy?.reserveRssMb || 0
    ),
    adaptiveMemoryPerTokenMb: schedulerConfig.adaptiveMemoryPerTokenMb,
    maxCpuTokens: schedulerConfig.maxCpuTokens,
    maxIoTokens: schedulerConfig.maxIoTokens,
    maxMemoryTokens: schedulerConfig.maxMemoryTokens,
    starvationMs: schedulerConfig.starvationMs,
    queues: schedulerConfig.queues,
    writeBackpressure: schedulerConfig.writeBackpressure,
    adaptiveSurfaces: schedulerConfig.adaptiveSurfaces
  });
  const stage1Queues = resolveStage1Queues(indexingConfig);
  return {
    preRuntimeMemoryPolicy,
    schedulerConfig,
    scheduler,
    stage1Queues,
    schedulerAutoTuneProfile
  };
};

/**
 * Finalize queue and worker-pool setup after embedding runtime selection.
 *
 * Sequencing contract:
 * - Call after `createRuntimeSchedulerSetup()` and after embedding runtime has
 *   resolved `embeddingConcurrency`.
 * - Use returned `indexingConfig` for all downstream reads; this step may inject
 *   worker heap defaults derived from memory policy when missing in config.
 *
 * @param {{
 *   indexingConfig:object,
 *   envConfig:object,
 *   envelope:object,
 *   scheduler:object|null,
 *   stage1Queues:object|null,
 *   embeddingConcurrency:number
 * }} input
 * @returns {{
 *   indexingConfig:object,
 *   runtimeMemoryPolicy:object,
 *   workerPoolConfig:object,
 *   procConcurrency:number|null,
 *   queues:object,
 *   cpuCount:number,
 *   maxConcurrencyCap:number,
 *   fileConcurrency:number,
 *   importConcurrency:number,
 *   ioConcurrency:number,
 *   cpuConcurrency:number
 * }}
 */
export const resolveRuntimeQueueSetup = ({
  indexingConfig,
  envConfig,
  envelope,
  scheduler,
  stage1Queues,
  embeddingConcurrency
}) => {
  const {
    cpuCount,
    maxConcurrencyCap,
    fileConcurrency,
    importConcurrency,
    ioConcurrency,
    cpuConcurrency
  } = resolveRuntimeConcurrency(envelope);

  const runtimeMemoryPolicy = resolveRuntimeMemoryPolicy({
    indexingConfig,
    cpuConcurrency
  });
  const rawWorkerPoolConfig = isPlainObject(indexingConfig.workerPool)
    ? indexingConfig.workerPool
    : {};
  let nextIndexingConfig = indexingConfig;
  if (
    rawWorkerPoolConfig.heapTargetMb == null
    || rawWorkerPoolConfig.heapMinMb == null
    || rawWorkerPoolConfig.heapMaxMb == null
  ) {
    nextIndexingConfig = mergeConfig(nextIndexingConfig, {
      workerPool: {
        ...(rawWorkerPoolConfig.heapTargetMb == null
          ? { heapTargetMb: runtimeMemoryPolicy.workerHeapPolicy.targetPerWorkerMb }
          : {}),
        ...(rawWorkerPoolConfig.heapMinMb == null
          ? { heapMinMb: runtimeMemoryPolicy.workerHeapPolicy.minPerWorkerMb }
          : {}),
        ...(rawWorkerPoolConfig.heapMaxMb == null
          ? { heapMaxMb: runtimeMemoryPolicy.workerHeapPolicy.maxPerWorkerMb }
          : {})
      }
    });
  }

  const workerPoolConfig = resolveWorkerPoolRuntimeConfig({
    indexingConfig: nextIndexingConfig,
    envConfig,
    cpuConcurrency,
    fileConcurrency
  });
  const procConcurrencyCap = Number.isFinite(fileConcurrency)
    ? Math.max(
      Math.max(1, Math.floor(cpuConcurrency || 1)),
      Math.floor(fileConcurrency / 2)
    )
    : Math.max(1, Math.floor(cpuConcurrency || 1));
  const procConcurrency = workerPoolConfig?.enabled !== false && Number.isFinite(workerPoolConfig?.maxWorkers)
    ? Math.max(1, Math.min(procConcurrencyCap, Math.floor(workerPoolConfig.maxWorkers)))
    : null;
  const queueConfig = createRuntimeQueues({
    ioConcurrency,
    cpuConcurrency,
    fileConcurrency,
    embeddingConcurrency,
    pendingLimits: envelope.queues,
    scheduler,
    stage1Queues,
    procConcurrency,
    memoryPolicy: runtimeMemoryPolicy
  });

  return {
    indexingConfig: nextIndexingConfig,
    runtimeMemoryPolicy,
    workerPoolConfig,
    procConcurrency,
    queues: queueConfig.queues,
    cpuCount,
    maxConcurrencyCap,
    fileConcurrency,
    importConcurrency,
    ioConcurrency,
    cpuConcurrency
  };
};
