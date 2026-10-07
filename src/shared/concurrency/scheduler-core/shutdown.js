import { normalizeTelemetryStage } from '../scheduler-telemetry.js';

export function createSchedulerShutdown({
  config,
  state,
  queueLifecycle,
  telemetryTimer,
  captureSchedulingTrace,
  captureQueueDepthSnapshot,
  pump
}) {
  const shutdown = ({
    awaitRunning = false,
    timeoutMs = 0
  } = {}) => {
    state.shuttingDown = true;
    if (telemetryTimer) clearInterval(telemetryTimer);
    queueLifecycle.clearAllQueues('scheduler shutdown');
    if (!awaitRunning) return;
    const pending = Array.from(state.runningTasks);
    if (!pending.length) return;
    const joined = Promise.allSettled(pending);
    const resolvedTimeoutMs = Number.isFinite(Number(timeoutMs))
      ? Math.max(0, Math.floor(Number(timeoutMs)))
      : 0;
    if (resolvedTimeoutMs <= 0) return joined;
    let timeoutHandle = null;
    const timeoutPromise = new Promise((resolve) => {
      timeoutHandle = setTimeout(() => {
        resolve();
      }, resolvedTimeoutMs);
    });
    return Promise.race([joined, timeoutPromise])
      .finally(() => {
        if (timeoutHandle) clearTimeout(timeoutHandle);
      });
  };

  const setLimits = (limits = {}) => {
    if (Number.isFinite(Number(limits.cpuTokens))) {
      config.limitState.cpuTokens = Math.max(1, Math.floor(Number(limits.cpuTokens)));
    }
    if (Number.isFinite(Number(limits.ioTokens))) {
      config.limitState.ioTokens = Math.max(1, Math.floor(Number(limits.ioTokens)));
    }
    if (Number.isFinite(Number(limits.memoryTokens))) {
      config.limitState.memoryTokens = Math.max(1, Math.floor(Number(limits.memoryTokens)));
    }
    config.baselineLimits.cpu = config.limitState.cpuTokens;
    config.baselineLimits.io = config.limitState.ioTokens;
    config.baselineLimits.mem = config.limitState.memoryTokens;
    config.maxLimits.cpu = config.limitState.cpuTokens;
    config.maxLimits.io = config.limitState.ioTokens;
    config.maxLimits.mem = config.limitState.memoryTokens;
    state.tokens.cpu.total = config.limitState.cpuTokens;
    state.tokens.io.total = config.limitState.ioTokens;
    state.tokens.mem.total = config.limitState.memoryTokens;
    for (const [surfaceName, surfaceState] of config.adaptiveSurfaceStates.entries()) {
      if (!surfaceState || typeof surfaceState !== 'object') continue;
      const bounds = config.resolveSurfaceDefaultBounds(surfaceName);
      const boundedMax = Math.max(1, Number(bounds?.maxConcurrency) || 1);
      const boundedMin = Math.max(
        1,
        Math.min(
          Number(surfaceState.minConcurrency) || 1,
          boundedMax
        )
      );
      surfaceState.minConcurrency = boundedMin;
      surfaceState.maxConcurrency = Math.max(
        boundedMin,
        Math.min(Number(surfaceState.maxConcurrency) || boundedMax, boundedMax)
      );
      surfaceState.currentConcurrency = Math.max(
        surfaceState.minConcurrency,
        Math.min(Number(surfaceState.currentConcurrency) || surfaceState.minConcurrency, surfaceState.maxConcurrency)
      );
    }
    captureSchedulingTrace({ reason: 'set-limits', force: true });
    pump();
  };

  const setTelemetryOptions = (options = {}) => {
    if (typeof options?.stage === 'string') {
      state.telemetryStage = normalizeTelemetryStage(options.stage, state.telemetryStage);
    }
    if (Object.prototype.hasOwnProperty.call(options, 'queueDepthSnapshotsEnabled')) {
      state.queueDepthSnapshotsEnabled = options.queueDepthSnapshotsEnabled === true;
    }
    if (Number.isFinite(Number(options?.traceIntervalMs))) {
      state.traceIntervalMs = Math.max(100, Math.floor(Number(options.traceIntervalMs)));
    }
    if (Number.isFinite(Number(options?.queueDepthSnapshotIntervalMs))) {
      state.queueDepthSnapshotIntervalMs = Math.max(1000, Math.floor(Number(options.queueDepthSnapshotIntervalMs)));
    }
    const now = config.nowMs();
    captureSchedulingTrace({ now, reason: 'telemetry-options', force: true });
    if (state.queueDepthSnapshotsEnabled) {
      captureQueueDepthSnapshot({ now, reason: 'telemetry-options', force: true });
    }
  };

  return {
    shutdown,
    setLimits,
    setTelemetryOptions
  };
}
