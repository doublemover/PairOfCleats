import {
  clearAllSchedulerQueues,
  clearSchedulerQueue,
  recordSchedulerQueueWaitTime
} from '../scheduler-core-queue-state.js';

export function createSchedulerQueueLifecycle({ config }) {
  const resolveQueueSurface = (queueName, explicitSurface = null) => {
    const explicit = config.normalizeSurfaceName(explicitSurface);
    if (explicit && config.adaptiveSurfaceStates.has(explicit)) return explicit;
    const mapped = config.normalizeSurfaceName(config.surfaceQueueMap.get(queueName));
    if (mapped && config.adaptiveSurfaceStates.has(mapped)) return mapped;
    return null;
  };

  const bumpSurfaceRunning = (surfaceName, delta) => {
    if (!surfaceName || !Number.isFinite(Number(delta)) || Number(delta) === 0) return;
    const current = Math.max(0, Number(config.runningBySurface.get(surfaceName)) || 0);
    const next = Math.max(0, current + Number(delta));
    if (next > 0) {
      config.runningBySurface.set(surfaceName, next);
      return;
    }
    config.runningBySurface.delete(surfaceName);
  };

  const ensureQueue = (name) => {
    if (config.queues.has(name)) return config.queues.get(name);
    const cfg = config.queueConfig[name] || {};
    const surface = resolveQueueSurface(name, cfg?.surface);
    const queueState = {
      name,
      surface,
      priority: Number.isFinite(Number(cfg.priority)) ? Number(cfg.priority) : 50,
      weight: Number.isFinite(Number(cfg.weight)) ? Math.max(1, Math.floor(Number(cfg.weight))) : 1,
      floorCpu: Number.isFinite(Number(cfg.floorCpu)) ? Math.max(0, Math.floor(Number(cfg.floorCpu))) : 0,
      floorIo: Number.isFinite(Number(cfg.floorIo)) ? Math.max(0, Math.floor(Number(cfg.floorIo))) : 0,
      floorMem: Number.isFinite(Number(cfg.floorMem)) ? Math.max(0, Math.floor(Number(cfg.floorMem))) : 0,
      maxPending: config.normalizeMaxPending(cfg.maxPending),
      maxPendingBytes: config.normalizeByteLimit(cfg.maxPendingBytes),
      maxInFlightBytes: config.normalizeByteLimit(cfg.maxInFlightBytes),
      pending: [],
      pendingBytes: 0,
      inFlightBytes: 0,
      running: 0,
      stats: {
        scheduled: 0,
        started: 0,
        completed: 0,
        failed: 0,
        rejected: 0,
        starvation: 0,
        lastWaitMs: 0,
        waitP95Ms: 0,
        waitSamples: [],
        waitSampleCursor: 0,
        rejectedMaxPending: 0,
        rejectedMaxPendingBytes: 0,
        rejectedAbort: 0,
        rejectedSignalRequired: 0
      }
    };
    config.queues.set(name, queueState);
    config.queueOrder.push(queueState);
    config.queueOrder.sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));
    return queueState;
  };

  const applyQueueConfig = (queue, newConfig) => {
    if (!queue || !newConfig || typeof newConfig !== 'object') return;
    const previousSurface = queue.surface;
    const runningBeforeSurfaceChange = Math.max(0, Number(queue.running) || 0);
    if (Number.isFinite(Number(newConfig.priority))) {
      queue.priority = Number(newConfig.priority);
    }
    if (Object.prototype.hasOwnProperty.call(newConfig, 'maxPending')) {
      queue.maxPending = config.normalizeMaxPending(newConfig.maxPending);
    }
    if (newConfig.maxPendingBytes != null) {
      queue.maxPendingBytes = config.normalizeByteLimit(newConfig.maxPendingBytes);
    }
    if (newConfig.maxInFlightBytes != null) {
      queue.maxInFlightBytes = config.normalizeByteLimit(newConfig.maxInFlightBytes);
    }
    if (Number.isFinite(Number(newConfig.weight))) {
      queue.weight = Math.max(1, Math.floor(Number(newConfig.weight)));
    }
    if (Number.isFinite(Number(newConfig.floorCpu))) {
      queue.floorCpu = Math.max(0, Math.floor(Number(newConfig.floorCpu)));
    }
    if (Number.isFinite(Number(newConfig.floorIo))) {
      queue.floorIo = Math.max(0, Math.floor(Number(newConfig.floorIo)));
    }
    if (Number.isFinite(Number(newConfig.floorMem))) {
      queue.floorMem = Math.max(0, Math.floor(Number(newConfig.floorMem)));
    }
    if (Object.prototype.hasOwnProperty.call(newConfig, 'surface')) {
      queue.surface = resolveQueueSurface(queue.name, newConfig.surface);
      if (runningBeforeSurfaceChange > 0 && previousSurface !== queue.surface) {
        bumpSurfaceRunning(previousSurface, -runningBeforeSurfaceChange);
        bumpSurfaceRunning(queue.surface, runningBeforeSurfaceChange);
      }
    }
    config.queueOrder.sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));
  };

  const evaluateWriteBackpressure = () => {
    if (!config.writeBackpressure.enabled) {
      config.writeBackpressureState.active = false;
      config.writeBackpressureState.reasons = [];
      config.writeBackpressureState.pending = 0;
      config.writeBackpressureState.pendingBytes = 0;
      config.writeBackpressureState.oldestWaitMs = 0;
      return config.writeBackpressureState;
    }
    const writeQueue = config.queues.get(config.writeBackpressure.writeQueue);
    if (!writeQueue) {
      config.writeBackpressureState.active = false;
      config.writeBackpressureState.reasons = [];
      config.writeBackpressureState.pending = 0;
      config.writeBackpressureState.pendingBytes = 0;
      config.writeBackpressureState.oldestWaitMs = 0;
      return config.writeBackpressureState;
    }
    const pending = writeQueue.pending.length;
    const pendingBytes = config.normalizeByteCount(writeQueue.pendingBytes);
    const oldestWaitMs = pending > 0
      ? Math.max(0, config.nowMs() - Number(writeQueue.pending[0]?.enqueuedAt || config.nowMs()))
      : 0;
    const reasons = [];
    if (pending >= config.writeBackpressure.pendingThreshold) reasons.push('pending');
    if (pendingBytes >= config.writeBackpressure.pendingBytesThreshold) reasons.push('pendingBytes');
    if (oldestWaitMs >= config.writeBackpressure.oldestWaitMsThreshold) reasons.push('oldestWaitMs');
    config.writeBackpressureState.active = reasons.length > 0;
    config.writeBackpressureState.reasons = reasons;
    config.writeBackpressureState.pending = pending;
    config.writeBackpressureState.pendingBytes = pendingBytes;
    config.writeBackpressureState.oldestWaitMs = oldestWaitMs;
    return config.writeBackpressureState;
  };

  const registerQueue = (queueName, queueConfig = {}) => {
    const queue = ensureQueue(queueName);
    applyQueueConfig(queue, queueConfig);
    return queue;
  };

  const registerQueues = (configMap = {}) => {
    if (!configMap || typeof configMap !== 'object') return;
    for (const [queueName, queueConfig] of Object.entries(configMap)) {
      registerQueue(queueName, queueConfig);
    }
  };

  const countSurfaceRunning = (surfaceName) => (
    surfaceName
      ? Math.max(0, Number(config.runningBySurface.get(surfaceName)) || 0)
      : 0
  );

  const recordQueueWaitTime = (queue, waitedMs) => recordSchedulerQueueWaitTime(queue, waitedMs, {
    sampleLimit: config.WAIT_TIME_SAMPLE_LIMIT,
    resolvePercentile: config.resolvePercentile
  });

  const clearQueue = (queueName, reason = 'scheduler queue cleared') => {
    const queue = config.queues.get(queueName);
    return clearSchedulerQueue(queue, {
      reason,
      normalizeByteCount: config.normalizeByteCount,
      counters: config.counters
    });
  };

  const clearAllQueues = (reason = 'scheduler queue cleared') => (
    clearAllSchedulerQueues(config.queueOrder, clearQueue, reason)
  );

  registerQueues(config.queueConfig);

  return {
    resolveQueueSurface,
    bumpSurfaceRunning,
    ensureQueue,
    applyQueueConfig,
    evaluateWriteBackpressure,
    registerQueue,
    registerQueues,
    countSurfaceRunning,
    recordQueueWaitTime,
    clearQueue,
    clearAllQueues
  };
}
