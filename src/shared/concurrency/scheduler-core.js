import os from 'node:os';
import { coerceUnitFraction } from '../number-coerce.js';
import { ADAPTIVE_SURFACE_KEYS, DEFAULT_ADAPTIVE_SURFACE_POLICY, DEFAULT_ADAPTIVE_SURFACE_QUEUE_MAP } from './adaptive-surfaces.js';
import { createSchedulerTelemetryCapture } from './scheduler-core-telemetry-capture.js';
import {
  cloneDecisionEntry,
  cloneQueueDepthEntries,
  cloneTraceEntries,
  normalizeTelemetryStage
} from './scheduler-telemetry.js';

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
  const normalizeTokenPool = (value) => {
    if (value == null) return 1;
    const parsed = Math.floor(Number(value));
    if (!Number.isFinite(parsed)) return 1;
    // Zero-token pools deadlock queued work that requires that resource.
    return Math.max(1, parsed);
  };
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
  const normalizeByteLimit = (value) => {
    const parsed = Math.floor(Number(value));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  };
  const normalizeByteCount = (value) => {
    const parsed = Math.floor(Number(value));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  };
  const normalizeRequest = (req = {}) => ({
    cpu: Math.max(0, Math.floor(Number(req?.cpu || 0))),
    io: Math.max(0, Math.floor(Number(req?.io || 0))),
    mem: Math.max(0, Math.floor(Number(req?.mem || 0))),
    bytes: normalizeByteCount(req?.bytes)
  });
  const resolvePercentile = (values, ratio) => {
    if (!Array.isArray(values) || !values.length) return 0;
    const normalized = values
      .map((entry) => Number(entry))
      .filter((entry) => Number.isFinite(entry) && entry >= 0)
      .sort((a, b) => a - b);
    if (!normalized.length) return 0;
    const clamped = Math.max(0, Math.min(1, Number(ratio) || 0));
    const index = Math.min(normalized.length - 1, Math.max(0, Math.ceil(normalized.length * clamped) - 1));
    return normalized[index];
  };
  const normalizeSurfaceName = (value) => (
    typeof value === 'string' && value.trim() ? value.trim() : null
  );
  const normalizePositiveInt = (value, fallback) => {
    const parsed = Math.floor(Number(value));
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return parsed;
  };
  const normalizeNonNegativeInt = (value, fallback) => {
    const parsed = Math.floor(Number(value));
    if (!Number.isFinite(parsed) || parsed < 0) return fallback;
    return parsed;
  };
  const normalizeRatio = (value, fallback, { min = 0, max = Number.POSITIVE_INFINITY } = {}) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, parsed));
  };
  const normalizeCooldownMs = (value, fallback = 0) => (
    Math.max(0, normalizeNonNegativeInt(value, fallback) ?? fallback)
  );
  const normalizeBacklogRatio = (value, fallback, min = 0) => (
    Math.max(min, normalizeRatio(value, fallback, { min, max: 64 }) ?? fallback)
  );
  const nowInput = typeof input.now === 'function' ? input.now : null;
  const nowMs = () => {
    if (!nowInput) return Date.now();
    const value = Number(nowInput());
    return Number.isFinite(value) ? value : Date.now();
  };
  const isObject = (value) => (
    value && typeof value === 'object' && !Array.isArray(value)
  );
  const resolveSurfaceDefaultBounds = (surfaceName) => {
    const cpuHeadroom = Math.max(1, maxLimits.cpu);
    const ioHeadroom = Math.max(1, maxLimits.io);
    switch (surfaceName) {
      case 'parse':
        return {
          minConcurrency: 1,
          maxConcurrency: Math.max(1, Math.ceil(cpuHeadroom * 0.9)),
          initialConcurrency: Math.max(1, Math.ceil(cpuHeadroom * 0.75))
        };
      case 'inference':
        return {
          minConcurrency: 1,
          maxConcurrency: Math.max(1, Math.ceil(cpuHeadroom * 0.75)),
          initialConcurrency: Math.max(1, Math.ceil(cpuHeadroom * 0.5))
        };
      case 'artifactWrite':
        return {
          minConcurrency: 1,
          maxConcurrency: Math.max(1, Math.ceil(ioHeadroom * 0.85)),
          initialConcurrency: Math.max(1, Math.ceil(ioHeadroom * 0.6))
        };
      case 'sqlite': {
        const sharedCap = Math.max(1, Math.min(cpuHeadroom, ioHeadroom));
        return {
          minConcurrency: 1,
          maxConcurrency: Math.max(1, Math.ceil(sharedCap * 0.6)),
          initialConcurrency: Math.max(1, Math.ceil(sharedCap * 0.5))
        };
      }
      case 'embeddings':
        return {
          minConcurrency: 1,
          maxConcurrency: Math.max(1, Math.ceil(cpuHeadroom * 0.8)),
          initialConcurrency: Math.max(1, Math.ceil(cpuHeadroom * 0.55))
        };
      default:
        return {
          minConcurrency: 1,
          maxConcurrency: Math.max(1, cpuHeadroom),
          initialConcurrency: 1
        };
    }
  };
  const adaptiveSurfaceRoot = isObject(input.adaptiveSurfaces)
    ? input.adaptiveSurfaces
    : {};
  const adaptiveSurfaceConfig = isObject(adaptiveSurfaceRoot.surfaces)
    ? adaptiveSurfaceRoot.surfaces
    : adaptiveSurfaceRoot;
  const adaptiveSurfaceControllersEnabled = adaptiveEnabled
    && adaptiveSurfaceRoot.enabled !== false;
  const adaptiveSurfaceDecisionTraceMax = normalizePositiveInt(
    adaptiveSurfaceRoot.decisionTraceMaxSamples
      ?? input.adaptiveDecisionTraceMaxSamples,
    512
  ) || 512;
  const adaptiveDecisionTrace = [];
  let adaptiveDecisionId = 0;
  const appendAdaptiveDecision = (entry) => {
    if (!entry || typeof entry !== 'object') return;
    adaptiveDecisionTrace.push(entry);
    while (adaptiveDecisionTrace.length > adaptiveSurfaceDecisionTraceMax) {
      adaptiveDecisionTrace.shift();
    }
  };
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
  const resolveQueueSurface = (queueName, explicitSurface = null) => {
    const explicit = normalizeSurfaceName(explicitSurface);
    if (explicit && adaptiveSurfaceStates.has(explicit)) return explicit;
    const mapped = normalizeSurfaceName(surfaceQueueMap.get(queueName));
    if (mapped && adaptiveSurfaceStates.has(mapped)) return mapped;
    return null;
  };
  let lastMemorySignals = null;
  let lastSystemSignals = null;

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
    if (!writeBackpressure.enabled) {
      writeBackpressureState.active = false;
      writeBackpressureState.reasons = [];
      writeBackpressureState.pending = 0;
      writeBackpressureState.pendingBytes = 0;
      writeBackpressureState.oldestWaitMs = 0;
      return writeBackpressureState;
    }
    const writeQueue = queues.get(writeBackpressure.writeQueue);
    if (!writeQueue) {
      writeBackpressureState.active = false;
      writeBackpressureState.reasons = [];
      writeBackpressureState.pending = 0;
      writeBackpressureState.pendingBytes = 0;
      writeBackpressureState.oldestWaitMs = 0;
      return writeBackpressureState;
    }
    const pending = writeQueue.pending.length;
    const pendingBytes = normalizeByteCount(writeQueue.pendingBytes);
    const oldestWaitMs = pending > 0
      ? Math.max(0, nowMs() - Number(writeQueue.pending[0]?.enqueuedAt || nowMs()))
      : 0;
    const reasons = [];
    if (pending >= writeBackpressure.pendingThreshold) reasons.push('pending');
    if (pendingBytes >= writeBackpressure.pendingBytesThreshold) reasons.push('pendingBytes');
    if (oldestWaitMs >= writeBackpressure.oldestWaitMsThreshold) reasons.push('oldestWaitMs');
    writeBackpressureState.active = reasons.length > 0;
    writeBackpressureState.reasons = reasons;
    writeBackpressureState.pending = pending;
    writeBackpressureState.pendingBytes = pendingBytes;
    writeBackpressureState.oldestWaitMs = oldestWaitMs;
    return writeBackpressureState;
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
    if (!queue?.stats) return;
    const normalized = Math.max(0, Math.floor(Number(waitedMs) || 0));
    queue.stats.lastWaitMs = normalized;
    const samples = Array.isArray(queue.stats.waitSamples)
      ? queue.stats.waitSamples
      : [];
    if (samples.length < WAIT_TIME_SAMPLE_LIMIT) {
      samples.push(normalized);
      queue.stats.waitSampleCursor = samples.length % WAIT_TIME_SAMPLE_LIMIT;
    } else if (samples.length > 0) {
      const cursorRaw = Number.isFinite(Number(queue.stats.waitSampleCursor))
        ? Math.floor(Number(queue.stats.waitSampleCursor))
        : 0;
      const cursor = ((cursorRaw % samples.length) + samples.length) % samples.length;
      samples[cursor] = normalized;
      queue.stats.waitSampleCursor = (cursor + 1) % samples.length;
    }
    queue.stats.waitSamples = samples;
    queue.stats.waitP95Ms = resolvePercentile(samples, 0.95);
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

  const buildAdaptiveSurfaceSnapshotByName = (surfaceName, at = nowMs()) => {
    const state = adaptiveSurfaceStates.get(surfaceName);
    if (!state) return null;
    const snapshot = {
      surface: surfaceName,
      pending: 0,
      pendingBytes: 0,
      running: 0,
      inFlightBytes: 0,
      oldestWaitMs: 0,
      ioPending: 0,
      ioPendingBytes: 0,
      ioWaitP95Ms: 0,
      queues: []
    };
    for (const queue of queueOrder) {
      if (queue?.surface !== surfaceName) continue;
      const pending = Math.max(0, queue.pending.length);
      const pendingBytes = normalizeByteCount(queue.pendingBytes);
      const running = Math.max(0, queue.running);
      const inFlightBytes = normalizeByteCount(queue.inFlightBytes);
      const oldestWaitMs = pending > 0
        ? Math.max(0, at - Number(queue.pending[0]?.enqueuedAt || at))
        : 0;
      const waitP95Ms = Math.max(0, Number(queue?.stats?.waitP95Ms) || 0);
      snapshot.pending += pending;
      snapshot.pendingBytes += pendingBytes;
      snapshot.running += running;
      snapshot.inFlightBytes += inFlightBytes;
      snapshot.oldestWaitMs = Math.max(snapshot.oldestWaitMs, oldestWaitMs);
      if ((pendingBytes > 0) || queue.name.includes('.io') || queue.name.includes('write') || queue.name.includes('sqlite')) {
        snapshot.ioPending += pending;
        snapshot.ioPendingBytes += pendingBytes;
        snapshot.ioWaitP95Ms = Math.max(snapshot.ioWaitP95Ms, waitP95Ms);
      }
      snapshot.queues.push({
        name: queue.name,
        pending,
        pendingBytes,
        running,
        inFlightBytes,
        oldestWaitMs,
        waitP95Ms
      });
    }
    snapshot.backlogPerSlot = snapshot.pending / Math.max(1, state.currentConcurrency);
    const ioPressureByBytes = snapshot.ioPendingBytes / Math.max(1, 256 * 1024 * 1024);
    const ioPressureByWait = snapshot.ioWaitP95Ms / 10000;
    snapshot.ioPressureScore = Math.max(
      0,
      Math.min(
        1.5,
        Math.max(
          snapshot.ioPending > 0 ? (snapshot.ioPending / Math.max(1, state.currentConcurrency * 2)) : 0,
          ioPressureByBytes,
          ioPressureByWait
        )
      )
    );
    return snapshot;
  };

  const buildAdaptiveSurfaceSnapshots = (at = nowMs()) => {
    const out = {};
    for (const surfaceName of adaptiveSurfaceStates.keys()) {
      out[surfaceName] = buildAdaptiveSurfaceSnapshotByName(surfaceName, at);
    }
    return out;
  };

  const readSystemSignals = (at = nowMs()) => {
    const cpuTokenUtilization = tokens.cpu.total > 0 ? (tokens.cpu.used / tokens.cpu.total) : 0;
    const ioTokenUtilization = tokens.io.total > 0 ? (tokens.io.used / tokens.io.total) : 0;
    const memTokenUtilization = tokens.mem.total > 0 ? (tokens.mem.used / tokens.mem.total) : 0;
    const defaultSignals = {
      cpu: {
        tokenUtilization: Math.max(cpuTokenUtilization, ioTokenUtilization),
        loadRatio: 0
      },
      memory: {
        rssBytes: 0,
        heapUsedBytes: 0,
        heapTotalBytes: 0,
        freeBytes: 0,
        totalBytes: 0,
        rssUtilization: null,
        heapUtilization: null,
        freeRatio: null,
        pressureScore: Math.max(memTokenUtilization, 0),
        gcPressureScore: 0
      }
    };
    if (typeof input.adaptiveSignalSampler === 'function') {
      try {
        const sampled = input.adaptiveSignalSampler({
          at,
          stage: telemetryStage,
          tokens: cloneTokenState()
        });
        if (sampled && typeof sampled === 'object') {
          const cpuToken = normalizeRatio(
            sampled?.cpu?.tokenUtilization,
            defaultSignals.cpu.tokenUtilization,
            { min: 0, max: 1.5 }
          );
          const cpuLoad = normalizeRatio(sampled?.cpu?.loadRatio, defaultSignals.cpu.loadRatio, { min: 0, max: 2 });
          const pressureScore = normalizeRatio(
            sampled?.memory?.pressureScore,
            defaultSignals.memory.pressureScore,
            { min: 0, max: 2 }
          );
          const gcPressureScore = normalizeRatio(
            sampled?.memory?.gcPressureScore,
            defaultSignals.memory.gcPressureScore,
            { min: 0, max: 2 }
          );
          defaultSignals.cpu = {
            tokenUtilization: cpuToken,
            loadRatio: cpuLoad
          };
          defaultSignals.memory = {
            ...defaultSignals.memory,
            pressureScore,
            gcPressureScore,
            rssBytes: normalizeNonNegativeInt(sampled?.memory?.rssBytes, defaultSignals.memory.rssBytes),
            heapUsedBytes: normalizeNonNegativeInt(sampled?.memory?.heapUsedBytes, defaultSignals.memory.heapUsedBytes),
            heapTotalBytes: normalizeNonNegativeInt(sampled?.memory?.heapTotalBytes, defaultSignals.memory.heapTotalBytes),
            freeBytes: normalizeNonNegativeInt(sampled?.memory?.freeBytes, defaultSignals.memory.freeBytes),
            totalBytes: normalizeNonNegativeInt(sampled?.memory?.totalBytes, defaultSignals.memory.totalBytes),
            rssUtilization: normalizeRatio(sampled?.memory?.rssUtilization, defaultSignals.memory.rssUtilization, { min: 0, max: 1 }),
            heapUtilization: normalizeRatio(sampled?.memory?.heapUtilization, defaultSignals.memory.heapUtilization, { min: 0, max: 1 }),
            freeRatio: normalizeRatio(sampled?.memory?.freeRatio, defaultSignals.memory.freeRatio, { min: 0, max: 1 })
          };
          return defaultSignals;
        }
      } catch {}
    }
    const cpuCount = typeof os.availableParallelism === 'function'
      ? Math.max(1, os.availableParallelism())
      : Math.max(1, os.cpus().length || 1);
    const loadAvg = typeof os.loadavg === 'function' ? os.loadavg() : null;
    const loadRatio = Array.isArray(loadAvg) && Number.isFinite(loadAvg[0]) && cpuCount > 0
      ? Math.max(0, Math.min(2, Number(loadAvg[0]) / cpuCount))
      : 0;
    let rssBytes = 0;
    let heapUsedBytes = 0;
    let heapTotalBytes = 0;
    try {
      const usage = process.memoryUsage();
      rssBytes = Number(usage?.rss) || 0;
      heapUsedBytes = Number(usage?.heapUsed) || 0;
      heapTotalBytes = Number(usage?.heapTotal) || 0;
    } catch {}
    const totalBytes = Number(os.totalmem()) || 0;
    const freeBytes = Number(os.freemem()) || 0;
    const rssUtilization = totalBytes > 0 ? Math.max(0, Math.min(1, rssBytes / totalBytes)) : null;
    const heapUtilization = heapTotalBytes > 0 ? Math.max(0, Math.min(1, heapUsedBytes / heapTotalBytes)) : null;
    const freeRatio = totalBytes > 0 ? Math.max(0, Math.min(1, freeBytes / totalBytes)) : null;
    const freePressure = Number.isFinite(freeRatio) ? (1 - freeRatio) : 0;
    const memoryPressureScore = Math.max(
      memTokenUtilization,
      Number.isFinite(rssUtilization) ? rssUtilization : 0,
      Number.isFinite(heapUtilization) ? heapUtilization : 0,
      freePressure
    );
    let gcPressureScore = 0;
    if (lastMemorySignals && Number(lastMemorySignals.heapUsedBytes) > 0) {
      const priorHeap = Number(lastMemorySignals.heapUsedBytes) || 0;
      const delta = priorHeap - heapUsedBytes;
      if (delta > 0) {
        gcPressureScore = Math.max(0, Math.min(1, delta / Math.max(1, priorHeap)));
      }
    }
    lastMemorySignals = { heapUsedBytes };
    return {
      cpu: {
        tokenUtilization: Math.max(cpuTokenUtilization, ioTokenUtilization),
        loadRatio
      },
      memory: {
        rssBytes,
        heapUsedBytes,
        heapTotalBytes,
        freeBytes,
        totalBytes,
        rssUtilization,
        heapUtilization,
        freeRatio,
        pressureScore: memoryPressureScore,
        gcPressureScore
      }
    };
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
      adaptiveDecisionId += 1;
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

  const maybeAdaptTokens = () => {
    if (!adaptiveEnabled || shuttingDown) return;
    const now = nowMs();
    if ((now - lastAdaptiveAt) < adaptiveCurrentIntervalMs) return;
    lastAdaptiveAt = now;
    maybeAdaptSurfaceControllers(now);
    let totalPending = 0;
    let totalPendingBytes = 0;
    let totalRunning = 0;
    let totalRunningBytes = 0;
    let starvedQueues = 0;
    for (const q of queueOrder) {
      totalPending += q.pending.length;
      totalPendingBytes += normalizeByteCount(q.pendingBytes);
      totalRunning += q.running;
      totalRunningBytes += normalizeByteCount(q.inFlightBytes);
      if (q.pending.length > 0 && q.running === 0) {
        starvedQueues += 1;
      }
    }
    let floorCpu = 0;
    let floorIo = 0;
    let floorMem = 0;
    for (const q of queueOrder) {
      if ((q.pending.length + q.running) <= 0) continue;
      floorCpu = Math.max(floorCpu, Number(q.floorCpu) || 0);
      floorIo = Math.max(floorIo, Number(q.floorIo) || 0);
      floorMem = Math.max(floorMem, Number(q.floorMem) || 0);
    }
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
    const smooth = (prev, next, alpha = 0.25) => (
      prev == null ? next : ((prev * (1 - alpha)) + (next * alpha))
    );
    smoothedUtilization = smooth(smoothedUtilization, utilization);
    smoothedPendingPressure = smooth(
      smoothedPendingPressure,
      Math.max(totalPending / Math.max(1, tokenBudget), totalPendingBytes / Math.max(1, memoryTokenBudgetBytes))
    );
    smoothedStarvation = smooth(
      smoothedStarvation,
      queueOrder.length > 0 ? (starvedQueues / queueOrder.length) : 0
    );
    const utilizationDeficit = utilization < adaptiveTargetUtilization;
    const smoothedUtilizationDeficit = (smoothedUtilization ?? utilization) < adaptiveTargetUtilization;
    const severeUtilizationDeficit = utilization < (adaptiveTargetUtilization * 0.7);
    const starvationScore = starvedQueues + Math.round((smoothedStarvation ?? 0) * 2);
    if (pendingPressure || bytePressure || starvationScore > 0) {
      adaptiveCurrentIntervalMs = Math.max(50, Math.floor(adaptiveMinIntervalMs * 0.5));
    } else if (mostlyIdle) {
      adaptiveCurrentIntervalMs = Math.min(2000, Math.max(adaptiveMinIntervalMs, Math.floor(adaptiveMinIntervalMs * 2)));
    } else {
      adaptiveCurrentIntervalMs = adaptiveMinIntervalMs;
    }
    const totalMem = Number(os.totalmem()) || 0;
    const freeMem = Number(os.freemem()) || 0;
    const freeRatio = totalMem > 0 ? (freeMem / totalMem) : null;
    const headroomBytes = Number.isFinite(totalMem) && Number.isFinite(freeMem)
      ? Math.max(0, freeMem)
      : 0;
    const memoryLowHeadroom = Number.isFinite(freeRatio) && freeRatio < 0.15;
    const memoryHighHeadroom = !Number.isFinite(freeRatio) || freeRatio > 0.25;
    let memoryTokenHeadroomCap = maxLimits.mem;
    if (Number.isFinite(freeMem) && freeMem > 0) {
      const reserveBytes = adaptiveMemoryReserveMb * 1024 * 1024;
      const bytesPerToken = adaptiveMemoryPerTokenMb * 1024 * 1024;
      const availableBytes = Math.max(0, freeMem - reserveBytes);
      const headroomTokens = Math.max(1, Math.floor(availableBytes / Math.max(1, bytesPerToken)));
      memoryTokenHeadroomCap = Math.max(
        baselineLimits.mem,
        Math.min(maxLimits.mem, headroomTokens)
      );
      if (tokens.mem.total > memoryTokenHeadroomCap) {
        tokens.mem.total = Math.max(tokens.mem.used, memoryTokenHeadroomCap);
      }
    }

    if (memoryLowHeadroom) {
      adaptiveMode = 'steady';
      tokens.cpu.total = Math.max(cpuFloor, tokens.cpu.used, tokens.cpu.total - adaptiveStep);
      tokens.io.total = Math.max(ioFloor, tokens.io.used, tokens.io.total - adaptiveStep);
      tokens.mem.total = Math.max(
        memFloor,
        tokens.mem.used,
        Math.min(memoryTokenHeadroomCap, tokens.mem.total - adaptiveStep)
      );
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
      tokens.cpu.total = Math.max(cpuFloor, tokens.cpu.used, tokens.cpu.total - adaptiveStep);
      tokens.io.total = Math.max(ioFloor, tokens.io.used, tokens.io.total - adaptiveStep);
      tokens.mem.total = Math.max(memFloor, tokens.mem.used, tokens.mem.total - adaptiveStep);
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
      tokens.cpu.total = Math.max(cpuFloor, tokens.cpu.used, tokens.cpu.total - adaptiveStep);
      tokens.io.total = Math.max(ioFloor, tokens.io.used, tokens.io.total - adaptiveStep);
      tokens.mem.total = Math.max(memFloor, tokens.mem.used, tokens.mem.total - adaptiveStep);
    }
  };

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

  const findStartableIndex = (queue, backpressureState = null) => {
    if (!queue?.pending?.length) return -1;
    for (let i = 0; i < queue.pending.length; i += 1) {
      if (canStart(queue, queue.pending[i].tokens, backpressureState)) return i;
    }
    return -1;
  };

  const pickNextQueue = (backpressureState = null) => {
    if (!queueOrder.length) return null;
    const now = nowMs();
    let starving = null;
    let picked = null;
    for (const q of queueOrder) {
      if (!q.pending.length) continue;
      const index = findStartableIndex(q, backpressureState);
      if (index < 0) continue;
      const waited = now - q.pending[index].enqueuedAt;
      if (waited >= starvationMs && (!starving || waited > starving.waited)) {
        starving = { queue: q, waited, index };
        continue;
      }
      const weightBoostMs = Math.max(1, Number(q.weight) || 1) * 250;
      const priorityPenaltyMs = Math.max(0, Number(q.priority) || 0) * 5;
      // Fairness aging by wait-time percentile: once a queue's current wait
      // exceeds its own p95 wait, boost the score to pull tail work forward.
      const waitP95Ms = Number(q.stats?.waitP95Ms) || 0;
      const agingBoostMs = waitP95Ms > 0 ? Math.max(0, waited - waitP95Ms) : 0;
      const score = waited + weightBoostMs + agingBoostMs - priorityPenaltyMs;
      if (!picked || score > picked.score) {
        picked = { queue: q, index, score };
      }
    }
    if (starving) return { queue: starving.queue, starved: true, index: starving.index };
    return picked ? { queue: picked.queue, starved: false, index: picked.index } : null;
  };

  const pump = () => {
    if (shuttingDown) return;
    while (true) {
      maybeAdaptTokens();
      const backpressureState = evaluateWriteBackpressure();
      const pick = pickNextQueue(backpressureState);
      if (!pick) return;
      const { queue, starved, index } = pick;
      const next = queue.pending[index];
      if (!next || !canStart(queue, next.tokens, backpressureState)) return;
      queue.pending.splice(index, 1);
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
    return cleared.length;
  };

  const stats = () => {
    captureTelemetryIfDue('stats');
    const queueStats = {};
    let totalPending = 0;
    let totalPendingBytes = 0;
    let totalRunning = 0;
    let totalInFlightBytesValue = 0;
    for (const q of queueOrder) {
      const oldest = q.pending.length ? nowMs() - q.pending[0].enqueuedAt : 0;
      totalPending += q.pending.length;
      totalPendingBytes += normalizeByteCount(q.pendingBytes);
      totalRunning += q.running;
      totalInFlightBytesValue += normalizeByteCount(q.inFlightBytes);
      queueStats[q.name] = {
        surface: q.surface || null,
        pending: q.pending.length,
        pendingBytes: normalizeByteCount(q.pendingBytes),
        running: q.running,
        inFlightBytes: normalizeByteCount(q.inFlightBytes),
        maxPending: q.maxPending,
        maxPendingBytes: q.maxPendingBytes,
        maxInFlightBytes: q.maxInFlightBytes,
        floorCpu: q.floorCpu,
        floorIo: q.floorIo,
        floorMem: q.floorMem,
        priority: q.priority,
        weight: q.weight,
        oldestWaitMs: oldest,
        scheduled: q.stats.scheduled,
        started: q.stats.started,
        completed: q.stats.completed,
        failed: q.stats.failed,
        rejected: q.stats.rejected,
        rejectedMaxPending: q.stats.rejectedMaxPending,
        rejectedMaxPendingBytes: q.stats.rejectedMaxPendingBytes,
        starvation: q.stats.starvation,
        lastWaitMs: q.stats.lastWaitMs,
        waitP95Ms: q.stats.waitP95Ms,
        waitSampleCount: Array.isArray(q.stats.waitSamples) ? q.stats.waitSamples.length : 0
      };
    }
    const resolveUtilization = (used, total) => (
      total > 0 ? Math.max(0, Math.min(1, used / total)) : 0
    );
    const cpuUtilization = resolveUtilization(tokens.cpu.used, tokens.cpu.total);
    const ioUtilization = resolveUtilization(tokens.io.used, tokens.io.total);
    const memUtilization = resolveUtilization(tokens.mem.used, tokens.mem.total);
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
      activity: {
        pending: totalPending,
        pendingBytes: totalPendingBytes,
        running: totalRunning,
        inFlightBytes: totalInFlightBytesValue
      },
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
