import { coerceNonNegativeInt, coercePositiveInt } from '../../../../../shared/number-coerce.js';
import {
  buildWatchdogNearThresholdSummary as buildWatchdogNearThresholdSummaryShared,
  createDurationHistogram as createDurationHistogramShared,
  isNearThresholdSlowFileDuration as isNearThresholdSlowFileDurationShared,
  resolveFileLifecycleDurations as resolveFileLifecycleDurationsShared,
  resolveStageTimingSizeBin as resolveStageTimingSizeBinShared,
  shouldTriggerSlowFileWarning as shouldTriggerSlowFileWarningShared
} from './watchdog.js';

const FILE_WATCHDOG_DEFAULT_MS = 10000;
const FILE_WATCHDOG_DEFAULT_MAX_MS = 120000;
const FILE_WATCHDOG_HUGE_REPO_FILE_MIN = 3000;
const FILE_WATCHDOG_HUGE_REPO_BASE_MS = 20000;
const FILE_WATCHDOG_DEFAULT_BYTES_PER_STEP = 256 * 1024;
const FILE_WATCHDOG_DEFAULT_LINES_PER_STEP = 2000;
const FILE_WATCHDOG_DEFAULT_STEP_MS = 1000;
const FILE_WATCHDOG_NEAR_THRESHOLD_LOWER_FRACTION = 0.85;
const FILE_WATCHDOG_NEAR_THRESHOLD_UPPER_FRACTION = 1;
const FILE_WATCHDOG_NEAR_THRESHOLD_ALERT_FRACTION = 0.6;
const FILE_WATCHDOG_NEAR_THRESHOLD_MIN_SAMPLES = 20;
const FILE_HARD_TIMEOUT_DEFAULT_MS = 300000;
const FILE_HARD_TIMEOUT_MAX_MS = 1800000;
const FILE_HARD_TIMEOUT_SLOW_MULTIPLIER = 3;
const FILE_PROCESS_CLEANUP_TIMEOUT_DEFAULT_MS = 30000;

const coerceOptionalNonNegativeInt = (value) => {
  if (value === null || value === undefined) return null;
  return coerceNonNegativeInt(value);
};

const coerceClampedFractionOrDefault = (value, fallback, { min = 0, max = 1, allowZero = false } = {}) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  if ((!allowZero && parsed <= 0) || parsed < min || parsed > max) return fallback;
  return parsed;
};

const clampDurationMs = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
};

const resolveOptionalNonNegativeIntFromValues = (...values) => {
  for (const value of values) {
    const parsed = coerceOptionalNonNegativeInt(value);
    if (parsed != null) return parsed;
  }
  return null;
};

export const resolveStageTimingSizeBin = resolveStageTimingSizeBinShared;
export const createDurationHistogram = createDurationHistogramShared;

export const resolveEffectiveSlowFileDurationMs = ({
  activeDurationMs = 0,
  scmProcQueueWaitMs = 0
} = {}) => Math.max(0, clampDurationMs(activeDurationMs) - clampDurationMs(scmProcQueueWaitMs));

export const resolveFileLifecycleDurations = (lifecycle = {}) => {
  const base = resolveFileLifecycleDurationsShared(lifecycle);
  const scmProcQueueWaitMs = clampDurationMs(lifecycle?.scmProcQueueWaitMs);
  return {
    ...base,
    scmProcQueueWaitMs,
    activeProcessingDurationMs: resolveEffectiveSlowFileDurationMs({
      activeDurationMs: base.activeDurationMs,
      scmProcQueueWaitMs
    })
  };
};

export const shouldTriggerSlowFileWarning = ({
  activeDurationMs,
  thresholdMs,
  scmProcQueueWaitMs = 0
}) => shouldTriggerSlowFileWarningShared({
  activeDurationMs: resolveEffectiveSlowFileDurationMs({
    activeDurationMs,
    scmProcQueueWaitMs
  }),
  thresholdMs
});

export const isNearThresholdSlowFileDuration = isNearThresholdSlowFileDurationShared;
export const buildWatchdogNearThresholdSummary = buildWatchdogNearThresholdSummaryShared;

export const resolveFileWatchdogConfig = (runtime, { repoFileCount = 0 } = {}) => {
  const config = runtime?.stage1Queues?.watchdog || {};
  const configuredSlowFileMs = coerceOptionalNonNegativeInt(config.slowFileMs);
  const hasExplicitSlowFileMs = configuredSlowFileMs != null;
  const normalizedRepoFileCount = Number.isFinite(Number(repoFileCount))
    ? Math.max(0, Math.floor(Number(repoFileCount)))
    : 0;
  const adaptiveSlowFloorMs = !hasExplicitSlowFileMs && normalizedRepoFileCount >= FILE_WATCHDOG_HUGE_REPO_FILE_MIN
    ? FILE_WATCHDOG_HUGE_REPO_BASE_MS
    : 0;
  const slowFileMs = Math.max(
    configuredSlowFileMs ?? FILE_WATCHDOG_DEFAULT_MS,
    adaptiveSlowFloorMs
  );
  const maxSlowFileMs = coerceOptionalNonNegativeInt(config.maxSlowFileMs)
    ?? Math.max(FILE_WATCHDOG_DEFAULT_MAX_MS, slowFileMs);
  const bytesPerStep = coercePositiveInt(config.bytesPerStep) ?? FILE_WATCHDOG_DEFAULT_BYTES_PER_STEP;
  const linesPerStep = coercePositiveInt(config.linesPerStep) ?? FILE_WATCHDOG_DEFAULT_LINES_PER_STEP;
  const stepMs = coercePositiveInt(config.stepMs) ?? FILE_WATCHDOG_DEFAULT_STEP_MS;
  const nearThresholdLowerFraction = coerceClampedFractionOrDefault(
    config.nearThresholdLowerFraction,
    FILE_WATCHDOG_NEAR_THRESHOLD_LOWER_FRACTION,
    { min: 0, max: 1, allowZero: false }
  );
  const nearThresholdUpperFraction = Math.max(
    nearThresholdLowerFraction,
    coerceClampedFractionOrDefault(
      config.nearThresholdUpperFraction,
      FILE_WATCHDOG_NEAR_THRESHOLD_UPPER_FRACTION,
      { min: 0, max: 1, allowZero: false }
    )
  );
  const nearThresholdAlertFraction = coerceClampedFractionOrDefault(
    config.nearThresholdAlertFraction,
    FILE_WATCHDOG_NEAR_THRESHOLD_ALERT_FRACTION,
    { min: 0, max: 1, allowZero: false }
  );
  const nearThresholdMinSamples = Math.max(
    1,
    Math.floor(
      Number(config.nearThresholdMinSamples)
      || FILE_WATCHDOG_NEAR_THRESHOLD_MIN_SAMPLES
    )
  );
  const hardTimeoutMs = coerceOptionalNonNegativeInt(config.hardTimeoutMs)
    ?? Math.max(FILE_HARD_TIMEOUT_DEFAULT_MS, maxSlowFileMs * FILE_HARD_TIMEOUT_SLOW_MULTIPLIER);
  return {
    slowFileMs: Math.max(0, slowFileMs),
    maxSlowFileMs: Math.max(0, maxSlowFileMs),
    hardTimeoutMs: Math.max(0, hardTimeoutMs),
    bytesPerStep,
    linesPerStep,
    stepMs,
    nearThresholdLowerFraction,
    nearThresholdUpperFraction,
    nearThresholdAlertFraction,
    nearThresholdMinSamples,
    adaptiveSlowFloorMs
  };
};

export const resolveFileWatchdogMs = (watchdogConfig, entry) => {
  if (!watchdogConfig || watchdogConfig.slowFileMs <= 0) return 0;
  const fileBytes = coerceNonNegativeInt(entry?.stat?.size) ?? 0;
  const fileLines = coerceNonNegativeInt(entry?.lines) ?? 0;
  const byteSteps = Math.floor(fileBytes / watchdogConfig.bytesPerStep);
  const lineSteps = Math.floor(fileLines / watchdogConfig.linesPerStep);
  const extraSteps = Math.max(byteSteps, lineSteps);
  const timeoutMs = watchdogConfig.slowFileMs + (extraSteps * watchdogConfig.stepMs);
  return Math.min(watchdogConfig.maxSlowFileMs, timeoutMs);
};

export const resolveFileHardTimeoutMs = (watchdogConfig, entry, softTimeoutMs = 0) => {
  if (!watchdogConfig || watchdogConfig.hardTimeoutMs <= 0) return 0;
  const fileBytes = coerceNonNegativeInt(entry?.stat?.size) ?? 0;
  const fileLines = coerceNonNegativeInt(entry?.lines) ?? 0;
  const byteSteps = Math.floor(fileBytes / Math.max(1, watchdogConfig.bytesPerStep || FILE_WATCHDOG_DEFAULT_BYTES_PER_STEP));
  const lineSteps = Math.floor(fileLines / Math.max(1, watchdogConfig.linesPerStep || FILE_WATCHDOG_DEFAULT_LINES_PER_STEP));
  const sizeSteps = Math.max(byteSteps, lineSteps);
  const sizeScaledTimeout = watchdogConfig.hardTimeoutMs + (sizeSteps * Math.max(1, watchdogConfig.stepMs || FILE_WATCHDOG_DEFAULT_STEP_MS));
  const softScaledTimeout = Number.isFinite(softTimeoutMs) && softTimeoutMs > 0
    ? Math.ceil(softTimeoutMs * 2)
    : 0;
  return Math.min(FILE_HARD_TIMEOUT_MAX_MS, Math.max(watchdogConfig.hardTimeoutMs, sizeScaledTimeout, softScaledTimeout));
};

export const resolveProcessCleanupTimeoutMs = (runtime) => {
  const configured = resolveOptionalNonNegativeIntFromValues(
    runtime?.stage1Queues?.watchdog?.cleanupTimeoutMs,
    runtime?.indexingConfig?.stage1?.watchdog?.cleanupTimeoutMs
  );
  if (configured === 0) return 0;
  return configured ?? FILE_PROCESS_CLEANUP_TIMEOUT_DEFAULT_MS;
};
