export const createBoundedWriterQueue = ({
  scheduleIo,
  maxPending,
  resolveMaxPending,
  onAdjust
} = {}) => {
  const resolvedMaxPending = Number.isFinite(Number(maxPending))
    ? Math.max(1, Math.floor(Number(maxPending)))
    : 1;
  const resolveDynamicMaxPending = typeof resolveMaxPending === 'function' ? resolveMaxPending : null;
  const onAdjustCallback = typeof onAdjust === 'function' ? onAdjust : null;

  const pending = new Set();
  const stats = {
    maxPending: resolvedMaxPending,
    currentMaxPending: resolvedMaxPending,
    peakDynamicMaxPending: resolvedMaxPending,
    minDynamicMaxPending: resolvedMaxPending,
    adjustments: 0,
    waits: 0,
    peakPending: 0,
    scheduled: 0,
    failed: 0
  };

  const track = (task) => {
    const settled = Promise.resolve(task).then(
      () => null,
      () => {
        stats.failed += 1;
        return null;
      }
    );
    pending.add(settled);
    stats.peakPending = Math.max(stats.peakPending, pending.size);
    settled.finally(() => pending.delete(settled)).catch(() => {});
    return settled;
  };

  const getEffectiveMaxPending = () => {
    if (!resolveDynamicMaxPending) return stats.currentMaxPending;
    const resolved = Number(resolveDynamicMaxPending({
      pending: pending.size,
      maxPending: stats.currentMaxPending
    }));
    const next = Number.isFinite(resolved) && resolved > 0
      ? Math.max(1, Math.floor(resolved))
      : stats.currentMaxPending;
    const prior = stats.currentMaxPending;
    stats.currentMaxPending = next;
    stats.peakDynamicMaxPending = Math.max(stats.peakDynamicMaxPending, next);
    stats.minDynamicMaxPending = Math.min(stats.minDynamicMaxPending, next);
    if (next !== prior) {
      stats.adjustments += 1;
      if (onAdjustCallback) {
        onAdjustCallback({ from: prior, to: next, pending: pending.size });
      }
    }
    return next;
  };

  const awaitSlot = async () => {
    while (pending.size >= getEffectiveMaxPending()) {
      stats.waits += 1;
      await Promise.race(pending);
    }
  };

  const enqueue = async (fn) => {
    if (typeof fn !== 'function') return;
    await awaitSlot();
    stats.scheduled += 1;
    const task = typeof scheduleIo === 'function'
      ? scheduleIo(fn)
      : Promise.resolve().then(fn);
    track(task);
  };

  const onIdle = async () => {
    if (!pending.size) return;
    await Promise.all(Array.from(pending));
  };

  const snapshot = () => ({ ...stats, pending: pending.size });

  return {
    enqueue,
    onIdle,
    stats: snapshot
  };
};
