import {
  cloneDecisionEntry,
  cloneQueueDepthEntries,
  cloneTraceEntries
} from './scheduler-telemetry.js';

const resolveUtilization = (used, total) => (
  total > 0 ? Math.max(0, Math.min(1, used / total)) : 0
);

const cloneAdaptiveSignals = (signals) => (
  signals && typeof signals === 'object'
    ? {
      cpu: signals.cpu && typeof signals.cpu === 'object'
        ? { ...signals.cpu }
        : null,
      memory: signals.memory && typeof signals.memory === 'object'
        ? { ...signals.memory }
        : null,
      fd: signals.fd && typeof signals.fd === 'object'
        ? { ...signals.fd }
        : null
    }
    : null
);

export const buildSchedulerStatsSnapshot = ({
  captureTelemetryIfDue,
  queueOrder,
  nowMs,
  normalizeByteCount,
  counters,
  tokens,
  adaptiveSurfaceStates,
  buildAdaptiveSurfaceSnapshotByName,
  adaptiveEnabled,
  baselineLimits,
  maxLimits,
  adaptiveTargetUtilization,
  adaptiveStep,
  adaptiveMemoryReserveMb,
  adaptiveMemoryPerTokenMb,
  globalMaxInFlightBytes,
  adaptiveCurrentIntervalMs,
  adaptiveMode,
  smoothedUtilization,
  smoothedPendingPressure,
  smoothedStarvation,
  adaptiveSurfaceControllersEnabled,
  adaptiveDecisionTrace,
  lastSystemSignals,
  evaluateWriteBackpressure,
  writeBackpressure,
  telemetryStage,
  traceIntervalMs,
  queueDepthSnapshotIntervalMs,
  queueDepthSnapshotsEnabled,
  telemetryCapture
}) => {
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
      rejectedAbort: q.stats.rejectedAbort,
      rejectedSignalRequired: q.stats.rejectedSignalRequired,
      starvation: q.stats.starvation,
      lastWaitMs: q.stats.lastWaitMs,
      waitP95Ms: q.stats.waitP95Ms,
      waitSampleCount: Array.isArray(q.stats.waitSamples) ? q.stats.waitSamples.length : 0
    };
  }
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
      thresholds: {
        ioPressure: state.ioPressureThreshold,
        fdPressure: state.fdPressureThreshold,
        memoryPressure: state.memoryPressureThreshold,
        gcPressure: state.gcPressureThreshold
      },
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
      fd: lastSystemSignals?.fd && typeof lastSystemSignals.fd === 'object'
        ? { ...lastSystemSignals.fd }
        : null,
      signals: cloneAdaptiveSignals(lastSystemSignals),
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
