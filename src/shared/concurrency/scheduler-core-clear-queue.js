/**
 * Clear all pending scheduler items for one queue.
 *
 * Throughput note: this mutates the existing pending array in place instead of
 * allocating a cleared copy via `splice`, which avoids a large transient
 * allocation when draining high-backlog queues.
 *
 * @param {object} input
 * @param {object|null|undefined} input.queue
 * @param {string} input.reason
 * @param {(value:unknown)=>number} input.normalizeByteCount
 * @param {{rejected:number,rejectedByReason:{cleared:number}}} input.counters
 * @returns {number}
 */
export const clearSchedulerQueuePending = ({
  queue,
  reason,
  normalizeByteCount,
  counters
}) => {
  if (!queue || !Array.isArray(queue.pending) || queue.pending.length === 0) return 0;

  const error = new Error(reason);
  const pending = queue.pending;
  const pendingCount = pending.length;
  let clearedBytes = 0;

  for (let i = 0; i < pendingCount; i += 1) {
    const item = pending[i];
    clearedBytes += normalizeByteCount(item?.bytes);
    queue.stats.rejected += 1;
    counters.rejected += 1;
    counters.rejectedByReason.cleared += 1;
    try {
      item.reject(error);
    } catch {}
  }

  pending.length = 0;
  queue.pendingBytes = Math.max(0, normalizeByteCount(queue.pendingBytes) - clearedBytes);
  queue.pendingSearchCursor = 0;
  return pendingCount;
};
