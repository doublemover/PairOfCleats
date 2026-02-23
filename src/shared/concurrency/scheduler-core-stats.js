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
