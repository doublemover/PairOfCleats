import { coerceNonNegativeInt } from '../../../../../shared/number-coerce.js';

export const FILE_WATCHDOG_DEFAULT_MS = 10000;
export const FILE_WATCHDOG_NEAR_THRESHOLD_LOWER_FRACTION = 0.85;
export const FILE_WATCHDOG_NEAR_THRESHOLD_UPPER_FRACTION = 1;
export const FILE_WATCHDOG_NEAR_THRESHOLD_ALERT_FRACTION = 0.6;
export const FILE_WATCHDOG_NEAR_THRESHOLD_MIN_SAMPLES = 20;
export const STAGE_TIMING_SIZE_BINS = Object.freeze([
  Object.freeze({ id: '0-16kb', maxBytes: 16 * 1024 }),
  Object.freeze({ id: '16-64kb', maxBytes: 64 * 1024 }),
  Object.freeze({ id: '64-256kb', maxBytes: 256 * 1024 }),
  Object.freeze({ id: '256kb-1mb', maxBytes: 1024 * 1024 }),
  Object.freeze({ id: '1mb-4mb', maxBytes: 4 * 1024 * 1024 }),
  Object.freeze({ id: '4mb+', maxBytes: Number.POSITIVE_INFINITY })
]);
export const FILE_QUEUE_DELAY_HISTOGRAM_BUCKETS_MS = Object.freeze([
  50, 100, 250, 500, 1000, 2000, 5000, 10000, 30000, 60000
]);

/**
 * Parse and clamp fractional values with bounds, falling back when invalid.
 *
 * @param {unknown} value
 * @param {number} fallback
 * @param {{min?:number,max?:number,allowZero?:boolean}} [options]
 * @returns {number}
 */
const coerceClampedFractionOrDefault = (
  value,
  fallback,
  { min = 0, max = 1, allowZero = false } = {}
) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  if ((!allowZero && parsed <= 0) || parsed < min || parsed > max) return fallback;
  return parsed;
};

/**
 * Normalize optional durations to finite non-negative milliseconds.
 *
 * @param {unknown} value
 * @returns {number}
 */
const clampDurationMs = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
};

/**
 * Resolve commit-cursor lag from highest seen seq and next commit seq.
 *
 * @param {{maxSeenSeq?:number,nextCommitSeq?:number}} [input]
 * @returns {number}
 */
export const resolveCommitLag = ({
  maxSeenSeq = 0,
  nextCommitSeq = 0
} = {}) => {
  const maxSeen = Number(maxSeenSeq);
  const nextCommit = Number(nextCommitSeq);
  if (!Number.isFinite(maxSeen) || !Number.isFinite(nextCommit)) return 0;
  return Math.max(0, Math.floor(maxSeen) - Math.floor(nextCommit));
};

/**
 * Classify file size into stable stage-timing telemetry bins.
 *
 * @param {number} bytes
 * @returns {string}
 */
export const resolveStageTimingSizeBin = (bytes) => {
  const safeBytes = coerceNonNegativeInt(bytes) ?? 0;
  for (const bin of STAGE_TIMING_SIZE_BINS) {
    if (safeBytes <= bin.maxBytes) return bin.id;
  }
  return STAGE_TIMING_SIZE_BINS[STAGE_TIMING_SIZE_BINS.length - 1].id;
};

/**
 * Create a duration histogram collector with sorted unique bucket bounds.
 *
 * @param {number[]} [bucketsMs]
 * @returns {{observe:(value:number)=>void,snapshot:()=>{bucketsMs:number[],counts:number[],overflow:number}}}
 */
export const createDurationHistogram = (bucketsMs = FILE_QUEUE_DELAY_HISTOGRAM_BUCKETS_MS) => {
  const normalizedBuckets = Array.from(
    new Set(
      (Array.isArray(bucketsMs) ? bucketsMs : [])
        .map((value) => coerceNonNegativeInt(value))
        .filter((value) => value != null && value >= 0)
    )
  ).sort((a, b) => a - b);
  const bucketList = normalizedBuckets.length
    ? normalizedBuckets
    : FILE_QUEUE_DELAY_HISTOGRAM_BUCKETS_MS.slice();
  const counts = new Array(bucketList.length).fill(0);
  let overflow = 0;
  return {
    observe(value) {
      const durationMs = clampDurationMs(value);
      let matched = false;
      for (let i = 0; i < bucketList.length; i += 1) {
        if (durationMs <= bucketList[i]) {
          counts[i] += 1;
          matched = true;
          break;
        }
      }
      if (!matched) overflow += 1;
    },
    snapshot() {
      return {
        bucketsMs: bucketList.slice(),
        counts: counts.slice(),
        overflow
      };
    }
  };
};

/**
 * Resolve queue/active/write/total durations from lifecycle timestamps.
 *
 * @param {object} [lifecycle]
 * @returns {{queueDelayMs:number,activeDurationMs:number,writeDurationMs:number,totalDurationMs:number}}
 */
export const resolveFileLifecycleDurations = (lifecycle = {}) => {
  const enqueuedAtMs = Number(lifecycle?.enqueuedAtMs);
  const dequeuedAtMs = Number(lifecycle?.dequeuedAtMs);
  const parseStartAtMs = Number(lifecycle?.parseStartAtMs);
  const parseEndAtMs = Number(lifecycle?.parseEndAtMs);
  const writeStartAtMs = Number(lifecycle?.writeStartAtMs);
  const writeEndAtMs = Number(lifecycle?.writeEndAtMs);
  const queueDelayMs = Number.isFinite(enqueuedAtMs) && Number.isFinite(dequeuedAtMs)
    ? Math.max(0, dequeuedAtMs - enqueuedAtMs)
    : 0;
  const activeDurationMs = Number.isFinite(parseStartAtMs) && Number.isFinite(parseEndAtMs)
    ? Math.max(0, parseEndAtMs - parseStartAtMs)
    : 0;
  const writeDurationMs = Number.isFinite(writeStartAtMs) && Number.isFinite(writeEndAtMs)
    ? Math.max(0, writeEndAtMs - writeStartAtMs)
    : 0;
  const totalDurationMs = Number.isFinite(enqueuedAtMs) && Number.isFinite(writeEndAtMs)
    ? Math.max(0, writeEndAtMs - enqueuedAtMs)
    : (queueDelayMs + activeDurationMs + writeDurationMs);
  return {
    queueDelayMs,
    activeDurationMs,
    writeDurationMs,
    totalDurationMs
  };
};

/**
 * Decide whether active processing time crossed slow-file warning threshold.
 *
 * @param {{activeDurationMs:number,thresholdMs:number}} input
 * @returns {boolean}
 */
export const shouldTriggerSlowFileWarning = ({ activeDurationMs, thresholdMs }) => {
  const threshold = Number(thresholdMs);
  if (!Number.isFinite(threshold) || threshold <= 0) return false;
  return clampDurationMs(activeDurationMs) >= threshold;
};

/**
 * Detect durations close to, but below, the slow-file threshold.
 *
 * @param {{
 *   activeDurationMs:number,
 *   thresholdMs:number,
 *   lowerFraction?:number,
 *   upperFraction?:number
 * }} [input]
 * @returns {boolean}
 */
export const isNearThresholdSlowFileDuration = ({
  activeDurationMs,
  thresholdMs,
  lowerFraction = FILE_WATCHDOG_NEAR_THRESHOLD_LOWER_FRACTION,
  upperFraction = FILE_WATCHDOG_NEAR_THRESHOLD_UPPER_FRACTION
} = {}) => {
  const threshold = Number(thresholdMs);
  if (!Number.isFinite(threshold) || threshold <= 0) return false;
  const clampedLower = coerceClampedFractionOrDefault(lowerFraction, FILE_WATCHDOG_NEAR_THRESHOLD_LOWER_FRACTION, {
    min: 0,
    max: 1,
    allowZero: false
  });
  const clampedUpper = coerceClampedFractionOrDefault(upperFraction, FILE_WATCHDOG_NEAR_THRESHOLD_UPPER_FRACTION, {
    min: 0,
    max: 1,
    allowZero: false
  });
  const normalizedUpper = Math.max(clampedLower, clampedUpper);
  const durationMs = clampDurationMs(activeDurationMs);
  const lowerBoundMs = threshold * clampedLower;
  const upperBoundMs = threshold * normalizedUpper;
  return durationMs >= lowerBoundMs && durationMs < upperBoundMs;
};

/**
 * Build near-threshold watchdog summary and optional tuning suggestion.
 *
 * @param {object} [input]
 * @returns {object}
 */
export const buildWatchdogNearThresholdSummary = ({
  sampleCount = 0,
  nearThresholdCount = 0,
  slowWarningCount = 0,
  thresholdTotalMs = 0,
  activeTotalMs = 0,
  lowerFraction = FILE_WATCHDOG_NEAR_THRESHOLD_LOWER_FRACTION,
  upperFraction = FILE_WATCHDOG_NEAR_THRESHOLD_UPPER_FRACTION,
  alertFraction = FILE_WATCHDOG_NEAR_THRESHOLD_ALERT_FRACTION,
  minSamples = FILE_WATCHDOG_NEAR_THRESHOLD_MIN_SAMPLES,
  slowFileMs = FILE_WATCHDOG_DEFAULT_MS
} = {}) => {
  const safeSampleCount = Math.max(0, Math.floor(Number(sampleCount) || 0));
  const safeNearThresholdCount = Math.max(0, Math.floor(Number(nearThresholdCount) || 0));
  const safeSlowWarningCount = Math.max(0, Math.floor(Number(slowWarningCount) || 0));
  const nearThresholdRatio = safeSampleCount > 0
    ? Math.min(1, safeNearThresholdCount / safeSampleCount)
    : 0;
  const clampedAlertFraction = coerceClampedFractionOrDefault(
    alertFraction,
    FILE_WATCHDOG_NEAR_THRESHOLD_ALERT_FRACTION,
    { min: 0, max: 1, allowZero: false }
  );
  const safeMinSamples = Math.max(1, Math.floor(Number(minSamples) || FILE_WATCHDOG_NEAR_THRESHOLD_MIN_SAMPLES));
  const anomaly = safeSampleCount >= safeMinSamples
    && nearThresholdRatio >= clampedAlertFraction;
  const safeSlowFileMs = Math.max(1, Math.floor(Number(slowFileMs) || FILE_WATCHDOG_DEFAULT_MS));
  const suggestedSlowFileMs = anomaly
    ? Math.max(safeSlowFileMs + 1, Math.ceil(safeSlowFileMs * 1.25))
    : null;
  return {
    sampleCount: safeSampleCount,
    nearThresholdCount: safeNearThresholdCount,
    slowWarningCount: safeSlowWarningCount,
    nearThresholdRatio,
    avgThresholdMs: safeSampleCount > 0 ? clampDurationMs(thresholdTotalMs) / safeSampleCount : 0,
    avgActiveMs: safeSampleCount > 0 ? clampDurationMs(activeTotalMs) / safeSampleCount : 0,
    lowerFraction: coerceClampedFractionOrDefault(lowerFraction, FILE_WATCHDOG_NEAR_THRESHOLD_LOWER_FRACTION, {
      min: 0,
      max: 1,
      allowZero: false
    }),
    upperFraction: coerceClampedFractionOrDefault(upperFraction, FILE_WATCHDOG_NEAR_THRESHOLD_UPPER_FRACTION, {
      min: 0,
      max: 1,
      allowZero: false
    }),
    alertFraction: clampedAlertFraction,
    minSamples: safeMinSamples,
    anomaly,
    suggestedSlowFileMs
  };
};
