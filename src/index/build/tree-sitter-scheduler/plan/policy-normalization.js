import { normalizePositiveInt, normalizePositiveNumber } from './metrics.js';

const HEAVY_GRAMMAR_BUCKET_TARGET_JOBS = 768;
export const HEAVY_GRAMMAR_BUCKET_MIN = 1;
export const HEAVY_GRAMMAR_BUCKET_MAX = 16;
const ADAPTIVE_BUCKET_MIN_JOBS = 64;
const ADAPTIVE_BUCKET_MAX_JOBS = 4096;
const ADAPTIVE_BUCKET_TARGET_MS = 1200;
const ADAPTIVE_WAVE_TARGET_MS = 900;
export const ADAPTIVE_WAVE_MIN_JOBS = 32;
export const ADAPTIVE_WAVE_MAX_JOBS = 2048;
const ESTIMATED_COST_BASELINE_PER_JOB = 40;

/**
 * Parse and normalize persisted lane-state snapshots.
 *
 * @param {unknown} laneState
 * @returns {{bucketCount:number,cooldownSteps:number,lastAction:'split'|'merge'|'hold'}|null}
 */
const normalizeObservedLaneState = (laneState) => {
  if (!laneState || typeof laneState !== 'object') return null;
  const bucketCount = normalizePositiveInt(laneState.bucketCount, null);
  if (!bucketCount) return null;
  const cooldownSteps = Math.max(0, Math.floor(Number(laneState.cooldownSteps) || 0));
  const lastAction = laneState.lastAction === 'split' || laneState.lastAction === 'merge'
    ? laneState.lastAction
    : 'hold';
  return {
    bucketCount,
    cooldownSteps,
    lastAction
  };
};

/**
 * Normalize observed adaptive profile entry for one grammar key.
 *
 * @param {unknown} raw
 * @returns {{
 *  rowsPerSec:number|null,
 *  costPerSec:number|null,
 *  tailDurationMs:number|null,
 *  laneState:{bucketCount:number,cooldownSteps:number,lastAction:'split'|'merge'|'hold'}|null
 * }|null}
 */
const normalizeObservedProfileEntry = (raw) => {
  if (!raw || typeof raw !== 'object') {
    const rowsPerSec = normalizePositiveNumber(raw, null);
    if (!rowsPerSec) return null;
    return {
      rowsPerSec,
      costPerSec: null,
      tailDurationMs: null,
      laneState: null
    };
  }

  const normalized = {
    rowsPerSec: normalizePositiveNumber(raw.rowsPerSec, null),
    costPerSec: normalizePositiveNumber(raw.costPerSec, null),
    tailDurationMs: normalizePositiveNumber(raw.tailDurationMs, null),
    laneState: normalizeObservedLaneState(raw.laneState)
  };
  if (
    !normalized.rowsPerSec
    && !normalized.costPerSec
    && !normalized.tailDurationMs
    && !normalized.laneState
  ) {
    return null;
  }
  return normalized;
};

/**
 * Resolve target duration in milliseconds with fallback and integer coercion.
 *
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
const resolveAdaptiveTargetMs = (value, fallback) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
};

/**
 * Build a memoized reader around observed profile rows.
 *
 * This avoids reparsing the same grammar telemetry during bucket and wave
 * planning, which is a hot path for large grammar sets.
 *
 * @param {Map<string, unknown>|null} [observedRowsPerSecByGrammar]
 * @returns {{
 *  resolveRowsPerSec:(grammarKey:string)=>number|null,
 *  resolveCostPerSec:(grammarKey:string)=>number|null,
 *  resolveTailDurationMs:(grammarKey:string)=>number|null,
 *  resolveLaneState:(grammarKey:string)=>{bucketCount:number,cooldownSteps:number,lastAction:'split'|'merge'|'hold'}|null
 * }}
 */
export const createObservedProfileReader = (observedRowsPerSecByGrammar = null) => {
  const canReadProfile = observedRowsPerSecByGrammar instanceof Map;
  const entryCache = new Map();

  /**
   * @param {string} grammarKey
   * @returns {{
   *  rowsPerSec:number|null,
   *  costPerSec:number|null,
   *  tailDurationMs:number|null,
   *  laneState:{bucketCount:number,cooldownSteps:number,lastAction:'split'|'merge'|'hold'}|null
   * }|null}
   */
  const resolveEntry = (grammarKey) => {
    if (!canReadProfile || !grammarKey) return null;
    if (entryCache.has(grammarKey)) return entryCache.get(grammarKey) || null;
    const normalized = normalizeObservedProfileEntry(observedRowsPerSecByGrammar.get(grammarKey));
    entryCache.set(grammarKey, normalized);
    return normalized;
  };

  return {
    resolveRowsPerSec: (grammarKey) => resolveEntry(grammarKey)?.rowsPerSec ?? null,
    resolveCostPerSec: (grammarKey) => resolveEntry(grammarKey)?.costPerSec ?? null,
    resolveTailDurationMs: (grammarKey) => resolveEntry(grammarKey)?.tailDurationMs ?? null,
    resolveLaneState: (grammarKey) => {
      const laneState = resolveEntry(grammarKey)?.laneState;
      if (!laneState) return null;
      return {
        bucketCount: laneState.bucketCount,
        cooldownSteps: laneState.cooldownSteps,
        lastAction: laneState.lastAction
      };
    }
  };
};

/**
 * Resolve profile reader instance from explicit reader or raw observed map.
 *
 * @param {Map<string, unknown>|null} observedRowsPerSecByGrammar
 * @param {ReturnType<typeof createObservedProfileReader>|null} observedProfileReader
 * @returns {ReturnType<typeof createObservedProfileReader>}
 */
const resolveObservedProfileReader = (observedRowsPerSecByGrammar, observedProfileReader) => (
  observedProfileReader || createObservedProfileReader(observedRowsPerSecByGrammar)
);

/**
 * Resolve observed rows/sec for adaptive planner tuning.
 *
 * @param {string} grammarKey
 * @param {Map<string, unknown>|null} observedRowsPerSecByGrammar
 * @param {ReturnType<typeof createObservedProfileReader>|null} [observedProfileReader]
 * @returns {number|null}
 */
export const resolveObservedRowsPerSec = (
  grammarKey,
  observedRowsPerSecByGrammar,
  observedProfileReader = null
) => resolveObservedProfileReader(observedRowsPerSecByGrammar, observedProfileReader)
  .resolveRowsPerSec(grammarKey);

/**
 * Resolve observed parse-cost throughput for adaptive planner tuning.
 *
 * @param {string} grammarKey
 * @param {Map<string, unknown>|null} observedRowsPerSecByGrammar
 * @param {ReturnType<typeof createObservedProfileReader>|null} [observedProfileReader]
 * @returns {number|null}
 */
export const resolveObservedCostPerSec = (
  grammarKey,
  observedRowsPerSecByGrammar,
  observedProfileReader = null
) => resolveObservedProfileReader(observedRowsPerSecByGrammar, observedProfileReader)
  .resolveCostPerSec(grammarKey);

/**
 * Resolve observed tail duration for adaptive lane-splitting heuristics.
 *
 * @param {string} grammarKey
 * @param {Map<string, unknown>|null} observedRowsPerSecByGrammar
 * @param {ReturnType<typeof createObservedProfileReader>|null} [observedProfileReader]
 * @returns {number|null}
 */
export const resolveObservedTailDurationMs = (
  grammarKey,
  observedRowsPerSecByGrammar,
  observedProfileReader = null
) => resolveObservedProfileReader(observedRowsPerSecByGrammar, observedProfileReader)
  .resolveTailDurationMs(grammarKey);

/**
 * Resolve previous lane-state snapshot used for hysteresis/cooldown handling.
 *
 * @param {string} grammarKey
 * @param {Map<string, unknown>|null} observedRowsPerSecByGrammar
 * @param {ReturnType<typeof createObservedProfileReader>|null} [observedProfileReader]
 * @returns {{bucketCount:number,cooldownSteps:number,lastAction:'split'|'merge'|'hold'}|null}
 */
export const resolveObservedLaneState = (
  grammarKey,
  observedRowsPerSecByGrammar,
  observedProfileReader = null
) => resolveObservedProfileReader(observedRowsPerSecByGrammar, observedProfileReader)
  .resolveLaneState(grammarKey);

/**
 * Resolve target jobs per bucket using adaptive profile throughput.
 *
 * @param {{
 *  group?:object,
 *  schedulerConfig?:object,
 *  observedRowsPerSecByGrammar?:Map<string,unknown>|null,
 *  observedProfileReader?:ReturnType<typeof createObservedProfileReader>|null
 * }} input
 * @returns {number}
 */
export const resolveAdaptiveBucketTargetJobs = ({
  group,
  schedulerConfig = {},
  observedRowsPerSecByGrammar = null,
  observedProfileReader = null
}) => {
  const defaultTargetRaw = Number(schedulerConfig.heavyGrammarBucketTargetJobs);
  const defaultTarget = Number.isFinite(defaultTargetRaw)
    ? Math.max(ADAPTIVE_BUCKET_MIN_JOBS, Math.floor(defaultTargetRaw))
    : HEAVY_GRAMMAR_BUCKET_TARGET_JOBS;
  const observedRowsPerSec = resolveObservedRowsPerSec(
    group?.grammarKey,
    observedRowsPerSecByGrammar,
    observedProfileReader
  );
  if (Number.isFinite(observedRowsPerSec) && observedRowsPerSec > 0) {
    const targetMs = resolveAdaptiveTargetMs(
      schedulerConfig.adaptiveBucketTargetMs,
      ADAPTIVE_BUCKET_TARGET_MS
    );
    const projected = Math.floor((observedRowsPerSec * targetMs) / 1000);
    return Math.max(ADAPTIVE_BUCKET_MIN_JOBS, Math.min(ADAPTIVE_BUCKET_MAX_JOBS, projected));
  }
  return Math.max(ADAPTIVE_BUCKET_MIN_JOBS, defaultTarget);
};

/**
 * Resolve target jobs per wave for within-bucket slicing.
 *
 * @param {{
 *  group?:object,
 *  schedulerConfig?:object,
 *  observedRowsPerSecByGrammar?:Map<string,unknown>|null,
 *  observedProfileReader?:ReturnType<typeof createObservedProfileReader>|null
 * }} input
 * @returns {number}
 */
export const resolveAdaptiveWaveTargetJobs = ({
  group,
  schedulerConfig = {},
  observedRowsPerSecByGrammar = null,
  observedProfileReader = null
}) => {
  const observedRowsPerSec = resolveObservedRowsPerSec(
    group?.grammarKey,
    observedRowsPerSecByGrammar,
    observedProfileReader
  );
  if (Number.isFinite(observedRowsPerSec) && observedRowsPerSec > 0) {
    const targetMs = resolveAdaptiveTargetMs(
      schedulerConfig.adaptiveWaveTargetMs,
      ADAPTIVE_WAVE_TARGET_MS
    );
    const projected = Math.floor((observedRowsPerSec * targetMs) / 1000);
    return Math.max(ADAPTIVE_WAVE_MIN_JOBS, Math.min(ADAPTIVE_WAVE_MAX_JOBS, projected));
  }
  const fallback = resolveAdaptiveBucketTargetJobs({
    group,
    schedulerConfig,
    observedRowsPerSecByGrammar,
    observedProfileReader
  });
  return Math.max(ADAPTIVE_WAVE_MIN_JOBS, Math.min(ADAPTIVE_WAVE_MAX_JOBS, fallback));
};

/**
 * Resolve target parse-cost per bucket for adaptive sharding.
 *
 * @param {{
 *  group?:object,
 *  schedulerConfig?:object,
 *  observedRowsPerSecByGrammar?:Map<string,unknown>|null,
 *  observedProfileReader?:ReturnType<typeof createObservedProfileReader>|null
 * }} input
 * @returns {number}
 */
export const resolveAdaptiveBucketTargetCost = ({
  group,
  schedulerConfig = {},
  observedRowsPerSecByGrammar = null,
  observedProfileReader = null
}) => {
  const baselineCostPerJob = normalizePositiveNumber(
    schedulerConfig.estimatedParseCostPerJobBaseline,
    ESTIMATED_COST_BASELINE_PER_JOB
  );
  const observedCostPerSec = resolveObservedCostPerSec(
    group?.grammarKey,
    observedRowsPerSecByGrammar,
    observedProfileReader
  );
  if (Number.isFinite(observedCostPerSec) && observedCostPerSec > 0) {
    const targetMs = resolveAdaptiveTargetMs(
      schedulerConfig.adaptiveBucketTargetMs,
      ADAPTIVE_BUCKET_TARGET_MS
    );
    const projected = Math.floor((observedCostPerSec * targetMs) / 1000);
    return Math.max(
      baselineCostPerJob * ADAPTIVE_BUCKET_MIN_JOBS,
      Math.min(baselineCostPerJob * ADAPTIVE_BUCKET_MAX_JOBS, projected)
    );
  }
  const targetJobs = resolveAdaptiveBucketTargetJobs({
    group,
    schedulerConfig,
    observedRowsPerSecByGrammar,
    observedProfileReader
  });
  return Math.max(
    baselineCostPerJob * ADAPTIVE_BUCKET_MIN_JOBS,
    targetJobs * baselineCostPerJob
  );
};

/**
 * Resolve target parse-cost per wave for adaptive bucketing.
 *
 * @param {{
 *  group?:object,
 *  schedulerConfig?:object,
 *  observedRowsPerSecByGrammar?:Map<string,unknown>|null,
 *  observedProfileReader?:ReturnType<typeof createObservedProfileReader>|null
 * }} input
 * @returns {number}
 */
export const resolveAdaptiveWaveTargetCost = ({
  group,
  schedulerConfig = {},
  observedRowsPerSecByGrammar = null,
  observedProfileReader = null
}) => {
  const baselineCostPerJob = normalizePositiveNumber(
    schedulerConfig.estimatedParseCostPerJobBaseline,
    ESTIMATED_COST_BASELINE_PER_JOB
  );
  const observedCostPerSec = resolveObservedCostPerSec(
    group?.grammarKey,
    observedRowsPerSecByGrammar,
    observedProfileReader
  );
  if (Number.isFinite(observedCostPerSec) && observedCostPerSec > 0) {
    const targetMs = resolveAdaptiveTargetMs(
      schedulerConfig.adaptiveWaveTargetMs,
      ADAPTIVE_WAVE_TARGET_MS
    );
    const projected = Math.floor((observedCostPerSec * targetMs) / 1000);
    return Math.max(
      baselineCostPerJob * ADAPTIVE_WAVE_MIN_JOBS,
      Math.min(baselineCostPerJob * ADAPTIVE_WAVE_MAX_JOBS, projected)
    );
  }
  const targetJobs = resolveAdaptiveWaveTargetJobs({
    group,
    schedulerConfig,
    observedRowsPerSecByGrammar,
    observedProfileReader
  });
  return Math.max(
    baselineCostPerJob * ADAPTIVE_WAVE_MIN_JOBS,
    targetJobs * baselineCostPerJob
  );
};

/**
 * Apply hysteresis/cooldown guardrails to lane split/merge transitions.
 *
 * @param {{
 *  desiredBucketCount:number,
 *  minBuckets:number,
 *  maxBuckets:number,
 *  laneState?:{bucketCount?:number,cooldownSteps?:number,lastAction?:string}|null,
 *  guardrails:{maxStepUp:number,maxStepDown:number,splitHysteresisRatio:number,mergeHysteresisRatio:number},
 *  hasSplitPressure?:boolean,
 *  hasMergePressure?:boolean
 * }} input
 * @returns {number}
 */
export const applyBucketCountGuardrails = ({
  desiredBucketCount,
  minBuckets,
  maxBuckets,
  laneState,
  guardrails,
  hasSplitPressure = false,
  hasMergePressure = false
}) => {
  let resolved = Math.max(minBuckets, Math.min(maxBuckets, Math.floor(desiredBucketCount || 1)));
  const priorBucketCount = normalizePositiveInt(laneState?.bucketCount, null);
  if (!priorBucketCount) return resolved;
  if (resolved > priorBucketCount) {
    const delta = resolved - priorBucketCount;
    resolved = priorBucketCount + Math.min(guardrails.maxStepUp, delta);
    const ratio = resolved / Math.max(1, priorBucketCount);
    if (ratio < guardrails.splitHysteresisRatio && !hasSplitPressure) {
      resolved = priorBucketCount;
    }
    if (laneState?.cooldownSteps > 0 && laneState?.lastAction === 'merge' && !hasSplitPressure) {
      resolved = priorBucketCount;
    }
  } else if (resolved < priorBucketCount) {
    const delta = priorBucketCount - resolved;
    resolved = priorBucketCount - Math.min(guardrails.maxStepDown, delta);
    const ratio = resolved / Math.max(1, priorBucketCount);
    if (ratio > guardrails.mergeHysteresisRatio && !hasMergePressure) {
      resolved = priorBucketCount;
    }
    if (laneState?.cooldownSteps > 0 && laneState?.lastAction === 'split' && !hasMergePressure) {
      resolved = priorBucketCount;
    }
  }
  return Math.max(minBuckets, Math.min(maxBuckets, resolved));
};
