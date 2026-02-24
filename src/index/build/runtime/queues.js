import {
  coerceClampedFraction,
  coerceNonNegativeInt,
  coercePositiveInt
} from '../../../shared/number-coerce.js';
import { normalizeOwnershipSegment } from '../../../shared/ownership-segment.js';

/**
 * Build deterministic ownership prefix for stage1 subprocess queues.
 *
 * @param {{buildId?:string}} [input]
 * @returns {string}
 */
export const buildStage1SubprocessOwnershipPrefix = ({ buildId } = {}) => (
  `stage1:${normalizeOwnershipSegment(buildId, 'build')}`
);

/**
 * Normalize optional integer override to non-negative number or null.
 *
 * @param {unknown} value
 * @returns {number|null}
 */
const coerceOptionalNonNegativeInt = (value) => {
  if (value === null || value === undefined) return null;
  return coerceNonNegativeInt(value);
};

/**
 * Shared runtime telemetry collector for cross-stage in-flight gauges.
 *
 * @returns {{
 *   setInFlightBytes:(channel:string, input?:{bytes?:number,count?:number})=>void,
 *   clearInFlightBytes:(channel:string)=>void,
 *   readInFlightBytes:()=>{total:number,channels:Record<string,{bytes:number,count:number}>},
 *   recordDuration:(channel:string, durationMs:number)=>void,
 *   clearDurationHistogram:(channel:string)=>void,
 *   readDurationHistograms:()=>Record<string,{
 *     count:number,totalMs:number,minMs:number,maxMs:number,avgMs:number,
 *     bucketsMs:number[],counts:number[],overflow:number
 *   }>
 * }}
 */
export const createRuntimeTelemetry = () => {
  const channels = new Map();
  const DEFAULT_DURATION_BUCKETS_MS = Object.freeze([
    50,
    100,
    250,
    500,
    1000,
    2000,
    5000,
    10000,
    30000,
    60000
  ]);
  const durationHistograms = new Map();
  const setInFlightBytes = (channel, input = {}) => {
    if (!channel) return;
    const bytes = Number(input?.bytes);
    const count = Number(input?.count);
    channels.set(String(channel), {
      bytes: Number.isFinite(bytes) && bytes > 0 ? Math.floor(bytes) : 0,
      count: Number.isFinite(count) && count > 0 ? Math.floor(count) : 0
    });
  };
  const clearInFlightBytes = (channel) => {
    if (!channel) return;
    channels.delete(String(channel));
  };
  const readInFlightBytes = () => {
    const out = {};
    let total = 0;
    for (const [name, value] of channels.entries()) {
      const bytes = Number(value?.bytes) || 0;
      const count = Number(value?.count) || 0;
      out[name] = { bytes, count };
      total += bytes;
    }
    return { total, channels: out };
  };
  const coerceDurationMs = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  };
  const resolveHistogramState = (channel) => {
    const key = String(channel);
    const existing = durationHistograms.get(key);
    if (existing) return existing;
    const bucketsMs = DEFAULT_DURATION_BUCKETS_MS.slice();
    const state = {
      bucketsMs,
      counts: new Array(bucketsMs.length).fill(0),
      overflow: 0,
      count: 0,
      totalMs: 0,
      minMs: null,
      maxMs: 0
    };
    durationHistograms.set(key, state);
    return state;
  };
  const recordDuration = (channel, durationMs) => {
    if (!channel) return;
    const duration = coerceDurationMs(durationMs);
    const state = resolveHistogramState(channel);
    state.count += 1;
    state.totalMs += duration;
    state.minMs = state.minMs == null ? duration : Math.min(state.minMs, duration);
    state.maxMs = Math.max(state.maxMs, duration);
    let bucketIndex = -1;
    for (let i = 0; i < state.bucketsMs.length; i += 1) {
      if (duration <= state.bucketsMs[i]) {
        bucketIndex = i;
        break;
      }
    }
    if (bucketIndex >= 0) {
      state.counts[bucketIndex] += 1;
    } else {
      state.overflow += 1;
    }
  };
  const clearDurationHistogram = (channel) => {
    if (!channel) return;
    durationHistograms.delete(String(channel));
  };
  const readDurationHistograms = () => {
    const out = {};
    for (const [name, value] of durationHistograms.entries()) {
      const count = Number(value?.count) || 0;
      const totalMs = Number(value?.totalMs) || 0;
      const minMs = value?.minMs == null ? 0 : (Number(value.minMs) || 0);
      const maxMs = Number(value?.maxMs) || 0;
      const avgMs = count > 0 ? totalMs / count : 0;
      out[name] = {
        count,
        totalMs,
        minMs,
        maxMs,
        avgMs,
        bucketsMs: Array.isArray(value?.bucketsMs) ? value.bucketsMs.slice() : [],
        counts: Array.isArray(value?.counts) ? value.counts.slice() : [],
        overflow: Number(value?.overflow) || 0
      };
    }
    return out;
  };
  return {
    setInFlightBytes,
    clearInFlightBytes,
    readInFlightBytes,
    recordDuration,
    clearDurationHistogram,
    readDurationHistograms
  };
};

/**
 * Resolve stage1 queue controls from indexing configuration, coercing optional
 * numeric overrides into safe integer/fraction values.
 *
 * @param {object} [indexingConfig]
 * @returns {{tokenize:object,postings:object,ordered:object,watchdog:object}}
 */
export const resolveStage1Queues = (indexingConfig = {}) => {
  const stage1 = indexingConfig?.stage1 && typeof indexingConfig.stage1 === 'object'
    ? indexingConfig.stage1
    : {};
  const tokenize = stage1?.tokenize && typeof stage1.tokenize === 'object'
    ? stage1.tokenize
    : {};
  const postings = stage1?.postings && typeof stage1.postings === 'object'
    ? stage1.postings
    : {};
  const ordered = stage1?.ordered && typeof stage1.ordered === 'object'
    ? stage1.ordered
    : {};
  const watchdog = stage1?.watchdog && typeof stage1.watchdog === 'object'
    ? stage1.watchdog
    : {};

  const tokenizeConcurrency = coercePositiveInt(tokenize.concurrency);
  const tokenizeMaxPending = coercePositiveInt(tokenize.maxPending);

  const postingsMaxPending = coercePositiveInt(
    postings.maxPending ?? postings.concurrency
  );
  const postingsMaxPendingRows = coercePositiveInt(postings.maxPendingRows);
  const postingsMaxPendingBytes = coercePositiveInt(postings.maxPendingBytes);
  const postingsMaxHeapFraction = coerceClampedFraction(postings.maxHeapFraction, {
    min: 0,
    max: 1,
    allowZero: true
  });
  const orderedMaxPending = coercePositiveInt(ordered.maxPending);
  const orderedBucketSize = coercePositiveInt(ordered.bucketSize);
  const orderedMaxPendingEmergencyFactor = Number(ordered.maxPendingEmergencyFactor);
  const watchdogSlowFileMs = coerceOptionalNonNegativeInt(
    watchdog.slowFileMs ?? stage1.fileWatchdogMs
  );
  const watchdogMaxSlowFileMs = coerceOptionalNonNegativeInt(
    watchdog.maxSlowFileMs ?? stage1.fileWatchdogMaxMs
  );
  const watchdogHardTimeoutMs = coerceOptionalNonNegativeInt(
    watchdog.hardTimeoutMs ?? stage1.fileWatchdogHardMs
  );
  const watchdogBytesPerStep = coercePositiveInt(watchdog.bytesPerStep);
  const watchdogLinesPerStep = coercePositiveInt(watchdog.linesPerStep);
  const watchdogStepMs = coercePositiveInt(watchdog.stepMs);
  const watchdogNearThresholdLowerFraction = coerceClampedFraction(
    watchdog.nearThresholdLowerFraction,
    { min: 0, max: 1, allowZero: false }
  );
  const watchdogNearThresholdUpperFraction = coerceClampedFraction(
    watchdog.nearThresholdUpperFraction,
    { min: 0, max: 1, allowZero: false }
  );
  const watchdogNearThresholdAlertFraction = coerceClampedFraction(
    watchdog.nearThresholdAlertFraction,
    { min: 0, max: 1, allowZero: false }
  );
  const watchdogNearThresholdMinSamples = coercePositiveInt(watchdog.nearThresholdMinSamples);
  const watchdogCleanupTimeoutMs = coerceOptionalNonNegativeInt(watchdog.cleanupTimeoutMs);

  return {
    tokenize: {
      concurrency: tokenizeConcurrency,
      maxPending: tokenizeMaxPending
    },
    postings: {
      maxPending: postingsMaxPending,
      maxPendingRows: postingsMaxPendingRows,
      maxPendingBytes: postingsMaxPendingBytes,
      maxHeapFraction: postingsMaxHeapFraction
    },
    ordered: {
      maxPending: orderedMaxPending,
      bucketSize: orderedBucketSize,
      maxPendingEmergencyFactor: Number.isFinite(orderedMaxPendingEmergencyFactor)
        && orderedMaxPendingEmergencyFactor > 1
        ? orderedMaxPendingEmergencyFactor
        : null
    },
    watchdog: {
      slowFileMs: watchdogSlowFileMs,
      maxSlowFileMs: watchdogMaxSlowFileMs,
      hardTimeoutMs: watchdogHardTimeoutMs,
      bytesPerStep: watchdogBytesPerStep,
      linesPerStep: watchdogLinesPerStep,
      stepMs: watchdogStepMs,
      nearThresholdLowerFraction: watchdogNearThresholdLowerFraction,
      nearThresholdUpperFraction: watchdogNearThresholdUpperFraction,
      nearThresholdAlertFraction: watchdogNearThresholdAlertFraction,
      nearThresholdMinSamples: watchdogNearThresholdMinSamples,
      cleanupTimeoutMs: watchdogCleanupTimeoutMs
    }
  };
};
