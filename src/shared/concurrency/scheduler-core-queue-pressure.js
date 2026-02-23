/**
 * Aggregate queue pressure counters in a single pass for adaptive scheduling.
 *
 * This keeps hot-path adaptation costs predictable by avoiding multiple
 * traversals over the queue list on every adapt tick.
 *
 * @param {{queueOrder:Array<object>, normalizeByteCount:(value:unknown)=>number}} input
 * @returns {{
 *   totalPending:number,
 *   totalPendingBytes:number,
 *   totalRunning:number,
 *   totalRunningBytes:number,
 *   starvedQueues:number,
 *   floorCpu:number,
 *   floorIo:number,
 *   floorMem:number
 * }}
 */
export const collectSchedulerQueuePressure = ({ queueOrder = [], normalizeByteCount }) => {
  const normalizeBytes = typeof normalizeByteCount === 'function'
    ? normalizeByteCount
    : ((value) => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0);
  let totalPending = 0;
  let totalPendingBytes = 0;
  let totalRunning = 0;
  let totalRunningBytes = 0;
  let starvedQueues = 0;
  let floorCpu = 0;
  let floorIo = 0;
  let floorMem = 0;

  for (const queue of queueOrder) {
    const pendingCount = Array.isArray(queue?.pending) ? queue.pending.length : 0;
    const runningCount = Math.max(0, Number(queue?.running) || 0);
    totalPending += pendingCount;
    totalPendingBytes += normalizeBytes(queue?.pendingBytes);
    totalRunning += runningCount;
    totalRunningBytes += normalizeBytes(queue?.inFlightBytes);
    if (pendingCount > 0 && runningCount === 0) {
      starvedQueues += 1;
    }
    if ((pendingCount + runningCount) > 0) {
      floorCpu = Math.max(floorCpu, Math.max(0, Number(queue?.floorCpu) || 0));
      floorIo = Math.max(floorIo, Math.max(0, Number(queue?.floorIo) || 0));
      floorMem = Math.max(floorMem, Math.max(0, Number(queue?.floorMem) || 0));
    }
  }

  return {
    totalPending,
    totalPendingBytes,
    totalRunning,
    totalRunningBytes,
    starvedQueues,
    floorCpu,
    floorIo,
    floorMem
  };
};
