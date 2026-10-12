export const createBoundedWriterQueue = ({
  scheduleIo,
  maxPending,
  maxPendingBytes = 256 * 1024 * 1024,
  resolveMaxPending,
  onAdjust
} = {}) => {
  const resolvedMaxPending = Number.isFinite(Number(maxPending)) && maxPending != null
    ? Math.max(1, Math.floor(Number(maxPending))) : 1;
  const byteLimit = Number.isSafeInteger(maxPendingBytes) && maxPendingBytes > 0
    ? maxPendingBytes : 256 * 1024 * 1024;
  const pending = new Set();
  let pendingBytes = 0;
  let producers = 0;
  const stats = { maxPending: resolvedMaxPending, currentMaxPending: resolvedMaxPending,
    peakDynamicMaxPending: resolvedMaxPending, minDynamicMaxPending: resolvedMaxPending,
    adjustments: 0, waits: 0, peakPending: 0, scheduled: 0, failed: 0,
    maxPendingBytes: byteLimit, peakPendingBytes: 0 };
  const effectiveLimit = () => {
    const value = typeof resolveMaxPending === 'function'
      ? Number(resolveMaxPending({pending: pending.size, maxPending: stats.currentMaxPending}))
      : stats.currentMaxPending;
    const next = Number.isFinite(value) && value > 0 ? Math.max(1, Math.floor(value)) : stats.currentMaxPending;
    const prior = stats.currentMaxPending;
    stats.currentMaxPending = next;
    stats.peakDynamicMaxPending = Math.max(stats.peakDynamicMaxPending, next);
    stats.minDynamicMaxPending = Math.min(stats.minDynamicMaxPending, next);
    if (next !== prior) {
      stats.adjustments++;
      onAdjust?.({from: prior, to: next, pending: pending.size});
    }
    return next;
  };
  const enqueue = async (fn, {bytes = 0} = {}) => {
    if (typeof fn !== 'function') return;
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > byteLimit) {
      throw new RangeError('Writer payload exceeds pending byte budget.');
    }
    producers++;
    try {
      while (pending.size >= effectiveLimit() || pendingBytes + bytes > byteLimit) {
        stats.waits++;
        await Promise.race(pending);
      }
      // Reserve synchronously before yielding, including work waiting in scheduleIo.
      let release;
      const reservation = new Promise(resolve => { release = resolve; });
      pending.add(reservation);
      pendingBytes += bytes;
      stats.scheduled++;
      stats.peakPending = Math.max(stats.peakPending, pending.size);
      stats.peakPendingBytes = Math.max(stats.peakPendingBytes, pendingBytes);
      Promise.resolve().then(() => typeof scheduleIo === 'function' ? scheduleIo(fn) : fn())
        .catch(() => { stats.failed++; })
        .finally(() => {
          pending.delete(reservation);
          pendingBytes -= bytes;
          release();
        });
    } finally {
      producers--;
    }
  };
  const onIdle = async () => {
    while (pending.size || producers) {
      if (pending.size) await Promise.race(pending);
      else await Promise.resolve();
    }
  };
  return {enqueue, onIdle, stats: () => ({...stats, pending: pending.size, pendingBytes})};
};
