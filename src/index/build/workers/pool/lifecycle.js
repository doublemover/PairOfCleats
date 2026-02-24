import {
  resolveBuildCleanupTimeoutMs,
  runBuildCleanupWithTimeout
} from '../../cleanup-timeout.js';

/**
 * Manage worker-pool lifecycle, restart scheduling, and pressure-driven resize.
 *
 * @param {object} [input]
 * @param {(line:string)=>void} [input.log]
 * @param {string} [input.poolLabel]
 * @param {(err:unknown)=>string} [input.summarizeError]
 * @param {number} [input.maxRestartAttempts]
 * @param {number} [input.restartBaseDelayMs]
 * @param {number} [input.restartMaxDelayMs]
 * @param {number} [input.configuredMaxWorkers]
 * @param {boolean} [input.autoDownscaleOnPressure]
 * @param {number} [input.downscaleMinWorkers]
 * @param {number} [input.downscaleRssThreshold]
 * @param {number} [input.downscaleGcThreshold]
 * @param {number} [input.downscaleCooldownMs]
 * @param {number} [input.upscaleCooldownMs]
 * @param {number} [input.upscaleRssThreshold]
 * @param {number} [input.upscaleGcThreshold]
 * @param {(input:{rssPressure:number,gcPressure:number,rssThreshold:number,gcThreshold:number})=>boolean} [input.shouldDownscaleWorkersForPressure]
 * @param {()=>number} [input.getActiveTasks]
 * @param {(input:{pool:string})=>void} [input.incWorkerRetries]
 * @param {number|null} [input.cleanupTimeoutMs]
 * @param {(maxWorkers:number)=>unknown} input.createPool
 * @param {(poolInstance:unknown)=>void} [input.attachPoolListeners]
 * @returns {object}
 */
export const createWorkerPoolLifecycle = (input = {}) => {
  const {
    log = () => {},
    poolLabel = 'tokenize',
    summarizeError = (err) => err?.message || String(err),
    maxRestartAttempts = 3,
    restartBaseDelayMs = 5000,
    restartMaxDelayMs = 10000,
    configuredMaxWorkers = 1,
    autoDownscaleOnPressure = true,
    downscaleMinWorkers = 1,
    downscaleRssThreshold = 0.95,
    downscaleGcThreshold = 0.92,
    downscaleCooldownMs = 15000,
    upscaleCooldownMs = 15000,
    upscaleRssThreshold = 0.85,
    upscaleGcThreshold = 0.82,
    shouldDownscaleWorkersForPressure = () => false,
    getActiveTasks = () => 0,
    incWorkerRetries = () => {},
    cleanupTimeoutMs = null,
    createPool,
    attachPoolListeners = () => {}
  } = input;
  const resolvedCleanupTimeoutMs = resolveBuildCleanupTimeoutMs(cleanupTimeoutMs);

  let pool = null;
  let disabled = false;
  let permanentlyDisabled = false;
  let restartAttempts = 0;
  let restartAtMs = 0;
  let restarting = null;
  let shutdownWhenIdle = false;
  let pendingRestart = false;
  let effectiveMaxWorkers = Math.max(1, Math.floor(Number(configuredMaxWorkers) || 1));
  let pressureDownscaleEvents = 0;
  let pressureUpscaleEvents = 0;
  let lastPressureDownscaleAtMs = 0;
  let lastPressureUpscaleAtMs = 0;

  const shutdownPool = async () => {
    if (!pool) return;
    try {
      await runBuildCleanupWithTimeout({
        label: `worker-pool.${poolLabel}.destroy`,
        cleanup: () => pool.destroy(),
        timeoutMs: resolvedCleanupTimeoutMs,
        log
      });
    } catch (err) {
      const detail = summarizeError(err);
      log(`Worker pool shutdown failed: ${detail || 'unknown error'}`);
    }
    pool = null;
  };

  const shutdownNowOrWhenIdle = async () => {
    if (getActiveTasks() === 0) {
      await shutdownPool();
    } else {
      shutdownWhenIdle = true;
    }
  };

  const disablePermanently = async (reason) => {
    if (permanentlyDisabled) return;
    permanentlyDisabled = true;
    disabled = true;
    pendingRestart = false;
    restartAttempts = maxRestartAttempts + 1;
    if (reason) log(`Worker pool disabled permanently: ${reason}`);
    await shutdownNowOrWhenIdle();
  };

  const scheduleRestart = async (reason) => {
    if (permanentlyDisabled) return;
    if (!pool && disabled && restartAttempts > maxRestartAttempts) return;
    disabled = true;
    restartAttempts += 1;
    incWorkerRetries({ pool: poolLabel });
    if (restartAttempts > maxRestartAttempts) {
      pendingRestart = false;
      permanentlyDisabled = true;
      disabled = true;
      if (reason) log(`Worker pool disabled: ${reason}`);
      await shutdownNowOrWhenIdle();
      return;
    }
    const delayMs = Math.min(
      restartMaxDelayMs,
      restartBaseDelayMs * (2 ** Math.max(0, restartAttempts - 1))
    );
    restartAtMs = Date.now() + delayMs;
    pendingRestart = true;
    await shutdownNowOrWhenIdle();
    if (reason) log(`Worker pool disabled: ${reason} (retry in ${delayMs}ms).`);
  };

  const scheduleReconfigureRestart = async (reason) => {
    if (permanentlyDisabled) return;
    disabled = true;
    pendingRestart = true;
    restartAtMs = Date.now() + 50;
    await shutdownNowOrWhenIdle();
    if (reason) log(`Worker pool reconfigure: ${reason}`);
  };

  /**
   * Adapt pool size in response to pressure samples with hysteresis:
   * - downscale quickly when pressure breaches thresholds
   * - upscale gradually only after sustained recovery
   *
   * @param {{rssPressure:number,gcPressure:number}} input
   * @returns {Promise<void>}
   */
  const maybeReduceWorkersOnPressure = async ({ rssPressure, gcPressure }) => {
    if (!autoDownscaleOnPressure || permanentlyDisabled) return;
    if (disabled || pendingRestart || restarting) return;
    const pressureHigh = shouldDownscaleWorkersForPressure({
      rssPressure,
      gcPressure,
      rssThreshold: downscaleRssThreshold,
      gcThreshold: downscaleGcThreshold
    });
    if (!pressureHigh) {
      const pressureRecovered = rssPressure <= upscaleRssThreshold && gcPressure <= upscaleGcThreshold;
      if (!pressureRecovered) return;
      if (effectiveMaxWorkers >= configuredMaxWorkers) return;
      const now = Date.now();
      if ((now - lastPressureDownscaleAtMs) < upscaleCooldownMs) return;
      if ((now - lastPressureUpscaleAtMs) < upscaleCooldownMs) return;
      const nextWorkers = Math.min(configuredMaxWorkers, effectiveMaxWorkers + 1);
      if (nextWorkers <= effectiveMaxWorkers) return;
      const previousWorkers = effectiveMaxWorkers;
      effectiveMaxWorkers = nextWorkers;
      pressureUpscaleEvents += 1;
      lastPressureUpscaleAtMs = now;
      await scheduleReconfigureRestart(
        `rssPressure=${rssPressure.toFixed(3)} gcPressure=${gcPressure.toFixed(3)} ` +
        `recovery(rss<=${upscaleRssThreshold.toFixed(2)},gc<=${upscaleGcThreshold.toFixed(2)}) ` +
        `workers ${previousWorkers}->${nextWorkers}.`
      );
      return;
    }
    if (effectiveMaxWorkers <= downscaleMinWorkers) return;
    const now = Date.now();
    if ((now - lastPressureDownscaleAtMs) < downscaleCooldownMs) return;
    const nextWorkers = Math.max(downscaleMinWorkers, effectiveMaxWorkers - 1);
    if (nextWorkers >= effectiveMaxWorkers) return;
    const previousWorkers = effectiveMaxWorkers;
    effectiveMaxWorkers = nextWorkers;
    pressureDownscaleEvents += 1;
    lastPressureDownscaleAtMs = now;
    await scheduleReconfigureRestart(
      `rssPressure=${rssPressure.toFixed(3)} gcPressure=${gcPressure.toFixed(3)} ` +
      `thresholds(rss=${downscaleRssThreshold.toFixed(2)},gc=${downscaleGcThreshold.toFixed(2)}) ` +
      `workers ${previousWorkers}->${nextWorkers}.`
    );
  };

  const maybeRestart = async () => {
    if (permanentlyDisabled) {
      pendingRestart = false;
      return false;
    }
    if (!pendingRestart) return false;
    if (!disabled) {
      pendingRestart = false;
      return false;
    }
    if (getActiveTasks() > 0) return false;
    if (Date.now() < restartAtMs) return false;
    return ensurePool();
  };

  /**
   * Serialize pool restarts to a single in-flight promise.
   *
   * Multiple task completions can observe restart eligibility at once; this
   * guard ensures only one shutdown/create sequence executes while all callers
   * await the same promise.
   *
   * @returns {Promise<boolean>}
   */
  const ensurePool = async () => {
    if (permanentlyDisabled) {
      pendingRestart = false;
      return false;
    }
    if (pool && !disabled) {
      pendingRestart = false;
      return true;
    }
    if (restartAttempts > maxRestartAttempts) {
      pendingRestart = false;
      return false;
    }
    if (!pendingRestart) return false;
    if (getActiveTasks() > 0) return false;
    if (Date.now() < restartAtMs) return false;
    if (!restarting) {
      restarting = (async () => {
        try {
          await shutdownPool();
          pool = createPool(effectiveMaxWorkers);
          attachPoolListeners(pool);
          disabled = false;
          restartAttempts = 0;
          restartAtMs = 0;
          pendingRestart = false;
          log('Worker pool restarted.');
        } catch (err) {
          const detail = summarizeError(err);
          await scheduleRestart(`restart failed: ${detail || 'unknown error'}`);
        } finally {
          restarting = null;
        }
      })();
    }
    await restarting;
    return !!pool && !disabled;
  };

  const handleTaskDrained = async () => {
    if (getActiveTasks() !== 0) return;
    if (shutdownWhenIdle) {
      shutdownWhenIdle = false;
      await shutdownPool();
    }
    await maybeRestart();
  };

  const initialize = () => {
    pool = createPool(effectiveMaxWorkers);
    attachPoolListeners(pool);
    return pool;
  };

  const destroy = async () => {
    disabled = true;
    restartAttempts = maxRestartAttempts + 1;
    await shutdownPool();
  };

  const pressureDownscaleStats = () => ({
    enabled: autoDownscaleOnPressure,
    rssThreshold: downscaleRssThreshold,
    gcThreshold: downscaleGcThreshold,
    minWorkers: downscaleMinWorkers,
    cooldownMs: downscaleCooldownMs,
    events: pressureDownscaleEvents,
    recoveryEvents: pressureUpscaleEvents,
    upscaleCooldownMs,
    upscaleRssThreshold,
    upscaleGcThreshold,
    lastEventAt: lastPressureDownscaleAtMs
      ? new Date(lastPressureDownscaleAtMs).toISOString()
      : null
  });

  return {
    initialize,
    ensurePool,
    maybeRestart,
    maybeReduceWorkersOnPressure,
    disablePermanently,
    scheduleRestart,
    handleTaskDrained,
    destroy,
    getPool: () => pool,
    isDisabled: () => disabled,
    isPermanentlyDisabled: () => permanentlyDisabled,
    isPendingRestart: () => pendingRestart,
    getRestartAttempts: () => restartAttempts,
    getEffectiveMaxWorkers: () => effectiveMaxWorkers,
    getConfiguredMaxWorkers: () => configuredMaxWorkers,
    pressureDownscaleStats
  };
};
