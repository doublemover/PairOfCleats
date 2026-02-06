export const createBoundedWriterQueue = ({ scheduleIo, maxPending } = {}) => {
  const resolvedMaxPending = Number.isFinite(Number(maxPending))
    ? Math.max(1, Math.floor(Number(maxPending)))
    : 1;

  const pending = new Set();
  const stats = {
    maxPending: resolvedMaxPending,
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

  const awaitSlot = async () => {
    while (pending.size >= resolvedMaxPending) {
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

  const snapshot = () => ({ ...stats });

  return {
    enqueue,
    onIdle,
    stats: snapshot
  };
};

