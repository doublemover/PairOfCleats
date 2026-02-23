/**
 * Build queue-level scheduler stats plus activity totals.
 *
 * @param {{queueOrder:Array<object>, nowMs:()=>number, normalizeByteCount:(value:unknown)=>number}} input
 * @returns {{queueStats:Record<string,object>,activity:{pending:number,pendingBytes:number,running:number,inFlightBytes:number}}}
 */
export const buildSchedulerQueueStatsSnapshot = ({ queueOrder, nowMs, normalizeByteCount }) => {
  const queueStats = {};
  let totalPending = 0;
  let totalPendingBytes = 0;
  let totalRunning = 0;
  let totalInFlightBytesValue = 0;
  for (const queue of queueOrder) {
    const oldest = queue.pending.length ? nowMs() - queue.pending[0].enqueuedAt : 0;
    totalPending += queue.pending.length;
    totalPendingBytes += normalizeByteCount(queue.pendingBytes);
    totalRunning += queue.running;
    totalInFlightBytesValue += normalizeByteCount(queue.inFlightBytes);
    queueStats[queue.name] = {
      surface: queue.surface || null,
      pending: queue.pending.length,
      pendingBytes: normalizeByteCount(queue.pendingBytes),
      running: queue.running,
      inFlightBytes: normalizeByteCount(queue.inFlightBytes),
      maxPending: queue.maxPending,
      maxPendingBytes: queue.maxPendingBytes,
      maxInFlightBytes: queue.maxInFlightBytes,
      floorCpu: queue.floorCpu,
      floorIo: queue.floorIo,
      floorMem: queue.floorMem,
      priority: queue.priority,
      weight: queue.weight,
      oldestWaitMs: oldest,
      scheduled: queue.stats.scheduled,
      started: queue.stats.started,
      completed: queue.stats.completed,
      failed: queue.stats.failed,
      rejected: queue.stats.rejected,
      rejectedMaxPending: queue.stats.rejectedMaxPending,
      rejectedMaxPendingBytes: queue.stats.rejectedMaxPendingBytes,
      starvation: queue.stats.starvation,
      lastWaitMs: queue.stats.lastWaitMs,
      waitP95Ms: queue.stats.waitP95Ms,
      waitSampleCount: Array.isArray(queue.stats.waitSamples) ? queue.stats.waitSamples.length : 0
    };
  }
  return {
    queueStats,
    activity: {
      pending: totalPending,
      pendingBytes: totalPendingBytes,
      running: totalRunning,
      inFlightBytes: totalInFlightBytesValue
    }
  };
};

/**
 * Normalize token utilization into [0..1].
 *
 * @param {number} used
 * @param {number} total
 * @returns {number}
 */
export const resolveSchedulerUtilization = (used, total) => (
  total > 0 ? Math.max(0, Math.min(1, used / total)) : 0
);

/**
 * Build adaptive-surface stats payload for scheduler diagnostics.
 *
 * @param {{adaptiveSurfaceStates:Map<string,object>,buildAdaptiveSurfaceSnapshotByName:(surfaceName:string)=>object}} input
 * @returns {Record<string,object>}
 */
export const buildSchedulerAdaptiveSurfaceStats = ({
  adaptiveSurfaceStates,
  buildAdaptiveSurfaceSnapshotByName
}) => {
  if (!(adaptiveSurfaceStates instanceof Map) || adaptiveSurfaceStates.size === 0) {
    return {};
  }
  const adaptiveSurfaces = {};
  for (const [surfaceName, state] of adaptiveSurfaceStates.entries()) {
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
      snapshot: buildAdaptiveSurfaceSnapshotByName(surfaceName)
    };
  }
  return adaptiveSurfaces;
};

/**
 * Clone scheduler system signals snapshot for stats output.
 *
 * @param {object|null} signals
 * @returns {{cpu:object|null,memory:object|null}|null}
 */
export const cloneSchedulerSystemSignals = (signals) => {
  if (!signals || typeof signals !== 'object') return null;
  return {
    cpu: signals.cpu && typeof signals.cpu === 'object'
      ? { ...signals.cpu }
      : null,
    memory: signals.memory && typeof signals.memory === 'object'
      ? { ...signals.memory }
      : null
  };
};
