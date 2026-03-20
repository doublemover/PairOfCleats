import { coerceUnitFraction } from '../../number-coerce.js';
import {
  ADAPTIVE_SURFACE_KEYS,
  DEFAULT_ADAPTIVE_SURFACE_POLICY,
  DEFAULT_ADAPTIVE_SURFACE_QUEUE_MAP
} from '../adaptive-surfaces.js';
import {
  normalizeSchedulerBacklogRatio,
  normalizeSchedulerByteCount,
  normalizeSchedulerByteLimit,
  normalizeSchedulerCooldownMs,
  normalizeSchedulerMaxPending,
  normalizeSchedulerNonNegativeInt,
  normalizeSchedulerPositiveInt,
  normalizeSchedulerRatio,
  normalizeSchedulerRequest,
  normalizeSchedulerSurfaceName,
  normalizeSchedulerTokenPool,
  resolveSchedulerPercentile,
  resolveSchedulerSurfaceDefaultBounds
} from '../scheduler-core-policy.js';
import { normalizeTelemetryStage } from '../scheduler-telemetry.js';

export function createSchedulerCoreConfig(input = {}) {
  const enabled = input.enabled !== false;
  const requireSignals = input.requireSignals === true;
  const requiredSignalQueues = new Set(
    Array.isArray(input.requiredSignalQueues)
      ? input.requiredSignalQueues
        .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
        .filter(Boolean)
      : []
  );
  const shouldRequireSignalForQueue = (queueName) => (
    requireSignals && (requiredSignalQueues.size === 0 || requiredSignalQueues.has(queueName))
  );
  const createSignalRequiredError = (queueName) => {
    const err = new Error(`scheduler queue ${queueName} requires an AbortSignal`);
    err.code = 'SCHEDULER_SIGNAL_REQUIRED';
    err.retryable = false;
    err.meta = { queueName };
    return err;
  };
  const lowResourceMode = input.lowResourceMode === true;
  const starvationMs = Number.isFinite(Number(input.starvationMs))
    ? Math.max(0, Math.floor(Number(input.starvationMs)))
    : 30000;
  const WAIT_TIME_SAMPLE_LIMIT = 64;
  const normalizeTokenPool = normalizeSchedulerTokenPool;
  const normalizeByteLimit = normalizeSchedulerByteLimit;
  const normalizeMaxPending = normalizeSchedulerMaxPending;
  const normalizeByteCount = normalizeSchedulerByteCount;
  const normalizeRequest = normalizeSchedulerRequest;
  const resolvePercentile = resolveSchedulerPercentile;
  const normalizeSurfaceName = normalizeSchedulerSurfaceName;
  const normalizePositiveInt = normalizeSchedulerPositiveInt;
  const normalizeNonNegativeInt = normalizeSchedulerNonNegativeInt;
  const normalizeRatio = normalizeSchedulerRatio;
  const normalizeCooldownMs = normalizeSchedulerCooldownMs;
  const normalizeBacklogRatio = normalizeSchedulerBacklogRatio;

  const limitState = {
    cpuTokens: normalizeTokenPool(input.cpuTokens),
    ioTokens: normalizeTokenPool(input.ioTokens),
    memoryTokens: normalizeTokenPool(input.memoryTokens)
  };
  const adaptiveEnabled = input.adaptive === true;
  const baselineLimits = {
    cpu: limitState.cpuTokens,
    io: limitState.ioTokens,
    mem: limitState.memoryTokens
  };
  const maxLimits = {
    cpu: Math.max(baselineLimits.cpu, normalizeTokenPool(input.maxCpuTokens ?? limitState.cpuTokens)),
    io: Math.max(baselineLimits.io, normalizeTokenPool(input.maxIoTokens ?? limitState.ioTokens)),
    mem: Math.max(baselineLimits.mem, normalizeTokenPool(input.maxMemoryTokens ?? limitState.memoryTokens))
  };
  const nowInput = typeof input.now === 'function' ? input.now : null;
  const nowMs = () => {
    if (!nowInput) return Date.now();
    const value = Number(nowInput());
    return Number.isFinite(value) ? value : Date.now();
  };
  const isObject = (value) => (
    value && typeof value === 'object' && !Array.isArray(value)
  );
  const resolveSurfaceDefaultBounds = (surfaceName) => (
    resolveSchedulerSurfaceDefaultBounds(surfaceName, maxLimits)
  );
  const adaptiveSurfaceRoot = isObject(input.adaptiveSurfaces)
    ? input.adaptiveSurfaces
    : {};
  const adaptiveSurfaceConfig = isObject(adaptiveSurfaceRoot.surfaces)
    ? adaptiveSurfaceRoot.surfaces
    : adaptiveSurfaceRoot;
  const fdPressureRoot = isObject(adaptiveSurfaceRoot.fdPressure)
    ? adaptiveSurfaceRoot.fdPressure
    : null;
  const globalFdPressureThreshold = normalizeRatio(
    fdPressureRoot?.highPressureThreshold ?? fdPressureRoot?.pressureHighThreshold,
    null,
    { min: 0, max: 1 }
  );
  const adaptiveSurfaceControllersEnabled = adaptiveEnabled
    && adaptiveSurfaceRoot.enabled !== false;
  const adaptiveSurfaceDecisionTraceMax = normalizePositiveInt(
    adaptiveSurfaceRoot.decisionTraceMaxSamples
      ?? input.adaptiveDecisionTraceMaxSamples,
    512
  ) || 512;
  const adaptiveDecisionTrace = [];
  const surfaceQueueMap = new Map(Object.entries(DEFAULT_ADAPTIVE_SURFACE_QUEUE_MAP));
  const adaptiveSurfaceStates = new Map();
  for (const surfaceName of ADAPTIVE_SURFACE_KEYS) {
    const defaults = DEFAULT_ADAPTIVE_SURFACE_POLICY[surfaceName]
      || DEFAULT_ADAPTIVE_SURFACE_POLICY.parse;
    const bounds = resolveSurfaceDefaultBounds(surfaceName);
    const config = isObject(adaptiveSurfaceConfig?.[surfaceName])
      ? adaptiveSurfaceConfig[surfaceName]
      : {};
    const explicitQueues = Array.isArray(config.queues)
      ? config.queues
        .map((entry) => String(entry || '').trim())
        .filter(Boolean)
      : [];
    if (explicitQueues.length) {
      for (const queueName of explicitQueues) {
        surfaceQueueMap.set(queueName, surfaceName);
      }
    }
    const minConcurrency = Math.max(
      1,
      normalizePositiveInt(config.minConcurrency, bounds.minConcurrency) || bounds.minConcurrency
    );
    const maxConcurrency = Math.max(
      minConcurrency,
      normalizePositiveInt(config.maxConcurrency, bounds.maxConcurrency) || bounds.maxConcurrency
    );
    const initialConcurrency = Math.max(
      minConcurrency,
      Math.min(
        maxConcurrency,
        normalizePositiveInt(config.initialConcurrency, bounds.initialConcurrency)
          || bounds.initialConcurrency
      )
    );
    adaptiveSurfaceStates.set(surfaceName, {
      name: surfaceName,
      minConcurrency,
      maxConcurrency,
      currentConcurrency: initialConcurrency,
      upBacklogPerSlot: normalizeBacklogRatio(
        config.upBacklogPerSlot,
        defaults.upBacklogPerSlot,
        0.1
      ),
      downBacklogPerSlot: normalizeBacklogRatio(
        config.downBacklogPerSlot,
        defaults.downBacklogPerSlot,
        0
      ),
      upWaitMs: normalizeCooldownMs(config.upWaitMs, defaults.upWaitMs),
      downWaitMs: normalizeCooldownMs(config.downWaitMs, defaults.downWaitMs),
      upCooldownMs: normalizeCooldownMs(config.upCooldownMs, defaults.upCooldownMs),
      downCooldownMs: normalizeCooldownMs(config.downCooldownMs, defaults.downCooldownMs),
      oscillationGuardMs: normalizeCooldownMs(
        config.oscillationGuardMs,
        defaults.oscillationGuardMs
      ),
      targetUtilization: coerceUnitFraction(config.targetUtilization)
        ?? defaults.targetUtilization,
      ioPressureThreshold: normalizeRatio(
        config.ioPressureThreshold,
        defaults.ioPressureThreshold,
        { min: 0, max: 1 }
      ),
      memoryPressureThreshold: normalizeRatio(
        config.memoryPressureThreshold,
        defaults.memoryPressureThreshold,
        { min: 0, max: 1 }
      ),
      gcPressureThreshold: normalizeRatio(
        config.gcPressureThreshold,
        defaults.gcPressureThreshold,
        { min: 0, max: 1 }
      ),
      fdPressureThreshold: normalizeRatio(
        config.fdPressureThreshold,
        globalFdPressureThreshold ?? defaults.ioPressureThreshold,
        { min: 0, max: 1 }
      ),
      lastScaleUpAt: Number.NEGATIVE_INFINITY,
      lastScaleDownAt: Number.NEGATIVE_INFINITY,
      lastDecisionAt: 0,
      lastAction: 'hold',
      decisions: {
        up: 0,
        down: 0,
        hold: 0
      },
      lastDecision: null
    });
  }

  const queueConfig = input.queues || {};
  const queues = new Map();
  const queueOrder = [];
  const normalizeQueueName = (value) => (
    typeof value === 'string' && value.trim() ? value.trim() : null
  );
  const writeBackpressureInput = input.writeBackpressure
    && typeof input.writeBackpressure === 'object'
    ? input.writeBackpressure
    : null;
  const writeBackpressure = {
    enabled: writeBackpressureInput?.enabled !== false,
    writeQueue: normalizeQueueName(writeBackpressureInput?.writeQueue) || 'stage2.write',
    producerQueues: new Set(
      Array.isArray(writeBackpressureInput?.producerQueues)
        ? writeBackpressureInput.producerQueues
          .map((entry) => normalizeQueueName(entry))
          .filter(Boolean)
        : ['stage1.cpu', 'stage1.io', 'stage1.postings', 'stage2.relations', 'stage2.relations.io']
    ),
    pendingThreshold: Number.isFinite(Number(writeBackpressureInput?.pendingThreshold))
      ? Math.max(1, Math.floor(Number(writeBackpressureInput.pendingThreshold)))
      : 128,
    pendingBytesThreshold: Number.isFinite(Number(writeBackpressureInput?.pendingBytesThreshold))
      ? Math.max(1, Math.floor(Number(writeBackpressureInput.pendingBytesThreshold)))
      : (256 * 1024 * 1024),
    oldestWaitMsThreshold: Number.isFinite(Number(writeBackpressureInput?.oldestWaitMsThreshold))
      ? Math.max(1, Math.floor(Number(writeBackpressureInput.oldestWaitMsThreshold)))
      : 15000
  };
  const writeBackpressureState = {
    active: false,
    reasons: [],
    queue: writeBackpressure.writeQueue,
    pending: 0,
    pendingBytes: 0,
    oldestWaitMs: 0
  };
  const globalMaxInFlightBytes = normalizeByteLimit(input.maxInFlightBytes);
  const startedAtMs = nowMs();
  const counters = {
    scheduled: 0,
    started: 0,
    completed: 0,
    failed: 0,
    rejected: 0,
    starvation: 0,
    rejectedByReason: {
      maxPending: 0,
      maxPendingBytes: 0,
      shutdown: 0,
      cleared: 0,
      abort: 0,
      signalRequired: 0
    }
  };
  const runningBySurface = new Map();
  const telemetryStage = normalizeTelemetryStage(input.telemetryStage, 'init');
  const traceIntervalMs = Number.isFinite(Number(input.traceIntervalMs))
    ? Math.max(100, Math.floor(Number(input.traceIntervalMs)))
    : 1000;
  const queueDepthSnapshotIntervalMs = Number.isFinite(Number(input.queueDepthSnapshotIntervalMs))
    ? Math.max(1000, Math.floor(Number(input.queueDepthSnapshotIntervalMs)))
    : 5000;
  const queueDepthSnapshotsEnabled = input.queueDepthSnapshotsEnabled === true;
  const traceMaxSamples = Number.isFinite(Number(input.traceMaxSamples))
    ? Math.max(16, Math.floor(Number(input.traceMaxSamples)))
    : 512;
  const queueDepthSnapshotMaxSamples = Number.isFinite(Number(input.queueDepthSnapshotMaxSamples))
    ? Math.max(16, Math.floor(Number(input.queueDepthSnapshotMaxSamples)))
    : 512;
  const adaptiveMinIntervalMs = Number.isFinite(Number(input.adaptiveIntervalMs))
    ? Math.max(50, Math.floor(Number(input.adaptiveIntervalMs)))
    : 250;
  const adaptiveTargetUtilization = coerceUnitFraction(input.adaptiveTargetUtilization) ?? 0.85;
  const adaptiveStep = Number.isFinite(Number(input.adaptiveStep))
    ? Math.max(1, Math.floor(Number(input.adaptiveStep)))
    : 1;
  const adaptiveMemoryReserveMb = Number.isFinite(Number(input.adaptiveMemoryReserveMb))
    ? Math.max(0, Math.floor(Number(input.adaptiveMemoryReserveMb)))
    : 2048;
  const adaptiveMemoryPerTokenMb = Number.isFinite(Number(input.adaptiveMemoryPerTokenMb))
    ? Math.max(64, Math.floor(Number(input.adaptiveMemoryPerTokenMb)))
    : 1024;
  const telemetryTickMs = Number.isFinite(Number(input.telemetryTickMs))
    ? Math.max(100, Math.floor(Number(input.telemetryTickMs)))
    : 250;

  const createTokenState = () => ({
    cpu: { total: limitState.cpuTokens, used: 0 },
    io: { total: limitState.ioTokens, used: 0 },
    mem: { total: limitState.memoryTokens, used: 0 }
  });

  return {
    input,
    enabled,
    requireSignals,
    requiredSignalQueues,
    shouldRequireSignalForQueue,
    createSignalRequiredError,
    lowResourceMode,
    starvationMs,
    WAIT_TIME_SAMPLE_LIMIT,
    nowMs,
    normalizeTokenPool,
    normalizeByteLimit,
    normalizeMaxPending,
    normalizeByteCount,
    normalizeRequest,
    resolvePercentile,
    normalizeSurfaceName,
    normalizePositiveInt,
    normalizeNonNegativeInt,
    normalizeRatio,
    normalizeCooldownMs,
    normalizeBacklogRatio,
    limitState,
    baselineLimits,
    maxLimits,
    resolveSurfaceDefaultBounds,
    adaptiveEnabled,
    adaptiveSurfaceControllersEnabled,
    fdPressureRoot,
    globalFdPressureThreshold,
    adaptiveSurfaceDecisionTraceMax,
    adaptiveDecisionTrace,
    surfaceQueueMap,
    adaptiveSurfaceStates,
    queueConfig,
    queues,
    queueOrder,
    normalizeQueueName,
    writeBackpressure,
    writeBackpressureState,
    globalMaxInFlightBytes,
    startedAtMs,
    counters,
    runningBySurface,
    telemetryStage,
    traceIntervalMs,
    queueDepthSnapshotIntervalMs,
    queueDepthSnapshotsEnabled,
    traceMaxSamples,
    queueDepthSnapshotMaxSamples,
    adaptiveMinIntervalMs,
    adaptiveTargetUtilization,
    adaptiveStep,
    adaptiveMemoryReserveMb,
    adaptiveMemoryPerTokenMb,
    telemetryTickMs,
    createTokenState
  };
}
