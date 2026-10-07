import { throwIfAborted } from '../../../../../shared/abort.js';
import { estimatePostingsPayload } from './postings-queue.js';

const NOOP_RESERVATION = Object.freeze({
  release() {}
});

export const shouldBypassPostingsBackpressure = ({
  orderIndex,
  nextOrderedIndex,
  bypassWindow = 0
}) => {
  if (!Number.isFinite(orderIndex) || !Number.isFinite(nextOrderedIndex)) return false;
  const normalizedOrderIndex = Math.floor(orderIndex);
  const normalizedNextIndex = Math.floor(nextOrderedIndex);
  const normalizedWindow = Number.isFinite(bypassWindow)
    ? Math.max(0, Math.floor(bypassWindow))
    : 0;
  return normalizedOrderIndex <= (normalizedNextIndex + normalizedWindow);
};

export const runApplyWithPostingsBackpressure = async ({
  sparsePostingsEnabled = false,
  postingsQueue = null,
  result = null,
  signal = null,
  reserveTimeoutMs = null,
  onReserveWait = null,
  runApply
} = {}) => {
  const reserveSignal = signal && typeof signal.aborted === 'boolean' ? signal : null;
  const resolvedReserveTimeoutMs = reserveTimeoutMs !== null
    && reserveTimeoutMs !== undefined
    && Number.isFinite(Number(reserveTimeoutMs))
    ? Math.max(0, Math.floor(Number(reserveTimeoutMs)))
    : null;
  const reserveWaitHook = typeof onReserveWait === 'function' ? onReserveWait : null;
  let reservation = NOOP_RESERVATION;
  if (
    sparsePostingsEnabled
    && postingsQueue
    && typeof postingsQueue.reserve === 'function'
  ) {
    reservation = await postingsQueue.reserve({
      ...estimatePostingsPayload(result),
      ...(reserveSignal ? { signal: reserveSignal } : {}),
      ...(resolvedReserveTimeoutMs != null ? { timeoutMs: resolvedReserveTimeoutMs } : {}),
      ...(reserveWaitHook ? { onWait: reserveWaitHook } : {})
    });
  }
  try {
    throwIfAborted(reserveSignal);
    const applyResult = await runApply({ signal: reserveSignal });
    throwIfAborted(reserveSignal);
    return applyResult;
  } finally {
    try {
      reservation.release?.();
    } catch {}
  }
};
