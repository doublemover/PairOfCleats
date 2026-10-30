import { prepareSemanticBatchEntry } from './prepared-batch.js';
import { describeStorageFailure } from '../../shared/storage/failure-observation.js';
import { throwIfAborted } from '../../shared/abort.js';

export const NATIVE_FLOW_CONSTRUCTION_MAX_BYTES = 128 * 1024;
export const NATIVE_FLOW_SHARED_CONSTRUCTION_BYTES = 16 * 1024 * 1024;
const FRAME_BYTES = 256, MAX_ROW_BYTES = 32768, MAX_REASON_BYTES = 16384;

/** One producer retains only traversal frames, bounded reason strings and its
 * current prepared row. Previously yielded entries belong to the existing
 * writer's separately bounded batch/queue, never this construction lease.
 * Logical encoded-byte/frame allowances are not JavaScript heap measurements.
 */
export const createNativeFlowConstruction = ({ maxBytes, maxWork = maxBytes * 32, maxRowBytes = MAX_ROW_BYTES, signal }) => {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > NATIVE_FLOW_CONSTRUCTION_MAX_BYTES
    || !Number.isSafeInteger(maxWork) || maxWork < 1 || !Number.isSafeInteger(maxRowBytes) || maxRowBytes < 1
    || maxRowBytes > MAX_ROW_BYTES) throw new TypeError('Bounded native flow construction allowances required.');
  const stats = { work: 0, constructedRows: 0, liveFrames: 0, peakFrames: 0,
    liveLogicalBytes: 0, peakLogicalBytes: 0, livePreparedRows: 0, peakPreparedRows: 0,
    reasonBytes: 0, maxBytes, maxWork, rowAllowance: Math.min(maxRowBytes, Math.max(1, Math.floor(maxBytes / 2))) };
  const stops = new Map();
  const stop = allowance => {
    if (!stops.has(allowance)) stops.set(allowance, Object.freeze(Object.assign(
      new RangeError('Native flow construction exhausted ' + allowance + '.'), { code: 'ERR_NATIVE_FLOW_CONSTRUCTION_BUDGET', allowance })));
    throw stops.get(allowance);
  };
  const check = () => { throwIfAborted(signal); if (++stats.work > maxWork) stop('work'); };
  const reserve = bytes => {
    check();
    if (bytes > maxBytes - stats.liveLogicalBytes) stop('live-bytes');
    stats.liveLogicalBytes += bytes; stats.peakLogicalBytes = Math.max(stats.peakLogicalBytes, stats.liveLogicalBytes);
    let released = false;
    return () => { if (!released) { released = true; stats.liveLogicalBytes -= bytes; } };
  };
  const reasons = new Set(), reasonReleases = [];
  return {
    check, stats, reasons,
    isStop: error => [...stops.values()].includes(error),
    enterFrame() {
      const release = reserve(FRAME_BYTES); stats.liveFrames++; stats.peakFrames = Math.max(stats.peakFrames, stats.liveFrames);
      return () => { stats.liveFrames--; release(); };
    },
    reason(reason) {
      check(); if (reasons.has(reason)) return;
      const bytes = Buffer.byteLength(reason);
      if (bytes > MAX_REASON_BYTES - stats.reasonBytes) stop('reason-bytes');
      const release = reserve(bytes); reasonReleases.push(release);
      stats.reasonBytes += bytes; reasons.add(reason);
    },
    *emit(createRow) {
      if (stats.rowAllowance < 2) stop('entry-bytes');
      const release = reserve(stats.rowAllowance);
      stats.livePreparedRows++; stats.peakPreparedRows = Math.max(stats.peakPreparedRows, stats.livePreparedRows);
      try {
        let entry;
        try { entry = prepareSemanticBatchEntry(createRow(), { maxBytes: stats.rowAllowance, check }); }
        catch (error) {
          if (describeStorageFailure(error, { phase: 'native-flow-row-construction' }).code === 'ERR_SEMANTIC_JSON_BUDGET') stop('entry-bytes');
          throw error;
        }
        stats.constructedRows++;
        yield entry;
      } finally { stats.livePreparedRows--; release(); }
    },
    dispose() {
      for (const release of reasonReleases) release();
      reasonReleases.length = 0; reasons.clear(); stats.reasonBytes = 0;
    }
  };
};
