/**
 * Apply queue pending/pending-bytes schedule guards and mutate rejection counters.
 *
 * @param {object} input
 * @param {string} input.queueName
 * @param {object} input.queue
 * @param {{bytes:number}} input.normalizedReq
 * @param {(value:unknown)=>number} input.normalizeByteCount
 * @param {{scheduled:number,rejected:number,rejectedByReason:{maxPending:number,maxPendingBytes:number}}} input.counters
 * @returns {Error|null}
 */
export const resolveSchedulerScheduleRejection = ({
  queueName,
  queue,
  normalizedReq,
  normalizeByteCount,
  counters
}) => {
  if (queue.maxPending && queue.pending.length >= queue.maxPending) {
    queue.stats.rejected += 1;
    queue.stats.rejectedMaxPending += 1;
    queue.stats.scheduled += 1;
    counters.scheduled += 1;
    counters.rejected += 1;
    counters.rejectedByReason.maxPending += 1;
    return new Error(`queue ${queueName} is at maxPending`);
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
      return new Error(`queue ${queueName} is at maxPendingBytes`);
    }
  }

  return null;
};
