import { isAbortError, raceAbort, throwIfAborted } from '../../../src/shared/abort.js';

export const createBoundedWriterQueue = ({
  scheduleIo,
  maxPending,
  maxPendingBytes = 256 * 1024 * 1024,
  resolveMaxPending,
  onAdjust,
  signal: runSignal = null
} = {}) => {
  const resolvedMaxPending = Number.isFinite(Number(maxPending)) && maxPending != null
    ? Math.max(1, Math.floor(Number(maxPending))) : 1;
  const byteLimit = Number.isSafeInteger(maxPendingBytes) && maxPendingBytes > 0
    ? maxPendingBytes : 256 * 1024 * 1024;
  const pending = new Set();
  let pendingBytes = 0;
  let producers = 0;
  let waitingProducerBytes = 0;
  let preparing = 0;
  const stats = { maxPending: resolvedMaxPending, currentMaxPending: resolvedMaxPending,
    peakDynamicMaxPending: resolvedMaxPending, minDynamicMaxPending: resolvedMaxPending,
    adjustments: 0, waits: 0, peakPending: 0, scheduled: 0, failed: 0, cancelled: 0,
    maxPendingBytes: byteLimit, peakPendingBytes: 0, peakWaitingProducerBytes: 0, peakPreparing: 0, encodingMs: 0, writeMs: 0 };
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
  const enqueue = async (fn, {bytes = 0, prepare = null, signal = runSignal} = {}) => {
    if (typeof fn !== 'function') return;
    throwIfAborted(signal);
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > byteLimit) {
      throw new RangeError('Writer payload exceeds pending byte budget.');
    }
    producers++;
    waitingProducerBytes += bytes;
    let waiting = true;
    stats.peakWaitingProducerBytes = Math.max(stats.peakWaitingProducerBytes, waitingProducerBytes);
    try {
      while (pending.size >= effectiveLimit() || pendingBytes + bytes > byteLimit) {
        stats.waits++;
        await raceAbort(signal, Promise.race(pending));
      }
      throwIfAborted(signal);
      // Reserve synchronously before yielding, including work waiting in scheduleIo.
      let release;
      const reservation = new Promise(resolve => { release = resolve; });
      pending.add(reservation);
      pendingBytes += bytes;
      waitingProducerBytes -= bytes;
      waiting = false;
      stats.scheduled++;
      stats.peakPending = Math.max(stats.peakPending, pending.size);
      stats.peakPendingBytes = Math.max(stats.peakPendingBytes, pendingBytes);
      let writeStartedAt = null;
      Promise.resolve().then(() => {
        throwIfAborted(signal);
        return prepare?.();
      }).then((prepared) => {
        throwIfAborted(signal);
        writeStartedAt = performance.now();
        const write = () => { throwIfAborted(signal); return fn(prepared); };
        return typeof scheduleIo === 'function' ? scheduleIo(write) : write();
      })
        .catch(error => { stats.failed++; if (isAbortError(error)) stats.cancelled++; })
        .finally(() => {
          if (writeStartedAt != null) stats.writeMs += performance.now() - writeStartedAt;
          pending.delete(reservation);
          pendingBytes -= bytes;
          release();
        });
    } catch (error) {
      if (isAbortError(error)) stats.cancelled++;
      throw error;
    } finally {
      if (waiting) waitingProducerBytes -= bytes;
      producers--;
    }
  };
  const enqueuePrepared = async ({ estimateBytes, prepare, write, signal = runSignal } = {}) => {
    if (typeof prepare !== 'function' || typeof write !== 'function') throw new TypeError('Prepared writer requires encoding and writing functions.');
    // The reservation exists before encoding, including raw input and encoded output estimates.
    await enqueue(write, { bytes: estimateBytes, signal, prepare: async () => {
      preparing++;
      stats.peakPreparing = Math.max(stats.peakPreparing, preparing);
      const started = performance.now();
      let value;
      try { value = await prepare(); }
      finally { preparing--; stats.encodingMs += performance.now() - started; }
      const encodedBytes = Buffer.isBuffer(value) ? value.length
        : Array.isArray(value) ? value.reduce((sum, item) => sum + (item.encodedPayload?.length || 0), 0) : 0;
      if (encodedBytes > estimateBytes) throw new RangeError('Encoded writer payload exceeds its reserved estimate.');
      return value;
    } });
  };
  const onIdle = async () => {
    while (pending.size || producers) {
      if (pending.size) await Promise.race(pending);
      else await Promise.resolve();
    }
  };
  return {enqueue, enqueuePrepared, onIdle, stats: () => ({...stats, pending: pending.size, pendingBytes, producers, waitingProducerBytes, preparing})};
};
