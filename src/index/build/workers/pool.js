import { IndexerProcessPool, getProcessMemoryAccount } from './process-pool.js';
import { readEffectiveMemory } from '../../../shared/effective-memory.js';
import { resolveWorkerHeapLaunchContract } from '../../../shared/workers/heap-contract.js';
import { isAbortError, throwIfAborted } from '../../../shared/abort.js';
import { createLifecycleRegistry } from '../../../shared/lifecycle/registry.js';
import os from 'node:os';
import util from 'node:util';
import { fileURLToPath } from 'node:url';
import { log as defaultLog } from '../../../shared/progress-runtime.js';
import {
  incWorkerRetries,
  observeWorkerTaskDuration,
  setStageGcPressure,
  setWorkerActiveTasks,
  setWorkerGcPressure,
  setWorkerQueueDepth
} from '../../../shared/metrics/core.js';
import {
  buildWorkerExecArgv,
  resolveMemoryWorkerCap,
  resolveWorkerHeapBudgetPolicy,
  resolveWorkerResourceLimits,
  shouldDownscaleWorkersForPressure
} from './config.js';
import { sanitizePoolPayload, sanitizeQuantizePayload, summarizeError } from './protocol.js';
import {
  clampRatio,
  evictDeterministicPressureCacheEntries,
  normalizeLanguageId,
  resolveLanguageThrottleLimit,
  resolveMemoryPressureState
} from './pool/pressure-controls.js';
import { resolveNumaPinningPlan } from './pool/numa-plan.js';
import { createWorkerPoolQueue } from './pool/queue.js';
import { createWorkerPoolLifecycle } from './pool/lifecycle.js';
import { createWorkerProcessCoordinator } from './pool/worker-coordination.js';
import {
  resolveBuildCleanupTimeoutMs,
  runBuildCleanupWithTimeout
} from '../cleanup-timeout.js';
import {
  buildQuantizeRunPayload,
  normalizeCodeDictLanguages,
  normalizeStringArray,
  sanitizeDictConfig,
  sanitizeTreeSitterConfig,
  serializeCodeDictWordsByLanguage
} from './pool/payload.js';
import { createWorkerPoolMetaHelpers } from './pool/meta.js';

export {
  resolveMemoryPressureState,
  resolveLanguageThrottleLimit,
  evictDeterministicPressureCacheEntries
};

export const destroyWorkerPoolLifecycleWithTimeout = async ({
  lifecycle,
  poolLabel = 'tokenize',
  timeoutMs = null,
  log = defaultLog
} = {}) => {
  const result = await runBuildCleanupWithTimeout({
    label: `worker-pool.${poolLabel}.lifecycle-destroy`,
    cleanup: () => lifecycle?.destroy?.(),
    timeoutMs,
    log
  });
  if (!result.timedOut || typeof lifecycle?.forceDestroy !== 'function') return result;
  // A timeout only abandons the wait. It does not stop a worker. Escalate via
  // the same lifecycle owner so existing Piscina termination is actually run.
  await lifecycle.forceDestroy();
  return { ...result, pending: false, forced: true };
};

/**
 * Create a single indexer worker pool with crash logging, restart handling,
 * and task-level instrumentation.
 *
 * @param {object} [input]
 * @param {object} input.config
 * @param {Set<string>} [input.dictWords]
 * @param {object|null} [input.dictSharedPayload]
 * @param {object} [input.dictConfig]
 * @param {Set<string>|null} [input.codeDictWords]
 * @param {Map<string,Set<string>>|object|null} [input.codeDictWordsByLanguage]
 * @param {Set<string>|string[]|null} [input.codeDictLanguages]
 * @param {object} [input.postingsConfig]
 * @param {object} [input.treeSitterConfig]
 * @param {object|null} [input.memoryPolicy]
 * @param {object|null} [input.crashLogger]
 * @param {(line:string)=>void} [input.log]
 * @param {string} [input.stage]
 * @param {'tokenize'|'quantize'|string} [input.poolName]
 * @returns {Promise<object|null>}
 */
export async function createIndexerWorkerPool(input = {}) {
  const {
    config,
    dictWords,
    dictSharedPayload,
    dictConfig,
    codeDictWords,
    codeDictWordsByLanguage,
    codeDictLanguages,
    postingsConfig,
    treeSitterConfig,
    memoryPolicy = null,
    crashLogger = null,
    log = defaultLog,
    stage = 'stage1',
    poolName = 'tokenize'
  } = input;
  const poolLabel = typeof poolName === 'string' && poolName.trim()
    ? poolName.trim().toLowerCase()
    : 'tokenize';
  const memoryCappedMax = resolveMemoryWorkerCap(config?.maxWorkers, { memorySnapshot: memoryPolicy?.effectiveMemory, heapTargetMb: config?.heapTargetMb });
  const poolConfig = Number.isFinite(memoryCappedMax) && memoryCappedMax > 0
    ? { ...config, maxWorkers: memoryCappedMax }
    : config;
  const resolvedCleanupTimeoutMs = resolveBuildCleanupTimeoutMs(poolConfig?.cleanupTimeoutMs);
  if (config?.maxWorkers && poolConfig?.maxWorkers && config.maxWorkers !== poolConfig.maxWorkers) {
    log(`Worker pool capped to ${poolConfig.maxWorkers} threads based on host memory.`);
  }
  const dictWordsForPool = poolLabel === 'quantize' ? [] : dictWords;
  const dictSharedForPool = poolLabel === 'quantize' ? null : dictSharedPayload;
  const codeDictWordsForPool = poolLabel === 'quantize' ? null : codeDictWords;
  const codeDictWordsByLanguageForPool = poolLabel === 'quantize' ? null : codeDictWordsByLanguage;
  const codeDictLanguagesForPool = poolLabel === 'quantize' ? null : codeDictLanguages;

  if (!poolConfig || poolConfig.enabled === false) return null;
  let Piscina;
  try {
    Piscina = (await import('piscina')).default;
  } catch (err) {
    log(`Worker pool unavailable (piscina missing): ${err?.message || err}`);
    return null;
  }
  const maxRestartAttempts = 3;
  const restartBaseDelayMs = 5000;
  const restartMaxDelayMs = 10000;
  let lifecycle = null;
  try {
    const configuredMaxWorkers = Number.isFinite(poolConfig?.maxWorkers)
      ? Math.max(1, Math.floor(poolConfig.maxWorkers))
      : 1;
    const autoDownscaleOnPressure = poolConfig?.autoDownscaleOnPressure !== false;
    const downscaleMinWorkers = Number.isFinite(poolConfig?.downscaleMinWorkers)
      ? Math.max(1, Math.min(configuredMaxWorkers, Math.floor(poolConfig.downscaleMinWorkers)))
      : Math.max(1, Math.floor(configuredMaxWorkers * 0.5));
    const downscaleRssThreshold = Number.isFinite(poolConfig?.downscaleRssThreshold)
      ? Math.max(0.5, Math.min(0.99, Number(poolConfig.downscaleRssThreshold)))
      : 0.95;
    const downscaleGcThreshold = Number.isFinite(poolConfig?.downscaleGcThreshold)
      ? Math.max(0.5, Math.min(0.99, Number(poolConfig.downscaleGcThreshold)))
      : 0.92;
    const downscaleCooldownMs = Number.isFinite(poolConfig?.downscaleCooldownMs)
      ? Math.max(1000, Math.floor(Number(poolConfig.downscaleCooldownMs)))
      : 15000;
    const upscaleCooldownMs = Number.isFinite(poolConfig?.upscaleCooldownMs)
      ? Math.max(1000, Math.floor(Number(poolConfig.upscaleCooldownMs)))
      : Math.max(1000, downscaleCooldownMs);
    const upscaleRssThreshold = Number.isFinite(poolConfig?.upscaleRssThreshold)
      ? Math.max(0.4, Math.min(downscaleRssThreshold, Number(poolConfig.upscaleRssThreshold)))
      : Math.max(0.4, downscaleRssThreshold - 0.1);
    const upscaleGcThreshold = Number.isFinite(poolConfig?.upscaleGcThreshold)
      ? Math.max(0.4, Math.min(downscaleGcThreshold, Number(poolConfig.upscaleGcThreshold)))
      : Math.max(0.4, downscaleGcThreshold - 0.1);
    const memoryPressureConfig = poolConfig?.memoryPressure
      && typeof poolConfig.memoryPressure === 'object'
      ? poolConfig.memoryPressure
      : {};
    const pressureWatermarkSoft = Number.isFinite(Number(memoryPressureConfig?.watermarkSoft))
      ? clampRatio(memoryPressureConfig.watermarkSoft)
      : 0.985;
    const pressureWatermarkHard = Number.isFinite(Number(memoryPressureConfig?.watermarkHard))
      ? Math.max(pressureWatermarkSoft, clampRatio(memoryPressureConfig.watermarkHard))
      : Math.max(pressureWatermarkSoft, 0.995);
    const pressureCacheMaxEntries = Number.isFinite(Number(memoryPressureConfig?.cacheMaxEntries))
      ? Math.max(1, Math.floor(Number(memoryPressureConfig.cacheMaxEntries)))
      : 2048;
    const rawLanguageThrottle = memoryPressureConfig?.languageThrottle
      && typeof memoryPressureConfig.languageThrottle === 'object'
      ? memoryPressureConfig.languageThrottle
      : {};
    const throttleHeavyLanguageSet = new Set(
      Array.isArray(rawLanguageThrottle?.heavyLanguages)
        ? rawLanguageThrottle.heavyLanguages.map((entry) => normalizeLanguageId(entry)).filter(Boolean)
        : []
    );
    const languageThrottleSoftMax = Number.isFinite(Number(rawLanguageThrottle?.softMaxPerLanguage))
      ? Math.max(1, Math.floor(Number(rawLanguageThrottle.softMaxPerLanguage)))
      : Math.max(3, Math.min(configuredMaxWorkers, Math.max(6, Math.floor(configuredMaxWorkers * 0.9))));
    const languageThrottleHardMax = Number.isFinite(Number(rawLanguageThrottle?.hardMaxPerLanguage))
      ? Math.max(0, Math.floor(Number(rawLanguageThrottle.hardMaxPerLanguage)))
      : Math.max(2, Math.floor(languageThrottleSoftMax * 0.5));
    const languageThrottleConfig = {
      enabled: rawLanguageThrottle?.enabled !== false,
      heavyLanguages: throttleHeavyLanguageSet,
      softMaxPerLanguage: languageThrottleSoftMax,
      hardMaxPerLanguage: Math.min(languageThrottleSoftMax, languageThrottleHardMax),
      blockHeavyOnHardPressure: rawLanguageThrottle?.blockHeavyOnHardPressure !== false
    };

    let activeTasks = 0;
    let quantizeTypedTempBuffers = 0;

    const workerExecArgv = buildWorkerExecArgv();
    const heapPolicy = resolveWorkerHeapBudgetPolicy({
      targetPerWorkerMb: poolConfig.heapTargetMb,
      minPerWorkerMb: poolConfig.heapMinMb,
      maxPerWorkerMb: poolConfig.heapMaxMb
    });
    const resolveResourceLimitsForWorkers = (maxWorkers) => resolveWorkerResourceLimits(maxWorkers, {
      targetPerWorkerMb: heapPolicy.targetPerWorkerMb,
      minPerWorkerMb: heapPolicy.minPerWorkerMb,
      maxPerWorkerMb: heapPolicy.maxPerWorkerMb,
      memorySnapshot: memoryPolicy?.effectiveMemory
    });
    let currentResourceLimits = resolveResourceLimitsForWorkers(configuredMaxWorkers);
    let heapLaunchContract = resolveWorkerHeapLaunchContract(currentResourceLimits);
    const reportHeapContract = () => input.onRuntimeEvidence?.({
      pool: poolLabel, configuredMaxWorkers, heapLaunchContract,
      observedAt: new Date().toISOString()
    });
    const processBackend = !heapLaunchContract.supported && poolConfig.processFallback === true;
    reportHeapContract();
    if (!heapLaunchContract.supported && !processBackend) {
      log(`Worker pool ${poolLabel} disabled: ${heapLaunchContract.reason}; requested old-generation=${heapLaunchContract.requestedOldGenerationSizeMb}MB, parent startup=${heapLaunchContract.parentStartupOldSpaceMb ?? 'unknown'}MB. Using inline fallback; worker heap enforcement is unavailable.`);
      return null;
    }
    const serializedDictWords = dictSharedForPool?.bytes && dictSharedForPool?.offsets
      ? []
      : normalizeStringArray(dictWordsForPool);
    const serializedCodeDictWords = normalizeStringArray(codeDictWordsForPool);
    const serializedCodeDictByLanguage = serializeCodeDictWordsByLanguage(codeDictWordsByLanguageForPool);
    const serializedCodeDictLanguages = normalizeCodeDictLanguages(codeDictLanguagesForPool);
    const hasCodeDictLangs = codeDictLanguagesForPool != null;
    const serializedTreeSitterPayload = sanitizeTreeSitterConfig(treeSitterConfig);
    const normalizedStage = typeof stage === 'string' && stage.trim()
      ? stage.trim().toLowerCase()
      : 'unknown';
    const maxGlobalRssBytes = Number.isFinite(Number(memoryPolicy?.maxGlobalRssMb))
      ? Math.max(1, Math.floor(Number(memoryPolicy.maxGlobalRssMb) * 1024 * 1024))
      : Math.max(1, Math.floor(Number(readEffectiveMemory().totalBytes || 0) * 0.9));

    const {
      workerTaskMetricPool,
      tokenizePayloadMetaPool,
      quantizePayloadMetaPool,
      crashPayloadMetaPool,
      withPooledPayloadMeta,
      assignTokenizePayloadMeta,
      assignQuantizePayloadMeta
    } = createWorkerPoolMetaHelpers();

    const queueController = createWorkerPoolQueue({
      log,
      pressureWatermarkSoft,
      pressureWatermarkHard,
      pressureCacheMaxEntries,
      languageThrottleConfig,
      maxGlobalRssBytes,
      readOwnedRssBytes: () => process.memoryUsage().rss + (lifecycle?.getPool()?.stats?.().sampledChildRssBytes || 0)
    });

    const workerCoordinator = createWorkerProcessCoordinator({
      poolLabel,
      normalizedStage,
      crashLogger,
      log,
      summarizeError,
      withPooledPayloadMeta,
      workerTaskMetricPool,
      crashPayloadMetaPool,
      observeWorkerTaskDuration,
      setStageGcPressure,
      setWorkerGcPressure,
      readProcessPressureSample: queueController.readProcessPressureSample,
      updatePressureState: queueController.updatePressureState,
      onRuntimeObservation: (observation) => {
        if (observation.resourceLimitAcknowledged === false && lifecycle) {
          void lifecycle.disablePermanently('worker heap acknowledgement rejected').catch(() => {});
        }
      },
      maybeReduceWorkersOnPressure: async (sample) => {
        if (!lifecycle) return;
        await lifecycle.maybeReduceWorkersOnPressure(sample);
      }
    });

    const createPool = (maxWorkers) => {
      currentResourceLimits = resolveResourceLimitsForWorkers(maxWorkers);
      heapLaunchContract = resolveWorkerHeapLaunchContract(currentResourceLimits);
      reportHeapContract();
      if (!heapLaunchContract.supported && !processBackend) throw new Error(`Worker heap bound is not enforceable: ${heapLaunchContract.reason}`);
      const numaPinningPlan = processBackend ? { active: false, reason: 'process-backend-no-thread-NUMA-claim',
        strategy: 'interleave', nodeCount: 1, assignments: [] } : resolveNumaPinningPlan({
        config: poolConfig,
        maxWorkers
      });
      workerCoordinator.setNumaPinningPlan(numaPinningPlan);
      const workerData = {
        runtimeAttemptId: typeof input.runtimeAttemptId === 'string' ? input.runtimeAttemptId.slice(0, 128) : null,
        buildId: typeof input.buildId === 'string' ? input.buildId.slice(0, 2048) : null,
        dictConfig: sanitizeDictConfig(dictConfig),
        postingsConfig: postingsConfig || {},
        numaPinning: numaPinningPlan.active
          ? {
            active: true,
            strategy: numaPinningPlan.strategy,
            nodeCount: numaPinningPlan.nodeCount,
            assignments: Array.isArray(numaPinningPlan.assignments)
              ? Array.from(numaPinningPlan.assignments)
              : []
          }
          : {
            active: false,
            reason: numaPinningPlan.reason || 'disabled'
          }
      };
      if (dictSharedForPool?.bytes && dictSharedForPool?.offsets) {
        workerData.dictShared = dictSharedForPool;
      } else if (serializedDictWords.length) {
        workerData.dictWords = serializedDictWords;
      }
      if (serializedCodeDictWords.length) {
        workerData.codeDictWords = serializedCodeDictWords;
      }
      if (serializedCodeDictByLanguage) {
        workerData.codeDictWordsByLanguage = serializedCodeDictByLanguage;
      }
      if (hasCodeDictLangs || serializedCodeDictLanguages.length) {
        workerData.codeDictLanguages = serializedCodeDictLanguages;
      }
      if (serializedTreeSitterPayload) {
        workerData.treeSitter = serializedTreeSitterPayload;
      }
      if (processBackend) {
        return new IndexerProcessPool({ maxThreads: maxWorkers,
          oldSpaceMb: currentResourceLimits.maxOldGenerationSizeMb, workerData,
          taskTimeout: poolConfig.taskTimeoutMs, maxRestartAttempts,
          budgetAccount: getProcessMemoryAccount(memoryPolicy),
          maxMessageBytes: Math.max(4096, Math.min(32 * 1024 * 1024, Math.floor(maxGlobalRssBytes * 0.025))) });
      }
      return new Piscina({
        filename: fileURLToPath(new URL('./indexer-worker.js', import.meta.url)),
        maxThreads: maxWorkers,
        idleTimeout: poolConfig.idleTimeoutMs,
        taskTimeout: poolConfig.taskTimeoutMs,
        recordTiming: true,
        execArgv: workerExecArgv,
        ...(currentResourceLimits ? { resourceLimits: currentResourceLimits } : {}),
        workerData
      });
    };

    lifecycle = createWorkerPoolLifecycle({
      log,
      poolLabel,
      summarizeError,
      maxRestartAttempts,
      restartBaseDelayMs,
      restartMaxDelayMs,
      configuredMaxWorkers,
      autoDownscaleOnPressure,
      downscaleMinWorkers,
      downscaleRssThreshold,
      downscaleGcThreshold,
      downscaleCooldownMs,
      upscaleCooldownMs,
      upscaleRssThreshold,
      upscaleGcThreshold,
      shouldDownscaleWorkersForPressure,
      getActiveTasks: () => activeTasks,
      incWorkerRetries,
      cleanupTimeoutMs: poolConfig?.cleanupTimeoutMs,
      createPool,
      attachPoolListeners: workerCoordinator.attachPoolListeners
    });

    let lastReportedQueueSize = null;
    let lastReportedActiveTasks = null;
    const updatePoolMetrics = () => {
      const pool = lifecycle.getPool();
      if (!pool) return;
      const queueSize = Number.isFinite(pool.queueSize) ? pool.queueSize : 0;
      if (queueSize !== lastReportedQueueSize) {
        lastReportedQueueSize = queueSize;
        setWorkerQueueDepth({ pool: poolLabel, value: queueSize });
      }
      if (activeTasks !== lastReportedActiveTasks) {
        lastReportedActiveTasks = activeTasks;
        setWorkerActiveTasks({ pool: poolLabel, value: activeTasks });
      }
    };

    lifecycle.initialize();
    if (poolConfig?.numaPinning?.enabled === true) {
      const numaPinningPlan = workerCoordinator.getNumaPlan();
      if (numaPinningPlan.active) {
        log(
          `Worker pool NUMA pinning active (${poolLabel}): strategy=${numaPinningPlan.strategy}, ` +
          `nodes=${numaPinningPlan.nodeCount}, workers=${lifecycle.getEffectiveMaxWorkers()}.`
        );
      } else {
        log(
          `Worker pool NUMA pinning not active (${poolLabel}): ${numaPinningPlan.reason || 'disabled'}.`
        );
      }
    }
    updatePoolMetrics();

    const classifyWorkerRunError = (err) => {
      const detail = summarizeError(err);
      const opaqueFailure = !detail || detail === 'Error';
      const errorName = err?.name || '';
      const loweredName = errorName.toLowerCase();
      const isCloneError = loweredName.includes('dataclone')
        || loweredName.includes('datacloneerror')
        || loweredName.includes('dataclone');
      const reason = detail || err?.message || String(err);
      return { detail, opaqueFailure, isCloneError, reason };
    };

    const formatWorkerNestedError = (err) => ({
      message: err?.message || String(err),
      stack: err?.stack || null,
      name: err?.name || null,
      code: err?.code || null,
      raw: util.inspect(err, { depth: 3, breakLength: 120, showHidden: true, getters: true })
    });

    const logWorkerPoolUnavailable = ({
      payload,
      payloadMetaPool,
      assignPayloadMeta,
      phase,
      task
    }) => {
      if (!crashLogger?.enabled) return;
      withPooledPayloadMeta(payloadMetaPool, (meta) => {
        assignPayloadMeta(meta, payload);
      }, (payloadMeta) => {
        crashLogger.logError({
          phase,
          message: 'worker pool unavailable',
          stack: null,
          name: 'Error',
          code: null,
          task,
          payloadMeta: payload ? payloadMeta : null
        });
      });
    };

    const logWorkerTaskError = ({
      payload,
      payloadMetaPool,
      assignPayloadMeta,
      phase,
      task,
      message,
      err
    }) => {
      if (!crashLogger?.enabled) return;
      withPooledPayloadMeta(payloadMetaPool, (meta) => {
        assignPayloadMeta(meta, payload);
      }, (payloadMeta) => {
        crashLogger.logError({
          phase,
          message,
          stack: err?.stack || null,
          name: err?.name || null,
          code: err?.code || null,
          task,
          payloadMeta: payload ? payloadMeta : null,
          raw: util.inspect(err, { depth: 4, breakLength: 120, showHidden: true, getters: true }),
          errors: Array.isArray(err?.errors)
            ? err.errors.map((inner) => formatWorkerNestedError(inner))
            : null,
          cause: err?.cause ? formatWorkerNestedError(err.cause) : null
        });
      });
    };

    const handleWorkerTaskError = async ({
      err,
      payload,
      payloadMetaPool,
      assignPayloadMeta,
      phase,
      task,
      preferDetailMessage = false
    }) => {
      const { detail, opaqueFailure, isCloneError, reason } = classifyWorkerRunError(err);
      if (isCloneError) {
        await lifecycle.disablePermanently(reason || 'data-clone error');
      } else if (opaqueFailure) {
        await lifecycle.disablePermanently(reason || 'worker failure');
      } else {
        await lifecycle.scheduleRestart(reason);
      }
      // Existing pressure waiters also belong to an unrecoverable pool. Let
      // them release active counters so its idle shutdown can finish.
      if (lifecycle.isPermanentlyDisabled()) queueController.close();
      logWorkerTaskError({
        payload,
        payloadMetaPool,
        assignPayloadMeta,
        phase,
        task,
        message: preferDetailMessage
          ? detail || err?.message || String(err)
          : err?.message || String(err),
        err
      });
      return null;
    };

    return {
      config,
      heapPolicy,
      get pool() {
        return lifecycle.getPool();
      },
      stats() {
        const pool = lifecycle.getPool();
        const queued = Number.isFinite(pool?.queueSize) ? pool.queueSize : 0;
        const maxWorkers = lifecycle.getEffectiveMaxWorkers();
        const queueUtilization = maxWorkers > 0
          ? Math.max(0, Math.min(1, (activeTasks + queued) / maxWorkers))
          : null;
        const pressureSnapshot = queueController.snapshot();
        const numaPinningPlan = workerCoordinator.getNumaPlan();
        const workerNumaNodeByThreadId = workerCoordinator.getNumaAssignmentMap();
        return {
          pool: poolLabel,
          backend: processBackend ? 'process' : 'worker',
          process: pool?.stats?.() || null,
          activeTasks,
          queuedTasks: queued,
          maxWorkers,
          configuredMaxWorkers: lifecycle.getConfiguredMaxWorkers(),
          utilization: queueUtilization,
          disabled: lifecycle.isDisabled(),
          pendingRestart: lifecycle.isPendingRestart(),
          restartAttempts: lifecycle.getRestartAttempts(),
          heapPolicy,
          heapLimitMb: Number(currentResourceLimits?.maxOldGenerationSizeMb) || null,
          heapLimitEvidenceScope: 'requested-resource-limit',
          heapLaunchContract,
          runtimeObservations: workerCoordinator.runtimeObservationStats(pool),
          quantizeTypedTempBuffers,
          pressureDownscale: lifecycle.pressureDownscaleStats(),
          memoryPressure: {
            state: pressureSnapshot.state,
            transitions: pressureSnapshot.transitions,
            lastTransitionAt: pressureSnapshot.lastTransitionAt,
            watermarkSoft: pressureSnapshot.watermarkSoft,
            watermarkHard: pressureSnapshot.watermarkHard,
            languageThrottle: pressureSnapshot.languageThrottle,
            cacheEviction: pressureSnapshot.cacheEviction
          },
          numaPinning: {
            enabled: poolConfig?.numaPinning?.enabled === true,
            active: numaPinningPlan.active === true,
            reason: numaPinningPlan.reason || null,
            strategy: numaPinningPlan.strategy || null,
            nodeCount: Number(numaPinningPlan.nodeCount) || 1,
            workersAssigned: workerNumaNodeByThreadId.size,
            assignments: Object.fromEntries(workerNumaNodeByThreadId.entries())
          },
          gcPressure: workerCoordinator.gcPressureStats(),
          objectPools: {
            workerTaskMetrics: workerTaskMetricPool.stats(),
            tokenizePayloadMeta: tokenizePayloadMetaPool.stats(),
            quantizePayloadMeta: quantizePayloadMetaPool.stats(),
            crashPayloadMeta: crashPayloadMetaPool.stats()
          }
        };
      },
      dictConfig: sanitizeDictConfig(dictConfig),
      shouldUseForFile(sizeBytes) {
        if (lifecycle.isDisabled() || lifecycle.isPermanentlyDisabled()) return false;
        if (config.enabled === true) return true;
        if (config.enabled === 'auto') {
          const normalizedSizeBytes = Number.isFinite(sizeBytes) ? sizeBytes : 0;
          const minFileBytes = Number.isFinite(config.minFileBytes) && config.minFileBytes > 0
            ? Math.floor(config.minFileBytes)
            : null;
          if (minFileBytes != null && normalizedSizeBytes < minFileBytes) {
            return false;
          }
          if (config.maxFileBytes == null) return true;
          return normalizedSizeBytes <= config.maxFileBytes;
        }
        return false;
      },
      async tokenizeChunk(payload, { signal = null } = {}) {
        throwIfAborted(signal);
        activeTasks += 1;
        updatePoolMetrics();
        let throttleSlot = null;
        try {
          if (lifecycle.isDisabled() && !(await lifecycle.ensurePool())) {
            logWorkerPoolUnavailable({
              payload,
              payloadMetaPool: tokenizePayloadMetaPool,
              assignPayloadMeta: assignTokenizePayloadMeta,
              phase: 'worker-tokenize',
              task: 'tokenizeChunk'
            });
            return null;
          }
          queueController.recordPressureCacheEntry(payload);
          throttleSlot = await queueController.acquireLanguageThrottleSlot(payload, { signal });
          if (queueController.isClosed()) return null;
          const result = await lifecycle.getPool().run(
            sanitizePoolPayload(payload, sanitizeDictConfig(payload?.dictConfig)),
            { name: 'tokenizeChunk', signal }
          );
          updatePoolMetrics();
          return result;
        } catch (err) {
          if (isAbortError(err) && signal?.aborted) throw err;
          if (err?.code === 'ERR_PROCESS_TASK_BUDGET') throw err;
          if (queueController.isClosed() && isAbortError(err)) return null;
          return handleWorkerTaskError({
            err,
            payload,
            payloadMetaPool: tokenizePayloadMetaPool,
            assignPayloadMeta: assignTokenizePayloadMeta,
            phase: 'worker-tokenize',
            task: 'tokenizeChunk',
            preferDetailMessage: true
          });
        } finally {
          queueController.releaseLanguageThrottleSlot(throttleSlot);
          activeTasks = Math.max(0, activeTasks - 1);
          updatePoolMetrics();
          await lifecycle.handleTaskDrained();
        }
      },
      async runQuantize(payload, { signal = null } = {}) {
        throwIfAborted(signal);
        activeTasks += 1;
        updatePoolMetrics();
        try {
          if (lifecycle.isDisabled() && !(await lifecycle.ensurePool())) {
            logWorkerPoolUnavailable({
              payload,
              payloadMetaPool: quantizePayloadMetaPool,
              assignPayloadMeta: assignQuantizePayloadMeta,
              phase: 'worker-quantize',
              task: 'quantizeVectors'
            });
            return null;
          }
          const sanitizedPayload = sanitizeQuantizePayload(payload);
          const {
            payload: runPayload,
            transferList,
            typedTempCount
          } = buildQuantizeRunPayload(sanitizedPayload);
          quantizeTypedTempBuffers += typedTempCount;
          const runOptions = transferList.length
            ? { name: 'quantizeVectors', ...(processBackend ? {} : { transferList }), signal }
            : { name: 'quantizeVectors', signal };
          const result = await lifecycle.getPool().run(runPayload, runOptions);
          updatePoolMetrics();
          return result;
        } catch (err) {
          if (isAbortError(err) && signal?.aborted) throw err;
          if (err?.code === 'ERR_PROCESS_TASK_BUDGET') throw err;
          return handleWorkerTaskError({
            err,
            payload,
            payloadMetaPool: quantizePayloadMetaPool,
            assignPayloadMeta: assignQuantizePayloadMeta,
            phase: 'worker-quantize',
            task: 'quantizeVectors'
          });
        } finally {
          activeTasks = Math.max(0, activeTasks - 1);
          updatePoolMetrics();
          await lifecycle.handleTaskDrained();
        }
      },
      async destroy() {
        queueController.close();
        await destroyWorkerPoolLifecycleWithTimeout({
          lifecycle,
          poolLabel,
          timeoutMs: resolvedCleanupTimeoutMs,
          log
        });
      }
    };
  } catch (err) {
    // Initialization can fail after Piscina has acquired threads (listener
    // attachment, diagnostics or initial metrics). Returning a fallback must
    // not detach those workers from their existing lifecycle owner.
    if (lifecycle) {
      try {
        await destroyWorkerPoolLifecycleWithTimeout({
          lifecycle, poolLabel, timeoutMs: resolvedCleanupTimeoutMs, log
        });
      } catch (cleanupError) {
        throw new AggregateError([err, cleanupError], 'Worker pool initialization and cleanup failed.');
      }
    }
    log(`Worker pool unavailable: ${err?.message || err}`);
    return null;
  }
}

/**
 * Create tokenize/quantize worker pools from a shared pool budget. When pool
 * splitting is disabled, both roles point to the same pool.
 *
 * @param {object} [input]
 * @returns {Promise<{tokenizePool:object|null,quantizePool:object|null,destroy:()=>Promise<void>}>}
 */
export async function createIndexerWorkerPools(input = {}) {
  if (!input.memoryPolicy) {
    const effectiveMemory = readEffectiveMemory();
    input = { ...input, memoryPolicy: { effectiveMemory, maxGlobalRssMb: effectiveMemory.totalBytes * 0.9 / (1024 * 1024) } };
  }
  const runtimeEvidence = {};
  const outerReport = input.onRuntimeEvidence;
  input = { ...input, onRuntimeEvidence: (evidence) => {
    runtimeEvidence[evidence.pool] = evidence;
    outerReport?.(evidence);
  } };
  const baseConfig = input.config;
  if (!baseConfig || baseConfig.enabled === false) {
    return { runtimeEvidence, tokenizePool: null, quantizePool: null, destroy: async () => {} };
  }
  if (!baseConfig.splitByTask) {
    const pool = await createIndexerWorkerPool({ ...input, poolName: 'tokenize' });
    const destroy = async () => {
      if (pool?.destroy) {
        await pool.destroy();
      }
    };
    return { runtimeEvidence, tokenizePool: pool, quantizePool: pool, destroy };
  }

  // When splitting work across pools, treat maxWorkers as a TOTAL thread budget.
  // The previous behavior created multiple pools each with maxWorkers threads,
  // which could exceed the intended cap and exhaust memory on some platforms.
  const totalBudget = Number.isFinite(baseConfig.maxWorkers)
    ? Math.max(1, Math.floor(baseConfig.maxWorkers))
    : 1;

  // If there is no room to split, fall back to a single pool.
  if (totalBudget <= 1) {
    const pool = await createIndexerWorkerPool({ ...input, poolName: 'tokenize' });
    const destroy = async () => {
      if (pool?.destroy) {
        await pool.destroy();
      }
    };
    return { runtimeEvidence, tokenizePool: pool, quantizePool: pool, destroy };
  }

  const requestedQuantize = Number.isFinite(baseConfig.quantizeMaxWorkers)
    ? Math.max(1, Math.floor(baseConfig.quantizeMaxWorkers))
    : Math.max(1, Math.floor(totalBudget / 2));
  const quantizeBudget = Math.min(Math.max(1, requestedQuantize), totalBudget - 1);
  const tokenizeBudget = Math.max(1, totalBudget - quantizeBudget);

  const tokenizePool = await createIndexerWorkerPool({
    ...input,
    config: { ...baseConfig, maxWorkers: tokenizeBudget },
    poolName: 'tokenize'
  });
  // Register ownership as each pool becomes available. The shared lifecycle
  // owner attempts every cleanup even when another fails, including partial
  // initialization. Its reverse-order close matches acquisition order.
  const lifecycle = createLifecycleRegistry({ name: 'indexer-worker-pools' });
  if (tokenizePool?.destroy) {
    lifecycle.registerCleanup(() => tokenizePool.destroy(), { label: 'tokenize' });
  }
  let quantizePool;
  try {
    quantizePool = await createIndexerWorkerPool({
      ...input,
      config: { ...baseConfig, maxWorkers: quantizeBudget },
      poolName: 'quantize'
    });
    if (quantizePool?.destroy && quantizePool !== tokenizePool) {
      lifecycle.registerCleanup(() => quantizePool.destroy(), { label: 'quantize' });
    }
  } catch (error) {
    try {
      await lifecycle.close();
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'Worker pool initialization and cleanup failed.');
    }
    throw error;
  }
  const finalTokenizePool = tokenizePool || quantizePool;
  const finalQuantizePool = quantizePool || tokenizePool;
  let destroyPromise = null;
  const destroy = () => {
    if (!destroyPromise) destroyPromise = lifecycle.close();
    return destroyPromise;
  };
  return {
    runtimeEvidence,
    tokenizePool: finalTokenizePool,
    quantizePool: finalQuantizePool,
    destroy
  };
}
