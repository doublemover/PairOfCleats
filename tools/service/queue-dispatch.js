import { MAX_QUEUE_PRIORITY_BYPASSES, describeQueueDispatch, resolveQueueJobCost } from './admission-policy.js';

// This is a dispatch invariant, not another configuration surface. A waiting
// non-priority job gets an opportunity after three priority claims. Its counter
// lives on that queued record so independent workers and restarts share it.
export const queuePriorityBypasses = job => Number.isSafeInteger(job?.dispatchPriorityBypasses)
  && job.dispatchPriorityBypasses > 0
  ? Math.min(job.dispatchPriorityBypasses, MAX_QUEUE_PRIORITY_BYPASSES) : 0;

/** Select only from the already admitted, eligible, non-duplicate records. The
 * caller owns the partition lock and persists any bypass with the same claim.
 * No sort, journal scan or retained copy of the eligible backlog is necessary.
 */
export const createQueueDispatchSelection = ({ workerMode, queueName }) => {
  let first = null, priority = null, nonPriority = null;
  return {
    consider(job) {
      first ||= job;
      if (workerMode !== 'priority-only') return true;
      if (resolveQueueJobCost(job, queueName) < 2) priority ||= job;
      else nonPriority ||= job;
      return false;
    },
    finish() {
      const fairnessDue = nonPriority && queuePriorityBypasses(nonPriority) >= MAX_QUEUE_PRIORITY_BYPASSES;
      const job = workerMode !== 'priority-only' ? first
        : fairnessDue ? nonPriority : priority || nonPriority;
      return {
        job,
        bypassed: job && job === priority && nonPriority ? nonPriority : null,
        reason: workerMode !== 'priority-only' ? 'fifo'
          : fairnessDue ? 'bounded-non-priority-opportunity' : priority ? 'priority' : 'oldest-eligible',
        workerMode,
        ...describeQueueDispatch(workerMode)
      };
    }
  };
};
