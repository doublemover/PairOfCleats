import v8 from 'node:v8';
import { normalizePostingsPayloadMetadata } from '../../../postings-payload.js';
import {
  coerceClampedFraction,
  coerceNonNegativeInt,
  coercePositiveInt
} from '../../../../../shared/number-coerce.js';

const MB = 1024 * 1024;

const resolveHeapLimit = () => {
  try {
    const stats = v8.getHeapStatistics();
    const limit = Number(stats?.heap_size_limit);
    if (!Number.isFinite(limit) || limit <= 0) return null;
    return limit;
  } catch {
    return null;
  }
};

const resolvePayloadRows = (result) => {
  if (!result || typeof result !== 'object') return 1;
  if (Array.isArray(result.chunks)) return result.chunks.length || 1;
  return 1;
};

const resolvePayloadBytes = (result) => {
  if (!result || typeof result !== 'object') return 0;
  const measureJsonValueBytes = (value) => {
    if (value == null) return 0;
    try {
      if (Array.isArray(value)) {
        let total = 2;
        for (let i = 0; i < value.length; i += 1) {
          const encoded = JSON.stringify(value[i]);
          total += Buffer.byteLength(encoded, 'utf8');
          if (i > 0) total += 1;
        }
        return total;
      }
      const encoded = JSON.stringify(value);
      return Buffer.byteLength(encoded, 'utf8');
    } catch {
      return 0;
    }
  };
  const chunks = Array.isArray(result.chunks) ? result.chunks : null;
  let total = chunks ? measureJsonValueBytes(chunks) : 0;
  if (result.fileRelations) total += measureJsonValueBytes(result.fileRelations);
  if (result.vfsManifestRows) total += measureJsonValueBytes(result.vfsManifestRows);
  return total;
};

/**
 * Estimate payload size for queue backpressure using precomputed metadata
 * when available, otherwise falling back to JSON-size approximation.
 *
 * @param {object|null} result
 * @returns {{rows:number,bytes:number}}
 */
export const estimatePostingsPayload = (result) => {
  const precomputed = normalizePostingsPayloadMetadata(result?.postingsPayload);
  if (precomputed) return precomputed;
  return {
    rows: resolvePayloadRows(result),
    bytes: resolvePayloadBytes(result)
  };
};

/**
 * Create a lightweight backpressure queue for postings writes.
 * Limits can be configured by pending task count, payload rows/bytes, and
 * adaptive heap pressure scaling; callers reserve before async writes and
 * release when done.
 *
 * @param {{
 *   maxPending?:number,
 *   maxPendingRows?:number,
 *   maxPendingBytes?:number,
 *   maxHeapFraction?:number,
 *   onChange?:(snapshot:{pendingCount:number,pendingRows:number,pendingBytes:number})=>void,
 *   log?:(msg:string)=>void
 * }} [options]
 * @returns {{reserve:(input?:{rows?:number,bytes?:number,bypass?:boolean})=>Promise<{release:()=>void}>,stats:()=>object}}
 */
export const createPostingsQueue = ({
  maxPending,
  maxPendingRows,
  maxPendingBytes,
  maxHeapFraction,
  onChange = null,
  log = null
} = {}) => {
  const resolvedMaxPending = coercePositiveInt(maxPending);
  const resolvedMaxPendingRows = coercePositiveInt(maxPendingRows);
  const resolvedMaxPendingBytes = coercePositiveInt(maxPendingBytes);
  const resolvedMaxHeapFraction = coerceClampedFraction(maxHeapFraction, {
    min: 0,
    max: 1,
    allowZero: false
  }) ?? 0.8;
  const heapLimit = resolveHeapLimit();

  const state = {
    pending: 0,
    pendingRows: 0,
    pendingBytes: 0,
    backpressureCount: 0,
    backpressureWaitMs: 0,
    backpressureMaxWaitMs: 0,
    backpressureEvents: 0,
    backpressureByCount: 0,
    backpressureByRows: 0,
    backpressureByBytes: 0,
    reserveBypassCount: 0,
    oversizeRows: 0,
    oversizeBytes: 0,
    pressureEvents: 0,
    payloadSamples: 0,
    measuredRows: 0,
    measuredBytes: 0,
    highWater: {
      pending: 0,
      rows: 0,
      bytes: 0,
      heapUsed: 0,
      heapRatio: 0
    }
  };

  const waiters = [];
  let lastLogAt = 0;
  const emitChange = () => {
    if (typeof onChange !== 'function') return;
    try {
      onChange({
        pendingCount: state.pending,
        pendingRows: state.pendingRows,
        pendingBytes: state.pendingBytes
      });
    } catch {}
  };
  const notifyWaiters = () => {
    if (!waiters.length) return;
    const pending = waiters.splice(0, waiters.length);
    for (const resolve of pending) resolve();
  };

  const noteHighWater = () => {
    state.highWater.pending = Math.max(state.highWater.pending, state.pending);
    state.highWater.rows = Math.max(state.highWater.rows, state.pendingRows);
    state.highWater.bytes = Math.max(state.highWater.bytes, state.pendingBytes);
    const heapUsed = Number(process.memoryUsage()?.heapUsed) || 0;
    state.highWater.heapUsed = Math.max(state.highWater.heapUsed, heapUsed);
    if (heapLimit) {
      const ratio = heapLimit > 0 ? heapUsed / heapLimit : 0;
      state.highWater.heapRatio = Math.max(state.highWater.heapRatio, ratio);
    }
  };

  const resolvePressure = () => {
    if (!heapLimit || !resolvedMaxHeapFraction || resolvedMaxHeapFraction >= 1) {
      return { pressure: false, factor: 1, heapUsed: 0, heapRatio: 0 };
    }
    const heapUsed = Number(process.memoryUsage()?.heapUsed) || 0;
    const heapRatio = heapLimit > 0 ? heapUsed / heapLimit : 0;
    if (!Number.isFinite(heapRatio) || heapRatio < resolvedMaxHeapFraction) {
      return { pressure: false, factor: 1, heapUsed, heapRatio };
    }
    const over = Math.min(1, (heapRatio - resolvedMaxHeapFraction) / (1 - resolvedMaxHeapFraction));
    const factor = Math.max(0.1, 1 - over);
    return { pressure: true, factor, heapUsed, heapRatio };
  };

  const resolveLimits = (rows, bytes, baseLimits) => {
    let maxCount = resolvedMaxPending;
    let maxRows = baseLimits?.maxRows ?? resolvedMaxPendingRows;
    let maxBytes = baseLimits?.maxBytes ?? resolvedMaxPendingBytes;
    const pressure = resolvePressure();
    if (pressure.pressure) {
      state.pressureEvents += 1;
      if (maxCount != null) maxCount = Math.max(1, Math.floor(maxCount * pressure.factor));
      if (maxRows != null) maxRows = Math.max(1, Math.floor(maxRows * pressure.factor));
      if (maxBytes != null) maxBytes = Math.max(1, Math.floor(maxBytes * pressure.factor));
      state.highWater.heapUsed = Math.max(state.highWater.heapUsed, pressure.heapUsed);
      state.highWater.heapRatio = Math.max(state.highWater.heapRatio, pressure.heapRatio);
    }
    if (maxRows != null && rows > maxRows) maxRows = rows;
    if (maxBytes != null && bytes > maxBytes) maxBytes = bytes;
    return {
      maxCount,
      maxRows,
      maxBytes,
      pressure
    };
  };

  const resolveWaitReason = (rows, bytes, limits) => {
    if (limits.maxCount != null && state.pending + 1 > limits.maxCount) return 'count';
    if (limits.maxRows != null && state.pendingRows + rows > limits.maxRows) return 'rows';
    if (limits.maxBytes != null && state.pendingBytes + bytes > limits.maxBytes) return 'bytes';
    return null;
  };

  const reserve = async ({ rows = 1, bytes = 0, bypass = false } = {}) => {
    const payloadRows = Math.max(1, coerceNonNegativeInt(rows) ?? 1);
    const payloadBytes = Math.max(0, coerceNonNegativeInt(bytes) ?? 0);
    const oversizeRows = resolvedMaxPendingRows != null && payloadRows > resolvedMaxPendingRows;
    const oversizeBytes = resolvedMaxPendingBytes != null && payloadBytes > resolvedMaxPendingBytes;
    if (oversizeRows) state.oversizeRows += 1;
    if (oversizeBytes) state.oversizeBytes += 1;
    const baseLimits = {
      maxRows: oversizeRows ? payloadRows : resolvedMaxPendingRows,
      maxBytes: oversizeBytes ? payloadBytes : resolvedMaxPendingBytes
    };
    if (!bypass) {
      let waited = false;
      const waitStart = Date.now();
      while (true) {
        const limits = resolveLimits(payloadRows, payloadBytes, baseLimits);
        const reason = resolveWaitReason(payloadRows, payloadBytes, limits);
        if (!reason) break;
        if (!waited) {
          waited = true;
          state.backpressureCount += 1;
          if (reason === 'count') state.backpressureByCount += 1;
          else if (reason === 'rows') state.backpressureByRows += 1;
          else if (reason === 'bytes') state.backpressureByBytes += 1;
          if (typeof log === 'function') {
            const now = Date.now();
            if (now - lastLogAt >= 5000) {
              lastLogAt = now;
              const countText = limits.maxCount != null ? `maxPending=${limits.maxCount}` : 'maxPending=∞';
              const rowText = limits.maxRows != null ? `maxRows=${limits.maxRows}` : 'maxRows=∞';
              const byteText = limits.maxBytes != null
                ? `maxBytes=${(limits.maxBytes / MB).toFixed(1)}MB`
                : 'maxBytes=∞';
              log(`[postings] backpressure ${countText} ${rowText} ${byteText}.`);
            }
          }
        }
        await new Promise((resolve) => waiters.push(resolve));
      }
      if (waited) {
        const waitMs = Math.max(0, Date.now() - waitStart);
        state.backpressureWaitMs += waitMs;
        state.backpressureMaxWaitMs = Math.max(state.backpressureMaxWaitMs, waitMs);
        state.backpressureEvents += 1;
      }
    } else {
      state.reserveBypassCount += 1;
    }
    state.pending += 1;
    state.pendingRows += payloadRows;
    state.pendingBytes += payloadBytes;
    state.payloadSamples += 1;
    state.measuredRows += payloadRows;
    state.measuredBytes += payloadBytes;
    noteHighWater();
    emitChange();
    return {
      release() {
        state.pending = Math.max(0, state.pending - 1);
        state.pendingRows = Math.max(0, state.pendingRows - payloadRows);
        state.pendingBytes = Math.max(0, state.pendingBytes - payloadBytes);
        emitChange();
        notifyWaiters();
      }
    };
  };

  const stats = () => ({
    limits: {
      maxPending: resolvedMaxPending,
      maxPendingRows: resolvedMaxPendingRows,
      maxPendingBytes: resolvedMaxPendingBytes,
      maxHeapFraction: resolvedMaxHeapFraction
    },
    pending: {
      count: state.pending,
      rows: state.pendingRows,
      bytes: state.pendingBytes
    },
    highWater: { ...state.highWater },
    backpressure: {
      count: state.backpressureCount,
      waitMs: state.backpressureWaitMs,
      maxWaitMs: state.backpressureMaxWaitMs,
      events: state.backpressureEvents,
      byCount: state.backpressureByCount,
      byRows: state.backpressureByRows,
      byBytes: state.backpressureByBytes,
      bypass: state.reserveBypassCount
    },
    payload: {
      samples: state.payloadSamples,
      measuredRows: state.measuredRows,
      measuredBytes: state.measuredBytes,
      avgRows: state.payloadSamples ? (state.measuredRows / state.payloadSamples) : 0,
      avgBytes: state.payloadSamples ? (state.measuredBytes / state.payloadSamples) : 0
    },
    gauge: {
      pendingCount: state.pending,
      pendingRows: state.pendingRows,
      pendingBytes: state.pendingBytes,
      highWaterPendingCount: state.highWater.pending,
      highWaterPendingRows: state.highWater.rows,
      highWaterPendingBytes: state.highWater.bytes
    },
    oversize: {
      rows: state.oversizeRows,
      bytes: state.oversizeBytes
    },
    memory: {
      heapLimitBytes: heapLimit,
      pressureEvents: state.pressureEvents
    }
  });

  return {
    reserve,
    stats
  };
};
