/**
 * Resolve a stable pending scan cursor for queue-local startability scans.
 *
 * The cursor is intentionally persisted on the queue so repeated pump cycles
 * can resume scanning near the last successful dequeue index instead of
 * repeatedly re-checking a blocked prefix from index 0.
 *
 * @param {{pending?:Array<any>,pendingSearchCursor?:number}} queue
 * @returns {number}
 */
const resolvePendingSearchCursor = (queue) => {
  const pendingLength = Array.isArray(queue?.pending) ? queue.pending.length : 0;
  if (pendingLength <= 0) {
    if (queue && typeof queue === 'object') {
      queue.pendingSearchCursor = 0;
    }
    return 0;
  }
  const rawCursor = Number(queue.pendingSearchCursor);
  const normalizedCursor = Number.isFinite(rawCursor)
    ? Math.floor(rawCursor)
    : 0;
  const wrappedCursor = ((normalizedCursor % pendingLength) + pendingLength) % pendingLength;
  queue.pendingSearchCursor = wrappedCursor;
  return wrappedCursor;
};

/**
 * Find the next startable pending item index for a queue using a rotating scan.
 *
 * Rotating from `pendingSearchCursor` keeps queue-level fairness intact because
 * the scan always wraps and visits every entry once per call, but improves
 * throughput for blocked-front queues by avoiding repeated linear rescans of
 * the same non-startable prefix after each dequeue.
 *
 * @param {{
 *   queue:{pending?:Array<{tokens?:object}>,pendingSearchCursor?:number},
 *   canStart:(queue:any,req:any,backpressureState?:object|null)=>boolean,
 *   backpressureState?:object|null
 * }} input
 * @returns {number}
 */
export const findStartableQueueIndex = ({
  queue,
  canStart,
  backpressureState = null
}) => {
  if (!queue?.pending?.length || typeof canStart !== 'function') return -1;
  const pendingLength = queue.pending.length;
  const startCursor = resolvePendingSearchCursor(queue);
  for (let offset = 0; offset < pendingLength; offset += 1) {
    const index = (startCursor + offset) % pendingLength;
    if (canStart(queue, queue.pending[index]?.tokens, backpressureState)) {
      queue.pendingSearchCursor = index;
      return index;
    }
  }
  queue.pendingSearchCursor = 0;
  return -1;
};

/**
 * Pick the next queue/item pair to run from all queue states.
 *
 * Selection order:
 * 1) Any item waiting past `starvationMs` wins immediately.
 * 2) Otherwise pick the queue with the highest fairness score:
 *    `wait + weightBoost + tailAgingBoost - priorityPenalty`.
 *
 * The returned `item` is already known-startable for the provided scheduler
 * state and `backpressureState`.
 *
 * @param {{
 *   queueOrder:Array<any>,
 *   nowMs:()=>number,
 *   starvationMs:number,
 *   backpressureState?:object|null,
 *   canStart:(queue:any,req:any,backpressureState?:object|null)=>boolean
 * }} input
 * @returns {{queue:any,index:number,item:any,starved:boolean}|null}
 */
export const pickNextSchedulerQueue = ({
  queueOrder = [],
  nowMs,
  starvationMs,
  backpressureState = null,
  canStart
}) => {
  if (!Array.isArray(queueOrder) || !queueOrder.length) return null;
  if (typeof canStart !== 'function') return null;
  const now = typeof nowMs === 'function' ? Number(nowMs()) : Date.now();
  let starving = null;
  let picked = null;
  for (const queue of queueOrder) {
    if (!queue?.pending?.length) continue;
    const index = findStartableQueueIndex({
      queue,
      canStart,
      backpressureState
    });
    if (index < 0) continue;
    const item = queue.pending[index];
    if (!item) continue;
    const waited = now - item.enqueuedAt;
    if (waited >= starvationMs && (!starving || waited > starving.waited)) {
      starving = { queue, waited, index, item };
      continue;
    }
    const weightBoostMs = Math.max(1, Number(queue.weight) || 1) * 250;
    const priorityPenaltyMs = Math.max(0, Number(queue.priority) || 0) * 5;
    const waitP95Ms = Number(queue.stats?.waitP95Ms) || 0;
    const agingBoostMs = waitP95Ms > 0 ? Math.max(0, waited - waitP95Ms) : 0;
    const score = waited + weightBoostMs + agingBoostMs - priorityPenaltyMs;
    if (!picked || score > picked.score) {
      picked = { queue, index, score, item };
    }
  }
  if (starving) {
    return {
      queue: starving.queue,
      index: starving.index,
      item: starving.item,
      starved: true
    };
  }
  if (!picked) return null;
  return {
    queue: picked.queue,
    index: picked.index,
    item: picked.item,
    starved: false
  };
};
