import os from 'node:os';
import util from 'node:util';
import { fileURLToPath } from 'node:url';
import { log as defaultLog } from '../../../shared/progress.js';
import {
  incWorkerRetries,
  observeWorkerTaskDuration,
  setStageGcPressure,
  setWorkerActiveTasks,
  setWorkerGcPressure,
  setWorkerQueueDepth
} from '../../../shared/metrics.js';
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
  const memoryCappedMax = resolveMemoryWorkerCap(config?.maxWorkers);
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
      maxPerWorkerMb: heapPolicy.maxPerWorkerMb
    });
    let currentResourceLimits = resolveResourceLimitsForWorkers(configuredMaxWorkers);
    const serializedDictWords = dictSharedForPool?.bytes && dictSharedForPool?.offsets
      ? null
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
      : Math.max(1, Math.floor(Number(os.totalmem() || 0) * 0.9));

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
      maxGlobalRssBytes
    });

    let lifecycle = null;
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
      maybeReduceWorkersOnPressure: async (sample) => {
        if (!lifecycle) return;
        await lifecycle.maybeReduceWorkersOnPressure(sample);
      }
    });

    const createPool = (maxWorkers) => {
      currentResourceLimits = resolveResourceLimitsForWorkers(maxWorkers);
      const numaPinningPlan = resolveNumaPinningPlan({
        config: poolConfig,
        maxWorkers
      });
      workerCoordinator.setNumaPinningPlan(numaPinningPlan);
      const workerData = {
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
      async tokenizeChunk(payload) {
        activeTasks += 1;
        updatePoolMetrics();
        let throttleSlot = null;
        try {
          if (lifecycle.isDisabled() && !(await lifecycle.ensurePool())) {
            if (crashLogger?.enabled) {
              withPooledPayloadMeta(tokenizePayloadMetaPool, (meta) => {
                assignTokenizePayloadMeta(meta, payload);
              }, (payloadMeta) => {
                crashLogger.logError({
                  phase: 'worker-tokenize',
                  message: 'worker pool unavailable',
                  stack: null,
                  name: 'Error',
                  code: null,
                  task: 'tokenizeChunk',
                  payloadMeta: payload ? payloadMeta : null
                });
              });
            }
            return null;
          }
          queueController.recordPressureCacheEntry(payload);
          throttleSlot = await queueController.acquireLanguageThrottleSlot(payload);
          const result = await lifecycle.getPool().run(
            sanitizePoolPayload(payload, sanitizeDictConfig(payload?.dictConfig)),
            { name: 'tokenizeChunk' }
          );
          updatePoolMetrics();
          return result;
        } catch (err) {
          const { detail, opaqueFailure, isCloneError, reason } = classifyWorkerRunError(err);
          if (isCloneError) {
            await lifecycle.disablePermanently(reason || 'data-clone error');
          } else if (opaqueFailure) {
            await lifecycle.disablePermanently(reason || 'worker failure');
          } else {
            await lifecycle.scheduleRestart(reason);
          }
          if (crashLogger?.enabled) {
            withPooledPayloadMeta(tokenizePayloadMetaPool, (meta) => {
              assignTokenizePayloadMeta(meta, payload);
            }, (payloadMeta) => {
              crashLogger.logError({
                phase: 'worker-tokenize',
                message: detail || err?.message || String(err),
                stack: err?.stack || null,
                name: err?.name || null,
                code: err?.code || null,
                task: 'tokenizeChunk',
                payloadMeta: payload ? payloadMeta : null,
                raw: util.inspect(err, { depth: 4, breakLength: 120, showHidden: true, getters: true }),
                errors: Array.isArray(err?.errors)
                  ? err.errors.map((inner) => ({
                    message: inner?.message || String(inner),
                    stack: inner?.stack || null,
                    name: inner?.name || null,
                    code: inner?.code || null,
                    raw: util.inspect(inner, { depth: 3, breakLength: 120, showHidden: true, getters: true })
                  }))
                  : null,
                cause: err?.cause
                  ? {
                    message: err.cause?.message || String(err.cause),
                    stack: err.cause?.stack || null,
                    name: err.cause?.name || null,
                    code: err.cause?.code || null,
                    raw: util.inspect(err.cause, { depth: 3, breakLength: 120, showHidden: true, getters: true })
                  }
                  : null
              });
            });
          }
          return null;
        } finally {
          queueController.releaseLanguageThrottleSlot(throttleSlot);
          activeTasks = Math.max(0, activeTasks - 1);
          updatePoolMetrics();
          await lifecycle.handleTaskDrained();
        }
      },
      async runQuantize(payload) {
        activeTasks += 1;
        updatePoolMetrics();
        try {
          if (lifecycle.isDisabled() && !(await lifecycle.ensurePool())) {
            if (crashLogger?.enabled) {
              withPooledPayloadMeta(quantizePayloadMetaPool, (meta) => {
                assignQuantizePayloadMeta(meta, payload);
              }, (payloadMeta) => {
                crashLogger.logError({
                  phase: 'worker-quantize',
                  message: 'worker pool unavailable',
                  stack: null,
                  name: 'Error',
                  code: null,
                  task: 'quantizeVectors',
                  payloadMeta: payload ? payloadMeta : null
                });
              });
            }
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
            ? { name: 'quantizeVectors', transferList }
            : { name: 'quantizeVectors' };
          const result = await lifecycle.getPool().run(runPayload, runOptions);
          updatePoolMetrics();
          return result;
        } catch (err) {
          const { detail, opaqueFailure, isCloneError, reason } = classifyWorkerRunError(err);
          if (isCloneError) {
            await lifecycle.disablePermanently(reason || 'data-clone error');
          } else if (opaqueFailure) {
            await lifecycle.disablePermanently(reason || 'worker failure');
          } else {
            await lifecycle.scheduleRestart(reason);
          }
          if (crashLogger?.enabled) {
            withPooledPayloadMeta(quantizePayloadMetaPool, (meta) => {
              assignQuantizePayloadMeta(meta, payload);
            }, (payloadMeta) => {
              crashLogger.logError({
                phase: 'worker-quantize',
                message: err?.message || String(err),
                stack: err?.stack || null,
                name: err?.name || null,
                code: err?.code || null,
                task: 'quantizeVectors',
                payloadMeta: payload ? payloadMeta : null,
                raw: util.inspect(err, { depth: 4, breakLength: 120, showHidden: true, getters: true }),
                errors: Array.isArray(err?.errors)
                  ? err.errors.map((inner) => ({
                    message: inner?.message || String(inner),
                    stack: inner?.stack || null,
                    name: inner?.name || null,
                    code: inner?.code || null,
                    raw: util.inspect(inner, { depth: 3, breakLength: 120, showHidden: true, getters: true })
                  }))
                  : null,
                cause: err?.cause
                  ? {
                    message: err.cause?.message || String(err.cause),
                    stack: err.cause?.stack || null,
                    name: err.cause?.name || null,
                    code: err.cause?.code || null,
                    raw: util.inspect(err.cause, { depth: 3, breakLength: 120, showHidden: true, getters: true })
                  }
                  : null
              });
            });
          }
          return null;
        } finally {
          activeTasks = Math.max(0, activeTasks - 1);
          updatePoolMetrics();
          await lifecycle.handleTaskDrained();
        }
      },
      async destroy() {
        queueController.notifyThrottleWaiters();
        await runBuildCleanupWithTimeout({
          label: `worker-pool.${poolLabel}.lifecycle.destroy`,
          cleanup: () => lifecycle.destroy(),
          timeoutMs: resolvedCleanupTimeoutMs,
          log
        });
      }
    };
  } catch (err) {
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
  const baseConfig = input.config;
  const cleanupTimeoutMs = resolveBuildCleanupTimeoutMs(baseConfig?.cleanupTimeoutMs);
  const poolLabel = (label) => `worker-pools.${label}.destroy`;
  if (!baseConfig || baseConfig.enabled === false) {
    return { tokenizePool: null, quantizePool: null, destroy: async () => {} };
  }
  if (!baseConfig.splitByTask) {
    const pool = await createIndexerWorkerPool({ ...input, poolName: 'tokenize' });
    const destroy = async () => {
      if (pool?.destroy) {
        await runBuildCleanupWithTimeout({
          label: poolLabel('tokenize'),
          cleanup: () => pool.destroy(),
          timeoutMs: cleanupTimeoutMs
        });
      }
    };
    return { tokenizePool: pool, quantizePool: pool, destroy };
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
        await runBuildCleanupWithTimeout({
          label: poolLabel('tokenize'),
          cleanup: () => pool.destroy(),
          timeoutMs: cleanupTimeoutMs
        });
      }
    };
    return { tokenizePool: pool, quantizePool: pool, destroy };
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
  const quantizePool = await createIndexerWorkerPool({
    ...input,
    config: { ...baseConfig, maxWorkers: quantizeBudget },
    poolName: 'quantize'
  });

  const finalTokenizePool = tokenizePool || quantizePool;
  const finalQuantizePool = quantizePool || tokenizePool;
  const destroy = async () => {
    if (finalTokenizePool?.destroy) {
      await runBuildCleanupWithTimeout({
        label: poolLabel('tokenize'),
        cleanup: () => finalTokenizePool.destroy(),
        timeoutMs: cleanupTimeoutMs
      });
    }
    if (finalQuantizePool?.destroy && finalQuantizePool !== finalTokenizePool) {
      await runBuildCleanupWithTimeout({
        label: poolLabel('quantize'),
        cleanup: () => finalQuantizePool.destroy(),
        timeoutMs: cleanupTimeoutMs
      });
    }
  };
  return {
    tokenizePool: finalTokenizePool,
    quantizePool: finalQuantizePool,
    destroy
  };
}
