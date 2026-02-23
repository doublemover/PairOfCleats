import { coerceUnitFraction } from '../number-coerce.js';
import { createSchedulerTelemetryCapture } from './scheduler-core-telemetry-capture.js';
import {
  normalizeByteCount,
  normalizeByteLimit,
  normalizeRequest,
  normalizeTokenPool,
  resolvePercentile
} from './scheduler-core-normalize.js';
import {
  cloneDecisionEntry,
  cloneQueueDepthEntries,
  cloneTraceEntries,
  normalizeTelemetryStage
} from './scheduler-telemetry.js';
import { createAdaptiveSurfaceControllerState } from './scheduler-core-adaptive-surfaces.js';
import {
  createWriteBackpressurePolicy,
  evaluateWriteBackpressureState
} from './scheduler-core-write-backpressure.js';
import { recordQueueWaitTimeSample } from './scheduler-core-wait-samples.js';
import {
  buildAdaptiveSurfaceSnapshotByName as buildAdaptiveSurfaceSnapshotByNameImpl,
  buildAdaptiveSurfaceSnapshots as buildAdaptiveSurfaceSnapshotsImpl
} from './scheduler-core-adaptive-snapshots.js';
import { resolveSchedulerSystemSignals } from './scheduler-core-system-signals.js';
import { collectSchedulerQueuePressure } from './scheduler-core-queue-pressure.js';
import { pickNextSchedulerQueue } from './scheduler-core-queue-selection.js';
import {
  buildSchedulerQueueStatsSnapshot,
  resolveSchedulerUtilization
} from './scheduler-core-stats.js';
import {
  decayAdaptiveTokenTotals,
  resolveAdaptiveIntervalMs,
  resolveAdaptiveMemoryHeadroom,
  smoothAdaptiveValue
} from './scheduler-core-token-policy.js';

/**
 * Create a build scheduler that coordinates CPU/IO/memory tokens across queues.
 * This is intentionally generic and can be wired into Stage1/2/4 and embeddings.
 * @param {{enabled?:boolean,lowResourceMode?:boolean,cpuTokens?:number,ioTokens?:number,memoryTokens?:number,starvationMs?:number,maxInFlightBytes?:number,queues?:Record<string,{priority?:number,maxPending?:number,maxPendingBytes?:number,maxInFlightBytes?:number}>,traceMaxSamples?:number,queueDepthSnapshotMaxSamples?:number,traceIntervalMs?:number,queueDepthSnapshotIntervalMs?:number,queueDepthSnapshotsEnabled?:boolean,writeBackpressure?:{enabled?:boolean,writeQueue?:string,producerQueues?:string[],pendingThreshold?:number,pendingBytesThreshold?:number,oldestWaitMsThreshold?:number}}} input
 * @returns {{schedule:(queueName:string,tokens?:{cpu?:number,io?:number,mem?:number,bytes?:number},fn?:()=>Promise<any>)=>Promise<any>,stats:()=>any,shutdown:()=>void,setLimits:(limits:{cpuTokens?:number,ioTokens?:number,memoryTokens?:number})=>void,setTelemetryOptions:(options:{stage?:string,queueDepthSnapshotsEnabled?:boolean,queueDepthSnapshotIntervalMs?:number,traceIntervalMs?:number})=>void}}
 */
export function createBuildScheduler(input = {}) {
  const enabled = input.enabled !== false;
  const lowResourceMode = input.lowResourceMode === true;
  const starvationMs = Number.isFinite(Number(input.starvationMs))
    ? Math.max(0, Math.floor(Number(input.starvationMs)))
    : 30000;
  const WAIT_TIME_SAMPLE_LIMIT = 64;
  let cpuTokens = normalizeTokenPool(input.cpuTokens);
  let ioTokens = normalizeTokenPool(input.ioTokens);
  let memoryTokens = normalizeTokenPool(input.memoryTokens);
  const adaptiveEnabled = input.adaptive === true;
  const baselineLimits = {
    cpu: cpuTokens,
    io: ioTokens,
    mem: memoryTokens
  };
  const maxLimits = {
    cpu: Math.max(baselineLimits.cpu, normalizeTokenPool(input.maxCpuTokens ?? cpuTokens)),
    io: Math.max(baselineLimits.io, normalizeTokenPool(input.maxIoTokens ?? ioTokens)),
    mem: Math.max(baselineLimits.mem, normalizeTokenPool(input.maxMemoryTokens ?? memoryTokens))
  };
  const nowInput = typeof input.now === 'function' ? input.now : null;
  const nowMs = () => {
    if (!nowInput) return Date.now();
    const value = Number(nowInput());
    return Number.isFinite(value) ? value : Date.now();
  };
  const {
    adaptiveSurfaceControllersEnabled,
    adaptiveSurfaceStates,
    resolveQueueSurface,
    adaptiveDecisionTrace,
    appendAdaptiveDecision,
    nextAdaptiveDecisionId
  } = createAdaptiveSurfaceControllerState({
    input,
    maxLimits
  });
  let lastMemorySignals = null;
  let lastSystemSignals = null;

  const queueConfig = input.queues || {};
  const queues = new Map();
  const queueOrder = [];
  const { writeBackpressure, writeBackpressureState } = createWriteBackpressurePolicy(input);
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
      cleared: 0
    }
  };
  let globalInFlightBytes = 0;

  const ensureQueue = (name) => {
    if (queues.has(name)) return queues.get(name);
    const cfg = queueConfig[name] || {};
    const surface = resolveQueueSurface(name, cfg?.surface);
    const state = {
      name,
      surface,
      priority: Number.isFinite(Number(cfg.priority)) ? Number(cfg.priority) : 50,
      weight: Number.isFinite(Number(cfg.weight)) ? Math.max(1, Math.floor(Number(cfg.weight))) : 1,
      floorCpu: Number.isFinite(Number(cfg.floorCpu)) ? Math.max(0, Math.floor(Number(cfg.floorCpu))) : 0,
      floorIo: Number.isFinite(Number(cfg.floorIo)) ? Math.max(0, Math.floor(Number(cfg.floorIo))) : 0,
      floorMem: Number.isFinite(Number(cfg.floorMem)) ? Math.max(0, Math.floor(Number(cfg.floorMem))) : 0,
      maxPending: Number.isFinite(Number(cfg.maxPending)) ? Math.max(1, Math.floor(Number(cfg.maxPending))) : null,
      maxPendingBytes: normalizeByteLimit(cfg.maxPendingBytes),
      maxInFlightBytes: normalizeByteLimit(cfg.maxInFlightBytes),
      pending: [],
      pendingSearchCursor: 0,
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
        rejectedMaxPendingBytes: 0
      }
    };
    queues.set(name, state);
    queueOrder.push(state);
    queueOrder.sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));
    return state;
  };

  const applyQueueConfig = (queue, config) => {
    if (!queue || !config || typeof config !== 'object') return;
    const previousSurface = queue.surface;
    const runningBeforeSurfaceChange = Math.max(0, Number(queue.running) || 0);
    if (Number.isFinite(Number(config.priority))) {
      queue.priority = Number(config.priority);
    }
    if (Number.isFinite(Number(config.maxPending))) {
      queue.maxPending = Math.max(1, Math.floor(Number(config.maxPending)));
    }
    if (config.maxPendingBytes != null) {
      queue.maxPendingBytes = normalizeByteLimit(config.maxPendingBytes);
    }
    if (config.maxInFlightBytes != null) {
      queue.maxInFlightBytes = normalizeByteLimit(config.maxInFlightBytes);
    }
    if (Number.isFinite(Number(config.weight))) {
      queue.weight = Math.max(1, Math.floor(Number(config.weight)));
    }
    if (Number.isFinite(Number(config.floorCpu))) {
      queue.floorCpu = Math.max(0, Math.floor(Number(config.floorCpu)));
    }
    if (Number.isFinite(Number(config.floorIo))) {
      queue.floorIo = Math.max(0, Math.floor(Number(config.floorIo)));
    }
    if (Number.isFinite(Number(config.floorMem))) {
      queue.floorMem = Math.max(0, Math.floor(Number(config.floorMem)));
    }
    if (Object.prototype.hasOwnProperty.call(config, 'surface')) {
      queue.surface = resolveQueueSurface(queue.name, config.surface);
      if (runningBeforeSurfaceChange > 0 && previousSurface !== queue.surface) {
        bumpSurfaceRunning(previousSurface, -runningBeforeSurfaceChange);
        bumpSurfaceRunning(queue.surface, runningBeforeSurfaceChange);
      }
    }
    queueOrder.sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));
  };

  const evaluateWriteBackpressure = () => {
    return evaluateWriteBackpressureState({
      writeBackpressure,
      writeBackpressureState,
      queues,
      normalizeByteCount,
      nowMs
    });
  };

  const registerQueue = (queueName, config = {}) => {
    const queue = ensureQueue(queueName);
    applyQueueConfig(queue, config);
    return queue;
  };

  const registerQueues = (configMap = {}) => {
    if (!configMap || typeof configMap !== 'object') return;
    for (const [queueName, config] of Object.entries(configMap)) {
      registerQueue(queueName, config);
    }
  };
  const runningBySurface = new Map();
  const bumpSurfaceRunning = (surfaceName, delta) => {
    if (!surfaceName || !Number.isFinite(Number(delta)) || Number(delta) === 0) return;
    const current = Math.max(0, Number(runningBySurface.get(surfaceName)) || 0);
    const next = Math.max(0, current + Number(delta));
    if (next > 0) {
      runningBySurface.set(surfaceName, next);
      return;
    }
    runningBySurface.delete(surfaceName);
  };

  /**
   * Track bounded wait-time samples so queue picking can age tail-latency work.
   * The fixed sample cap prevents unbounded growth for long-lived schedulers.
   * Uses a fixed-size ring buffer once the sample cap is reached so long-lived
   * queues avoid repeated `Array#shift` compaction on every completion.
   *
   * @param {{stats?:{lastWaitMs?:number,waitP95Ms?:number,waitSamples?:number[],waitSampleCursor?:number}}} queue
   * @param {number} waitedMs
   */
  const recordQueueWaitTime = (queue, waitedMs) => {
    recordQueueWaitTimeSample({
      queue,
      waitedMs,
      sampleLimit: WAIT_TIME_SAMPLE_LIMIT,
      resolvePercentile
    });
  };
  let telemetryStage = normalizeTelemetryStage(input.telemetryStage, 'init');
  let traceIntervalMs = Number.isFinite(Number(input.traceIntervalMs))
    ? Math.max(100, Math.floor(Number(input.traceIntervalMs)))
    : 1000;
  let queueDepthSnapshotIntervalMs = Number.isFinite(Number(input.queueDepthSnapshotIntervalMs))
    ? Math.max(1000, Math.floor(Number(input.queueDepthSnapshotIntervalMs)))
    : 5000;
  let queueDepthSnapshotsEnabled = input.queueDepthSnapshotsEnabled === true;
  const traceMaxSamples = Number.isFinite(Number(input.traceMaxSamples))
    ? Math.max(16, Math.floor(Number(input.traceMaxSamples)))
    : 512;
  const queueDepthSnapshotMaxSamples = Number.isFinite(Number(input.queueDepthSnapshotMaxSamples))
    ? Math.max(16, Math.floor(Number(input.queueDepthSnapshotMaxSamples)))
    : 512;
  const cloneTokenState = () => ({
    cpu: { ...tokens.cpu },
    io: { ...tokens.io },
    mem: { ...tokens.mem }
  });
  const telemetryCapture = createSchedulerTelemetryCapture({
    nowMs,
    startedAtMs,
    queueOrder,
    normalizeByteCount,
    evaluateWriteBackpressure,
    writeBackpressureState,
    cloneTokenState,
    traceMaxSamples,
    queueDepthSnapshotMaxSamples,
    getStage: () => telemetryStage,
    getTraceIntervalMs: () => traceIntervalMs,
    getQueueDepthSnapshotIntervalMs: () => queueDepthSnapshotIntervalMs,
    isQueueDepthSnapshotsEnabled: () => queueDepthSnapshotsEnabled
  });
  const {
    captureSchedulingTrace,
    captureQueueDepthSnapshot,
    captureTelemetryIfDue
  } = telemetryCapture;

  const buildAdaptiveSurfaceSnapshotByName = (surfaceName, at = nowMs()) => (
    buildAdaptiveSurfaceSnapshotByNameImpl({
      surfaceName,
      adaptiveSurfaceStates,
      queueOrder,
      normalizeByteCount,
      at
    })
  );

  const buildAdaptiveSurfaceSnapshots = (at = nowMs()) => (
    buildAdaptiveSurfaceSnapshotsImpl({
      adaptiveSurfaceStates,
      queueOrder,
      normalizeByteCount,
      at
    })
  );

  const readSystemSignals = (at = nowMs()) => {
    const resolved = resolveSchedulerSystemSignals({
      at,
      input,
      telemetryStage,
      cloneTokenState,
      tokens,
      lastMemorySignals
    });
    lastMemorySignals = resolved.nextMemorySignals;
    return resolved.signals;
  };

  const tokenState = () => ({
    cpu: { total: cpuTokens, used: 0 },
    io: { total: ioTokens, used: 0 },
    mem: { total: memoryTokens, used: 0 }
  });
  let tokens = tokenState();
  let shuttingDown = false;
  let lastAdaptiveAt = 0;
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
  let adaptiveCurrentIntervalMs = adaptiveMinIntervalMs;
  let adaptiveMode = 'steady';
  let smoothedUtilization = null;
  let smoothedPendingPressure = null;
  let smoothedStarvation = null;
  let burstModeUntilMs = 0;
  const telemetryTickMs = Number.isFinite(Number(input.telemetryTickMs))
    ? Math.max(100, Math.floor(Number(input.telemetryTickMs)))
    : 250;
  const telemetryTimer = enabled && !lowResourceMode
    ? setInterval(() => {
      if (shuttingDown) return;
      captureTelemetryIfDue('interval');
    }, telemetryTickMs)
    : null;
  telemetryTimer?.unref?.();

  const countSurfaceRunning = (surfaceName) => (
    surfaceName
      ? Math.max(0, Number(runningBySurface.get(surfaceName)) || 0)
      : 0
  );

  /**
   * Adapt per-surface concurrency caps from queue backlog plus system signals.
   *
   * Cooldown windows and oscillation guards intentionally dampen flip-flopping
   * when backlog and pressure metrics hover near thresholds.
   *
   * @param {number} now
   */
  const maybeAdaptSurfaceControllers = (now) => {
    if (!adaptiveSurfaceControllersEnabled) return;
    const at = Number.isFinite(Number(now)) ? Number(now) : nowMs();
    const snapshots = buildAdaptiveSurfaceSnapshots(at);
    const signals = readSystemSignals(at);
    lastSystemSignals = signals;
    for (const [surfaceName, state] of adaptiveSurfaceStates.entries()) {
      const snapshot = snapshots[surfaceName];
      if (!snapshot) continue;
      const previousConcurrency = state.currentConcurrency;
      const running = Math.max(
        Math.max(0, Number(snapshot.running) || 0),
        countSurfaceRunning(surfaceName)
      );
      const backlogPerSlot = Math.max(0, Number(snapshot.backlogPerSlot) || 0);
      const oldestWaitMs = Math.max(0, Number(snapshot.oldestWaitMs) || 0);
      const ioPressureScore = Math.max(0, Number(snapshot.ioPressureScore) || 0);
      const cpuUtilization = Math.max(
        0,
        Number(signals?.cpu?.tokenUtilization) || 0,
        Number(signals?.cpu?.loadRatio) || 0
      );
      const memoryPressure = Math.max(0, Number(signals?.memory?.pressureScore) || 0);
      const gcPressure = Math.max(0, Number(signals?.memory?.gcPressureScore) || 0);
      let action = 'hold';
      let reason = 'steady';
      if (
        memoryPressure >= state.memoryPressureThreshold
        || gcPressure >= state.gcPressureThreshold
        || ioPressureScore >= state.ioPressureThreshold
      ) {
        action = 'down';
        reason = memoryPressure >= state.memoryPressureThreshold
          ? 'memory-pressure'
          : (gcPressure >= state.gcPressureThreshold ? 'gc-pressure' : 'io-pressure');
      } else if (
        backlogPerSlot >= state.upBacklogPerSlot
        && oldestWaitMs >= state.upWaitMs
        && cpuUtilization <= Math.max(1, state.targetUtilization + 0.15)
      ) {
        action = 'up';
        reason = 'backlog';
      } else if (
        backlogPerSlot <= state.downBacklogPerSlot
        && oldestWaitMs <= state.downWaitMs
        && running < state.currentConcurrency
      ) {
        action = 'down';
        reason = 'drain';
      }
      let nextConcurrency = state.currentConcurrency;
      if (action === 'up') {
        const inUpCooldown = (at - state.lastScaleUpAt) < state.upCooldownMs;
        const inOscillationGuard = state.lastAction === 'down'
          && (at - state.lastScaleDownAt) < state.oscillationGuardMs;
        if (
          state.currentConcurrency < state.maxConcurrency
          && !inUpCooldown
          && !inOscillationGuard
        ) {
          nextConcurrency = Math.min(state.maxConcurrency, state.currentConcurrency + 1);
        } else {
          action = 'hold';
          reason = inUpCooldown ? 'up-cooldown' : (inOscillationGuard ? 'oscillation-guard' : 'at-max');
        }
      } else if (action === 'down') {
        const inDownCooldown = (at - state.lastScaleDownAt) < state.downCooldownMs;
        const inOscillationGuard = state.lastAction === 'up'
          && (at - state.lastScaleUpAt) < state.oscillationGuardMs;
        if (
          state.currentConcurrency > state.minConcurrency
          && !inDownCooldown
          && !inOscillationGuard
        ) {
          nextConcurrency = Math.max(state.minConcurrency, state.currentConcurrency - 1);
        } else {
          action = 'hold';
          reason = inDownCooldown ? 'down-cooldown' : (inOscillationGuard ? 'oscillation-guard' : 'at-min');
        }
      }
      if (nextConcurrency !== state.currentConcurrency) {
        if (nextConcurrency > state.currentConcurrency) {
          state.lastScaleUpAt = at;
        } else {
          state.lastScaleDownAt = at;
        }
        state.currentConcurrency = nextConcurrency;
      } else {
        action = 'hold';
      }
      state.lastDecisionAt = at;
      state.lastAction = action;
      state.decisions[action] = (state.decisions[action] || 0) + 1;
      state.lastDecision = {
        at,
        action,
        reason,
        previousConcurrency,
        nextConcurrency: state.currentConcurrency,
        backlogPerSlot,
        oldestWaitMs,
        ioPressureScore,
        cpuUtilization,
        memoryPressure,
        gcPressure
      };
      const adaptiveDecisionId = nextAdaptiveDecisionId();
      appendAdaptiveDecision({
        id: adaptiveDecisionId,
        at,
        surface: surfaceName,
        action,
        reason,
        nextConcurrency: state.currentConcurrency,
        snapshot: {
          pending: snapshot.pending,
          running,
          backlogPerSlot,
          oldestWaitMs,
          ioPressureScore
        },
        signals: {
          cpu: signals?.cpu && typeof signals.cpu === 'object' ? { ...signals.cpu } : null,
          memory: signals?.memory && typeof signals.memory === 'object' ? { ...signals.memory } : null
        }
      });
    }
  };

  /**
   * Adapt global cpu/io/memory token ceilings.
   *
   * Behavior notes:
   * - `burst` mode opportunistically scales faster under sustained demand.
   * - `settle` and steady decay modes reduce totals after transient spikes.
   * - Memory headroom gating is the hard safety rail for all scale-up paths.
   */
  const maybeAdaptTokens = () => {
    if (!adaptiveEnabled || shuttingDown) return;
    const now = nowMs();
    if ((now - lastAdaptiveAt) < adaptiveCurrentIntervalMs) return;
    lastAdaptiveAt = now;
    maybeAdaptSurfaceControllers(now);
    const {
      totalPending,
      totalPendingBytes,
      totalRunning,
      totalRunningBytes,
      starvedQueues,
      floorCpu,
      floorIo,
      floorMem
    } = collectSchedulerQueuePressure({
      queueOrder,
      normalizeByteCount
    });
    const cpuFloor = Math.max(baselineLimits.cpu, floorCpu);
    const ioFloor = Math.max(baselineLimits.io, floorIo);
    const memFloor = Math.max(baselineLimits.mem, floorMem);
    const tokenBudget = Math.max(1, tokens.cpu.total + tokens.io.total);
    const memoryTokenBudgetBytes = Math.max(1, tokens.mem.total) * adaptiveMemoryPerTokenMb * 1024 * 1024;
    const pendingBytePressure = totalPendingBytes > Math.max(
      4 * 1024 * 1024,
      Math.floor(memoryTokenBudgetBytes * 0.2)
    );
    const runningBytePressure = totalRunningBytes > Math.max(
      8 * 1024 * 1024,
      Math.floor(memoryTokenBudgetBytes * 0.35)
    );
    const bytePressure = pendingBytePressure || runningBytePressure;
    const pendingDemand = totalPending > 0;
    const pendingPressure = totalPending > Math.max(1, Math.floor(tokenBudget * 0.35));
    const mostlyIdle = totalPending === 0 && totalRunning === 0 && totalRunningBytes === 0;
    const cpuUtilization = tokens.cpu.total > 0 ? (tokens.cpu.used / tokens.cpu.total) : 0;
    const ioUtilization = tokens.io.total > 0 ? (tokens.io.used / tokens.io.total) : 0;
    const memUtilization = tokens.mem.total > 0 ? (tokens.mem.used / tokens.mem.total) : 0;
    const utilization = Math.max(cpuUtilization, ioUtilization, memUtilization);
    smoothedUtilization = smoothAdaptiveValue(smoothedUtilization, utilization);
    smoothedPendingPressure = smoothAdaptiveValue(
      smoothedPendingPressure,
      Math.max(totalPending / Math.max(1, tokenBudget), totalPendingBytes / Math.max(1, memoryTokenBudgetBytes))
    );
    smoothedStarvation = smoothAdaptiveValue(
      smoothedStarvation,
      queueOrder.length > 0 ? (starvedQueues / queueOrder.length) : 0
    );
    const smoothedUtilizationDeficit = (smoothedUtilization ?? utilization) < adaptiveTargetUtilization;
    const severeUtilizationDeficit = utilization < (adaptiveTargetUtilization * 0.7);
    const starvationScore = starvedQueues + Math.round((smoothedStarvation ?? 0) * 2);
    adaptiveCurrentIntervalMs = resolveAdaptiveIntervalMs({
      adaptiveMinIntervalMs,
      pendingPressure,
      bytePressure,
      starvationScore,
      mostlyIdle
    });
    const {
      headroomBytes,
      memoryLowHeadroom,
      memoryHighHeadroom,
      memoryTokenHeadroomCap,
      nextMemTotal
    } = resolveAdaptiveMemoryHeadroom({
      signals: lastSystemSignals,
      adaptiveMemoryReserveMb,
      adaptiveMemoryPerTokenMb,
      baselineMemLimit: baselineLimits.mem,
      maxMemLimit: maxLimits.mem,
      currentMemTotal: tokens.mem.total,
      currentMemUsed: tokens.mem.used
    });
    tokens.mem.total = nextMemTotal;

    if (memoryLowHeadroom) {
      adaptiveMode = 'steady';
      decayAdaptiveTokenTotals({
        tokens,
        cpuFloor,
        ioFloor,
        memFloor,
        adaptiveStep,
        memoryTokenHeadroomCap
      });
      return;
    }

    if (memoryHighHeadroom && pendingDemand && smoothedUtilizationDeficit) {
      burstModeUntilMs = Math.max(burstModeUntilMs, now + 1500);
    }
    const burstMode = now < burstModeUntilMs;
    const queueStarvation = starvationScore > 0;
    const shouldScaleFromHeadroom = memoryHighHeadroom
      && pendingDemand
      && (smoothedUtilizationDeficit || queueStarvation || burstMode)
      && (totalRunning > 0 || queueStarvation || severeUtilizationDeficit);
    const shouldScale = memoryHighHeadroom && (
      pendingPressure
      || bytePressure
      || queueStarvation
      || burstMode
      || shouldScaleFromHeadroom
      || (pendingDemand && smoothedUtilizationDeficit)
    );
    if (shouldScale) {
      adaptiveMode = burstMode ? 'burst' : 'steady';
      const pressureScale = pendingPressure || bytePressure;
      const scaleStep = (pressureScale && (queueStarvation || severeUtilizationDeficit))
        ? adaptiveStep + 2
        : ((pressureScale || queueStarvation) ? adaptiveStep + 1 : adaptiveStep);
      const effectiveScaleStep = burstMode ? (scaleStep + 1) : scaleStep;
      const nextCpu = Math.min(maxLimits.cpu, tokens.cpu.total + effectiveScaleStep);
      const nextIo = Math.min(maxLimits.io, tokens.io.total + effectiveScaleStep);
      const nextMem = Math.min(maxLimits.mem, memoryTokenHeadroomCap, tokens.mem.total + adaptiveStep);
      tokens.cpu.total = nextCpu;
      tokens.io.total = nextIo;
      tokens.mem.total = nextMem;
      return;
    }
    const settleMode = !mostlyIdle
      && !pendingDemand
      && !bytePressure
      && now >= burstModeUntilMs
      && utilization >= adaptiveTargetUtilization
      && (
        tokens.cpu.total > baselineLimits.cpu
        || tokens.io.total > baselineLimits.io
        || tokens.mem.total > baselineLimits.mem
      );
    if (settleMode) {
      adaptiveMode = 'settle';
      decayAdaptiveTokenTotals({
        tokens,
        cpuFloor,
        ioFloor,
        memFloor,
        adaptiveStep
      });
      return;
    }

    if (
      memoryHighHeadroom
      && headroomBytes > (adaptiveMemoryReserveMb * 1024 * 1024)
      && (totalPending > 0 || totalPendingBytes > 0)
      && tokens.mem.total < memoryTokenHeadroomCap
    ) {
      tokens.mem.total = Math.min(memoryTokenHeadroomCap, tokens.mem.total + adaptiveStep);
    }

    if (mostlyIdle) {
      adaptiveMode = 'steady';
      decayAdaptiveTokenTotals({
        tokens,
        cpuFloor,
        ioFloor,
        memFloor,
        adaptiveStep
      });
    }
  };

  /**
   * Resolve whether a request can start against token and backpressure state.
   *
   * `backpressureState` is optional so callers scanning many candidates can
   * reuse one snapshot and avoid re-evaluating write queue pressure for every
   * pending item.
   *
   * @param {any} queue
   * @param {{cpu?:number,io?:number,mem?:number,bytes?:number}} req
   * @param {object|null} [backpressureState]
   * @returns {boolean}
   */
  const canStart = (queue, req, backpressureState = null) => {
    const normalized = normalizeRequest(req);
    const resolvedBackpressure = backpressureState || evaluateWriteBackpressure();
    const producerBlocked = resolvedBackpressure.active
      && queue
      && queue.name !== writeBackpressure.writeQueue
      && writeBackpressure.producerQueues.has(queue.name);
    if (producerBlocked) {
      return false;
    }
    if (adaptiveSurfaceControllersEnabled && queue?.surface) {
      const surfaceState = adaptiveSurfaceStates.get(queue.surface);
      if (surfaceState) {
        // Surface caps should constrain CPU-heavy work. Pure IO/memory tasks are
        // often dependencies of CPU tasks already counted against the same
        // surface; blocking them can deadlock nested scheduling (CPU -> IO/proc).
        const bypassSurfaceCap = normalized.cpu === 0
          && (normalized.io > 0 || normalized.mem > 0);
        const running = countSurfaceRunning(queue.surface);
        if (!bypassSurfaceCap && running >= surfaceState.currentConcurrency) {
          return false;
        }
      }
    }
    if (
      tokens.cpu.used + normalized.cpu > tokens.cpu.total
      || tokens.io.used + normalized.io > tokens.io.total
      || tokens.mem.used + normalized.mem > tokens.mem.total
    ) {
      return false;
    }
    const queueCap = queue?.maxInFlightBytes;
    if (queueCap && normalized.bytes > 0) {
      const queueBytes = normalizeByteCount(queue.inFlightBytes);
      const oversizeSingle = queueBytes === 0;
      if (!oversizeSingle && queueBytes + normalized.bytes > queueCap) {
        return false;
      }
    }
    if (globalMaxInFlightBytes && normalized.bytes > 0) {
      const runningBytes = normalizeByteCount(globalInFlightBytes);
      const oversizeSingle = runningBytes === 0;
      if (!oversizeSingle && runningBytes + normalized.bytes > globalMaxInFlightBytes) {
        return false;
      }
    }
    return true;
  };

  const reserve = (queue, req) => {
    const normalized = normalizeRequest(req);
    tokens.cpu.used += normalized.cpu;
    tokens.io.used += normalized.io;
    tokens.mem.used += normalized.mem;
    if (queue && normalized.bytes > 0) {
      queue.inFlightBytes = normalizeByteCount(queue.inFlightBytes) + normalized.bytes;
      globalInFlightBytes = normalizeByteCount(globalInFlightBytes) + normalized.bytes;
    }
    return normalized;
  };

  const release = (queue, used) => {
    const normalized = normalizeRequest(used || {});
    tokens.cpu.used = Math.max(0, tokens.cpu.used - normalized.cpu);
    tokens.io.used = Math.max(0, tokens.io.used - normalized.io);
    tokens.mem.used = Math.max(0, tokens.mem.used - normalized.mem);
    if (queue && normalized.bytes > 0) {
      queue.inFlightBytes = Math.max(0, normalizeByteCount(queue.inFlightBytes) - normalized.bytes);
      globalInFlightBytes = Math.max(
        0,
        normalizeByteCount(globalInFlightBytes) - normalized.bytes
      );
    }
  };

  const pump = () => {
    if (shuttingDown) return;
    while (true) {
      maybeAdaptTokens();
      const backpressureState = evaluateWriteBackpressure();
      const pick = pickNextSchedulerQueue({
        queueOrder,
        nowMs,
        starvationMs,
        backpressureState,
        canStart
      });
      if (!pick) return;
      const { queue, starved, index, item: next } = pick;
      if (!next) return;
      queue.pending.splice(index, 1);
      if (!queue.pending.length) {
        queue.pendingSearchCursor = 0;
      }
      queue.pendingBytes = Math.max(0, normalizeByteCount(queue.pendingBytes) - normalizeByteCount(next.bytes));
      queue.running += 1;
      bumpSurfaceRunning(queue.surface, 1);
      queue.stats.started += 1;
      counters.started += 1;
      if (starved) {
        queue.stats.starvation += 1;
        counters.starvation += 1;
      }
      recordQueueWaitTime(queue, nowMs() - next.enqueuedAt);
      const used = reserve(queue, next.tokens);
      const done = Promise.resolve()
        .then(next.fn)
        .then(
          (value) => {
            queue.stats.completed += 1;
            counters.completed += 1;
            next.resolve(value);
          },
          (err) => {
            queue.stats.failed += 1;
            counters.failed += 1;
            next.reject(err);
          }
        )
        .finally(() => {
          queue.running -= 1;
          bumpSurfaceRunning(queue.surface, -1);
          release(queue, used);
          pump();
        });
      void done;
    }
  };

  const schedule = (queueName, tokensReq = { cpu: 1 }, fn) => {
    if (typeof tokensReq === 'function') {
      fn = tokensReq;
      tokensReq = { cpu: 1 };
    }
    if (typeof fn !== 'function') {
      return Promise.reject(new Error('schedule requires a function'));
    }
    if (!enabled) {
      return Promise.resolve().then(fn);
    }
    if (shuttingDown) {
      counters.rejected += 1;
      counters.rejectedByReason.shutdown += 1;
      return Promise.reject(new Error('scheduler is shut down'));
    }
    const normalizedReq = normalizeRequest(tokensReq || {});
    const queue = ensureQueue(queueName);
    if (queue.maxPending && queue.pending.length >= queue.maxPending) {
      queue.stats.rejected += 1;
      queue.stats.rejectedMaxPending += 1;
      queue.stats.scheduled += 1;
      counters.scheduled += 1;
      counters.rejected += 1;
      counters.rejectedByReason.maxPending += 1;
      return Promise.reject(new Error(`queue ${queueName} is at maxPending`));
    }
    if (queue.maxPendingBytes && normalizedReq.bytes > 0) {
      const pendingBytes = normalizeByteCount(queue.pendingBytes);
      const nextPendingBytes = pendingBytes + normalizedReq.bytes;
      const oversizeSingle = pendingBytes === 0 && queue.pending.length === 0;
      if (!oversizeSingle && nextPendingBytes > queue.maxPendingBytes) {
        queue.stats.rejected += 1;
        queue.stats.rejectedMaxPendingBytes += 1;
        queue.stats.scheduled += 1;
        counters.scheduled += 1;
        counters.rejected += 1;
        counters.rejectedByReason.maxPendingBytes += 1;
        return Promise.reject(new Error(`queue ${queueName} is at maxPendingBytes`));
      }
    }
    return new Promise((resolve, reject) => {
      queue.pending.push({
        tokens: normalizedReq,
        bytes: normalizedReq.bytes,
        fn,
        resolve,
        reject,
        enqueuedAt: nowMs()
      });
      queue.pendingBytes = normalizeByteCount(queue.pendingBytes) + normalizedReq.bytes;
      maybeAdaptTokens();
      queue.stats.scheduled += 1;
      counters.scheduled += 1;
      captureTelemetryIfDue('schedule');
      pump();
    });
  };

  const clearQueue = (queueName, reason = 'scheduler queue cleared') => {
    const queue = queues.get(queueName);
    if (!queue || !queue.pending.length) return 0;
    const error = new Error(reason);
    const cleared = queue.pending.splice(0, queue.pending.length);
    let clearedBytes = 0;
    for (const item of cleared) {
      clearedBytes += normalizeByteCount(item?.bytes);
      queue.stats.rejected += 1;
      counters.rejected += 1;
      counters.rejectedByReason.cleared += 1;
      try {
        item.reject(error);
      } catch {}
    }
    queue.pendingBytes = Math.max(0, normalizeByteCount(queue.pendingBytes) - clearedBytes);
    queue.pendingSearchCursor = 0;
    return cleared.length;
  };

  const stats = () => {
    captureTelemetryIfDue('stats');
    const {
      queueStats,
      activity
    } = buildSchedulerQueueStatsSnapshot({
      queueOrder,
      nowMs,
      normalizeByteCount
    });
    const cpuUtilization = resolveSchedulerUtilization(tokens.cpu.used, tokens.cpu.total);
    const ioUtilization = resolveSchedulerUtilization(tokens.io.used, tokens.io.total);
    const memUtilization = resolveSchedulerUtilization(tokens.mem.used, tokens.mem.total);
    const adaptiveSurfaces = {};
    for (const [surfaceName, state] of adaptiveSurfaceStates.entries()) {
      const snapshot = buildAdaptiveSurfaceSnapshotByName(surfaceName);
      adaptiveSurfaces[surfaceName] = {
        minConcurrency: state.minConcurrency,
        maxConcurrency: state.maxConcurrency,
        currentConcurrency: state.currentConcurrency,
        decisions: { ...state.decisions },
        lastAction: state.lastAction,
        lastDecisionAt: state.lastDecisionAt,
        lastDecision: state.lastDecision
          ? { ...state.lastDecision }
          : null,
        snapshot
      };
    }
    return {
      queues: queueStats,
      counters: {
        ...counters,
        rejectedByReason: { ...counters.rejectedByReason }
      },
      activity,
      adaptive: {
        enabled: adaptiveEnabled,
        baseline: baselineLimits,
        max: maxLimits,
        targetUtilization: adaptiveTargetUtilization,
        step: adaptiveStep,
        memoryReserveMb: adaptiveMemoryReserveMb,
        memoryPerTokenMb: adaptiveMemoryPerTokenMb,
        maxInFlightBytes: globalMaxInFlightBytes,
        intervalMs: adaptiveCurrentIntervalMs,
        mode: adaptiveMode,
        smoothedUtilization: smoothedUtilization ?? 0,
        smoothedPendingPressure: smoothedPendingPressure ?? 0,
        smoothedStarvation: smoothedStarvation ?? 0,
        surfaceControllersEnabled: adaptiveSurfaceControllersEnabled,
        surfaces: adaptiveSurfaces,
        decisionTrace: adaptiveDecisionTrace.map((entry) => cloneDecisionEntry(entry)),
        signals: lastSystemSignals && typeof lastSystemSignals === 'object'
          ? {
            cpu: lastSystemSignals.cpu && typeof lastSystemSignals.cpu === 'object'
              ? { ...lastSystemSignals.cpu }
              : null,
            memory: lastSystemSignals.memory && typeof lastSystemSignals.memory === 'object'
              ? { ...lastSystemSignals.memory }
              : null
          }
          : null,
        writeBackpressure: {
          ...evaluateWriteBackpressure(),
          producerQueues: Array.from(writeBackpressure.producerQueues)
        }
      },
      utilization: {
        cpu: cpuUtilization,
        io: ioUtilization,
        mem: memUtilization,
        overall: Math.max(cpuUtilization, ioUtilization, memUtilization)
      },
      tokens: {
        cpu: { ...tokens.cpu },
        io: { ...tokens.io },
        mem: { ...tokens.mem }
      },
      telemetry: {
        stage: telemetryStage,
        traceIntervalMs,
        queueDepthSnapshotIntervalMs,
        queueDepthSnapshotsEnabled,
        schedulingTrace: cloneTraceEntries(telemetryCapture.getSchedulingTrace()),
        queueDepthSnapshots: cloneQueueDepthEntries(telemetryCapture.getQueueDepthSnapshots())
      }
    };
  };

  const shutdown = () => {
    shuttingDown = true;
    if (telemetryTimer) clearInterval(telemetryTimer);
  };

  const setLimits = (limits = {}) => {
    if (Number.isFinite(Number(limits.cpuTokens))) {
      cpuTokens = Math.max(1, Math.floor(Number(limits.cpuTokens)));
    }
    if (Number.isFinite(Number(limits.ioTokens))) {
      ioTokens = Math.max(1, Math.floor(Number(limits.ioTokens)));
    }
    if (Number.isFinite(Number(limits.memoryTokens))) {
      memoryTokens = Math.max(1, Math.floor(Number(limits.memoryTokens)));
    }
    tokens.cpu.total = cpuTokens;
    tokens.io.total = ioTokens;
    tokens.mem.total = memoryTokens;
    captureSchedulingTrace({ reason: 'set-limits', force: true });
    pump();
  };

  const setTelemetryOptions = (options = {}) => {
    if (typeof options?.stage === 'string') {
      telemetryStage = normalizeTelemetryStage(options.stage, telemetryStage);
    }
    if (Object.prototype.hasOwnProperty.call(options, 'queueDepthSnapshotsEnabled')) {
      queueDepthSnapshotsEnabled = options.queueDepthSnapshotsEnabled === true;
    }
    if (Number.isFinite(Number(options?.traceIntervalMs))) {
      traceIntervalMs = Math.max(100, Math.floor(Number(options.traceIntervalMs)));
    }
    if (Number.isFinite(Number(options?.queueDepthSnapshotIntervalMs))) {
      queueDepthSnapshotIntervalMs = Math.max(1000, Math.floor(Number(options.queueDepthSnapshotIntervalMs)));
    }
    const now = nowMs();
    captureSchedulingTrace({ now, reason: 'telemetry-options', force: true });
    if (queueDepthSnapshotsEnabled) {
      captureQueueDepthSnapshot({ now, reason: 'telemetry-options', force: true });
    }
  };

  captureSchedulingTrace({ reason: 'init', force: true });

  return {
    schedule,
    stats,
    shutdown,
    setLimits,
    registerQueue,
    registerQueues,
    clearQueue,
    setTelemetryOptions,
    enabled,
    lowResourceMode
  };
}
