import { createTimeoutError, runWithTimeout } from '../../../../../shared/promise-timeout.js';
import {
  coerceClampedFraction,
  coerceNonNegativeInt,
  coercePositiveInt
} from '../../../../../shared/number-coerce.js';
import { normalizeOwnershipSegment } from './ordering.js';

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
const FILE_PROGRESS_HEARTBEAT_DEFAULT_MS = 30000;
const FILE_STALL_SNAPSHOT_DEFAULT_MS = 30000;
const FILE_STALL_ABORT_DEFAULT_MS = 10 * 60 * 1000;
const FILE_STALL_ABORT_MIN_MS = 60 * 1000;
const FILE_STALL_ABORT_CONFIG_MIN_MS = 1000;
const FILE_STALL_SOFT_KICK_DEFAULT_MS = 2 * 60 * 1000;
const FILE_STALL_SOFT_KICK_MIN_MS = 1000;
const FILE_STALL_SOFT_KICK_COOLDOWN_DEFAULT_MS = 30 * 1000;
const FILE_STALL_SOFT_KICK_MAX_ATTEMPTS_DEFAULT = 2;
export const STAGE_TIMING_SCHEMA_VERSION = 1;
export const FILE_QUEUE_DELAY_HISTOGRAM_BUCKETS_MS = Object.freeze([50, 100, 250, 500, 1000, 2000, 5000, 10000, 30000, 60000]);

/**
 * Coerce optional numeric input to non-negative integer while preserving nullish values.
 *
 * @param {unknown} value
 * @returns {number|null}
 */
const coerceOptionalNonNegativeInt = (value) => {
  if (value === null || value === undefined) return null;
  return coerceNonNegativeInt(value);
};
/**
 * Parse a fractional config value and clamp via bounds; fall back when invalid.
 *
 * @param {unknown} value
 * @param {number} fallback
 * @param {{min?:number,max?:number,allowZero?:boolean}} [options]
 * @returns {number}
 */
const coerceClampedFractionOrDefault = (value, fallback, { min = 0, max = 1, allowZero = false } = {}) => {
  const parsed = coerceClampedFraction(value, { min, max, allowZero });
  return parsed == null ? fallback : parsed;
};
/**
 * Normalize a duration input to a finite non-negative number of milliseconds.
 *
 * @param {unknown} value
 * @returns {number}
 */
export const clampDurationMs = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
};

/**
 * Convert epoch milliseconds to ISO timestamp when the input is valid.
 *
 * @param {unknown} value
 * @returns {string|null}
 */
export const toIsoTimestamp = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? new Date(parsed).toISOString() : null;
};

/**
 * Resolve per-file watchdog thresholds for stage1 processing.
 *
 * This merges queue watchdog config with adaptive defaults and optional
 * repo-size floors so large repositories can avoid noisy slow-file warnings.
 *
 * @param {object} runtime
 * @param {{repoFileCount?:number}} [input]
 * @returns {{
 *   slowFileMs:number,
 *   maxSlowFileMs:number,
 *   hardTimeoutMs:number,
 *   bytesPerStep:number,
 *   linesPerStep:number,
 *   stepMs:number,
 *   nearThresholdLowerFraction:number,
 *   nearThresholdUpperFraction:number,
 *   nearThresholdAlertFraction:number,
 *   nearThresholdMinSamples:number,
 *   adaptiveSlowFloorMs:number
 * }}
 */
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

/**
 * Resolve soft slow-file timeout budget for one entry.
 *
 * Timeout scales by byte/line steps and is capped at the configured
 * `maxSlowFileMs` ceiling.
 *
 * @param {object} watchdogConfig
 * @param {object} entry
 * @returns {number}
 */
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

/**
 * Resolve a hard timeout for a single file, scaled by file size and line count.
 *
 * Hard timeout is capped globally and always kept at or above both the base
 * hard timeout and a soft-timeout-derived floor when provided.
 *
 * @param {object} watchdogConfig
 * @param {object} entry
 * @param {number} [softTimeoutMs=0]
 * @returns {number}
 */
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

/**
 * Resolve cleanup timeout for stage1 subprocess teardown.
 *
 * A configured value of `0` explicitly disables timeout enforcement.
 *
 * @param {object} runtime
 * @returns {number}
 */
export const resolveProcessCleanupTimeoutMs = (runtime) => {
  const config = runtime?.stage1Queues?.watchdog || {};
  const configured = coerceOptionalNonNegativeInt(config.cleanupTimeoutMs);
  if (configured === 0) return 0;
  return configured ?? FILE_PROCESS_CLEANUP_TIMEOUT_DEFAULT_MS;
};

/**
 * Resolve the stage1 stall-abort threshold from config and watchdog defaults.
 *
 * @param {object} runtime
 * @param {object|null} [watchdogConfig=null]
 * @returns {number}
 */
export const resolveStage1StallAbortTimeoutMs = (runtime, watchdogConfig = null) => {
  const config = runtime?.stage1Queues?.watchdog || {};
  const configured = coerceOptionalNonNegativeInt(
    config.stallAbortMs ?? config.stallTimeoutMs
  );
  if (configured === 0) return 0;
  if (configured != null) return Math.max(FILE_STALL_ABORT_MIN_MS, configured);
  const hardTimeoutMs = Number(watchdogConfig?.hardTimeoutMs);
  if (Number.isFinite(hardTimeoutMs) && hardTimeoutMs > 0) {
    return Math.max(FILE_STALL_ABORT_MIN_MS, Math.floor(hardTimeoutMs * 2));
  }
  return FILE_STALL_ABORT_DEFAULT_MS;
};

/**
 * Return the first non-null parsed non-negative integer from a value list.
 *
 * @param {...unknown} values
 * @returns {number|null}
 */
const resolveOptionalNonNegativeIntFromValues = (...values) => {
  for (const value of values) {
    const parsed = coerceOptionalNonNegativeInt(value);
    if (parsed != null) return parsed;
  }
  return null;
};

/**
 * Collect stage1 watchdog config from all supported config surfaces.
 *
 * @param {object} runtime
 * @returns {{indexingStage1:object,rawWatchdog:object,processingWatchdog:object,queueWatchdog:object}}
 */
const resolveStage1WatchdogSourceConfig = (runtime) => {
  const indexingStage1 = runtime?.indexingConfig?.stage1 && typeof runtime.indexingConfig.stage1 === 'object'
    ? runtime.indexingConfig.stage1
    : {};
  const rawWatchdog = indexingStage1?.watchdog && typeof indexingStage1.watchdog === 'object'
    ? indexingStage1.watchdog
    : {};
  const processingWatchdog = rawWatchdog?.stages?.processing && typeof rawWatchdog.stages.processing === 'object'
    ? rawWatchdog.stages.processing
    : {};
  const queueWatchdog = runtime?.stage1Queues?.watchdog && typeof runtime.stage1Queues.watchdog === 'object'
    ? runtime.stage1Queues.watchdog
    : {};
  return {
    indexingStage1,
    rawWatchdog,
    processingWatchdog,
    queueWatchdog
  };
};

/**
 * Resolve soft-kick stall timeout, optionally deriving it from hard abort budget.
 *
 * @param {{configuredSoftKickMs?:number|null,stallAbortMs?:number}} [options]
 * @returns {number}
 */
export const resolveStage1StallSoftKickTimeoutMs = ({
  configuredSoftKickMs = null,
  stallAbortMs = 0
} = {}) => {
  if (configuredSoftKickMs === 0) return 0;
  const normalizedAbortMs = Number(stallAbortMs);
  const hasAbortThreshold = Number.isFinite(normalizedAbortMs) && normalizedAbortMs > 0;
  const configured = coerceOptionalNonNegativeInt(configuredSoftKickMs);
  let candidateMs = configured != null
    ? Math.max(FILE_STALL_SOFT_KICK_MIN_MS, configured)
    : (hasAbortThreshold
      ? Math.max(FILE_STALL_SOFT_KICK_MIN_MS, Math.floor(normalizedAbortMs * 0.5))
      : FILE_STALL_SOFT_KICK_DEFAULT_MS);
  if (hasAbortThreshold) {
    const maxAllowedMs = Math.max(1, Math.floor(normalizedAbortMs) - 1000);
    candidateMs = Math.min(candidateMs, maxAllowedMs);
  }
  return Math.max(0, Math.floor(candidateMs));
};

/**
 * Resolve deterministic stage-1 hang watchdog timers from layered config.
 *
 * Precedence is highest-to-lowest within each field:
 * `indexingConfig.stage1.watchdog.stages.processing` ->
 * `indexingConfig.stage1.watchdog` ->
 * `indexingConfig.stage1` ->
 * `stage1Queues.watchdog` ->
 * hardcoded defaults in this module.
 *
 * All values are milliseconds. A value of `0` explicitly disables the
 * corresponding timeout/soft-kick behavior where supported.
 *
 * @param {object} runtime
 * @param {object|null} watchdogConfig
 * @returns {{
 *   progressHeartbeatMs:number,
 *   stallSnapshotMs:number,
 *   stallAbortMs:number,
 *   stallSoftKickMs:number,
 *   stallSoftKickCooldownMs:number,
 *   stallSoftKickMaxAttempts:number
 * }}
 */
export const resolveStage1HangPolicy = (runtime, watchdogConfig = null) => {
  const {
    indexingStage1,
    rawWatchdog,
    processingWatchdog,
    queueWatchdog
  } = resolveStage1WatchdogSourceConfig(runtime);

  const progressHeartbeatMs = resolveOptionalNonNegativeIntFromValues(
    processingWatchdog.progressHeartbeatMs,
    processingWatchdog.heartbeatMs,
    rawWatchdog.progressHeartbeatMs,
    rawWatchdog.heartbeatMs,
    rawWatchdog.processingHeartbeatMs,
    indexingStage1.progressHeartbeatMs,
    queueWatchdog.progressHeartbeatMs
  ) ?? FILE_PROGRESS_HEARTBEAT_DEFAULT_MS;

  const stallSnapshotMs = resolveOptionalNonNegativeIntFromValues(
    processingWatchdog.stallSnapshotMs,
    processingWatchdog.snapshotMs,
    rawWatchdog.stallSnapshotMs,
    rawWatchdog.snapshotMs,
    rawWatchdog.processingSnapshotMs,
    indexingStage1.stallSnapshotMs,
    queueWatchdog.stallSnapshotMs
  ) ?? FILE_STALL_SNAPSHOT_DEFAULT_MS;

  const configuredStallAbortMs = resolveOptionalNonNegativeIntFromValues(
    processingWatchdog.stallAbortMs,
    processingWatchdog.stallTimeoutMs,
    processingWatchdog.stuckThresholdMs,
    rawWatchdog.stallAbortMs,
    rawWatchdog.stallTimeoutMs,
    rawWatchdog.stuckThresholdMs,
    indexingStage1.stallAbortMs,
    queueWatchdog.stallAbortMs,
    queueWatchdog.stallTimeoutMs
  );
  const stallAbortMs = configuredStallAbortMs === 0
    ? 0
    : (configuredStallAbortMs != null
      ? Math.max(FILE_STALL_ABORT_CONFIG_MIN_MS, configuredStallAbortMs)
      : resolveStage1StallAbortTimeoutMs(runtime, watchdogConfig));

  const configuredSoftKickMs = resolveOptionalNonNegativeIntFromValues(
    processingWatchdog.stallSoftKickMs,
    processingWatchdog.softKickMs,
    processingWatchdog.stuckSoftKickMs,
    rawWatchdog.stallSoftKickMs,
    rawWatchdog.softKickMs,
    rawWatchdog.stuckSoftKickMs,
    indexingStage1.stallSoftKickMs
  );
  const stallSoftKickMs = resolveStage1StallSoftKickTimeoutMs({
    configuredSoftKickMs,
    stallAbortMs
  });

  const stallSoftKickCooldownMs = resolveOptionalNonNegativeIntFromValues(
    processingWatchdog.softKickCooldownMs,
    rawWatchdog.softKickCooldownMs,
    indexingStage1.softKickCooldownMs
  ) ?? FILE_STALL_SOFT_KICK_COOLDOWN_DEFAULT_MS;

  const configuredSoftKickMaxAttempts = resolveOptionalNonNegativeIntFromValues(
    processingWatchdog.softKickMaxAttempts,
    rawWatchdog.softKickMaxAttempts,
    indexingStage1.softKickMaxAttempts
  );
  const stallSoftKickMaxAttempts = configuredSoftKickMaxAttempts == null
    ? FILE_STALL_SOFT_KICK_MAX_ATTEMPTS_DEFAULT
    : Math.max(0, Math.floor(configuredSoftKickMaxAttempts));

  return {
    progressHeartbeatMs,
    stallSnapshotMs,
    stallAbortMs,
    stallSoftKickMs,
    stallSoftKickCooldownMs,
    stallSoftKickMaxAttempts
  };
};

/**
 * Decide whether stage1 should continue, issue a soft-kick, or abort based on
 * current idle duration and hang-policy thresholds.
 *
 * @param {{
 *   idleMs?:number,
 *   hardAbortMs?:number,
 *   softKickMs?:number,
 *   softKickAttempts?:number,
 *   softKickMaxAttempts?:number,
 *   softKickInFlight?:boolean,
 *   lastSoftKickAtMs?:number,
 *   softKickCooldownMs?:number,
 *   nowMs?:number
 * }} [input]
 * @returns {{action:'none'|'soft-kick'|'abort',idleMs:number,reason?:string}}
 */
export const resolveStage1StallAction = ({
  idleMs = 0,
  hardAbortMs = 0,
  softKickMs = 0,
  softKickAttempts = 0,
  softKickMaxAttempts = 0,
  softKickInFlight = false,
  lastSoftKickAtMs = 0,
  softKickCooldownMs = 0,
  nowMs = Date.now()
} = {}) => {
  const safeIdleMs = clampDurationMs(idleMs);
  const hardThresholdMs = Number(hardAbortMs);
  if (Number.isFinite(hardThresholdMs) && hardThresholdMs > 0 && safeIdleMs >= hardThresholdMs) {
    return { action: 'abort', idleMs: safeIdleMs };
  }
  const softThresholdMs = Number(softKickMs);
  const maxAttempts = Math.max(0, Math.floor(Number(softKickMaxAttempts) || 0));
  if (!Number.isFinite(softThresholdMs) || softThresholdMs <= 0 || maxAttempts <= 0) {
    return { action: 'none', idleMs: safeIdleMs, reason: 'soft_kick_disabled' };
  }
  if (softKickInFlight) {
    return { action: 'none', idleMs: safeIdleMs, reason: 'soft_kick_in_flight' };
  }
  const attempts = Math.max(0, Math.floor(Number(softKickAttempts) || 0));
  if (attempts >= maxAttempts) {
    return { action: 'none', idleMs: safeIdleMs, reason: 'soft_kick_attempts_exhausted' };
  }
  if (safeIdleMs < softThresholdMs) {
    return { action: 'none', idleMs: safeIdleMs, reason: 'below_soft_kick_threshold' };
  }
  const safeNowMs = Number.isFinite(Number(nowMs)) ? Number(nowMs) : Date.now();
  const safeLastSoftKickAtMs = Number.isFinite(Number(lastSoftKickAtMs))
    ? Number(lastSoftKickAtMs)
    : 0;
  const cooldownMs = Math.max(0, Math.floor(Number(softKickCooldownMs) || 0));
  if (cooldownMs > 0 && safeLastSoftKickAtMs > 0 && safeNowMs - safeLastSoftKickAtMs < cooldownMs) {
    return { action: 'none', idleMs: safeIdleMs, reason: 'soft_kick_cooldown' };
  }
  return { action: 'soft-kick', idleMs: safeIdleMs };
};

/**
 * Build deterministic subprocess-ownership id prefix for stage1 file workers.
 *
 * @param {object} runtime
 * @param {string} [mode='unknown']
 * @returns {string}
 */
export const resolveStage1FileSubprocessOwnershipPrefix = (runtime, mode = 'unknown') => {
  const configuredPrefix = typeof runtime?.subprocessOwnership?.stage1FilePrefix === 'string'
    ? runtime.subprocessOwnership.stage1FilePrefix.trim()
    : '';
  if (configuredPrefix) {
    return `${configuredPrefix}:${normalizeOwnershipSegment(mode, 'mode')}`;
  }
  const fallbackBuildId = normalizeOwnershipSegment(runtime?.buildId, 'build');
  return `stage1:${fallbackBuildId}:${normalizeOwnershipSegment(mode, 'mode')}`;
};

/**
 * Build deterministic ownership id for per-file stage1 subprocesses.
 *
 * @param {{
 *  runtime:object,
 *  mode?:string,
 *  fileIndex?:number|null,
 *  rel?:string,
 *  shardId?:string|number|null
 * }} [input]
 * @returns {string}
 */
export const buildStage1FileSubprocessOwnershipId = ({
  runtime,
  mode = 'unknown',
  fileIndex = null,
  rel = '',
  shardId = null
} = {}) => {
  const prefix = resolveStage1FileSubprocessOwnershipPrefix(runtime, mode);
  const normalizedFileIndex = Number.isFinite(Number(fileIndex))
    ? Math.max(0, Math.floor(Number(fileIndex)))
    : 'na';
  const normalizedRel = normalizeOwnershipSegment(rel, 'unknown_file');
  const normalizedShardId = normalizeOwnershipSegment(String(shardId || 'none'), 'none');
  return `${prefix}:shard:${normalizedShardId}:file:${normalizedFileIndex}:${normalizedRel}`;
};

/**
 * Render watchdog heartbeat progress text for stage1 processing loop.
 *
 * @param {{
 *  count?:number,
 *  total?:number,
 *  startedAtMs?:number,
 *  nowMs?:number,
 *  inFlight?:number,
 *  trackedSubprocesses?:number
 * }} [input]
 * @returns {string}
 */
export const buildFileProgressHeartbeatText = ({
  count = 0,
  total = 0,
  startedAtMs = Date.now(),
  nowMs = Date.now(),
  inFlight = 0,
  trackedSubprocesses = 0
} = {}) => {
  const safeTotal = Number.isFinite(Number(total)) ? Math.max(0, Math.floor(Number(total))) : 0;
  const safeCount = Number.isFinite(Number(count))
    ? Math.max(0, Math.min(safeTotal || Number.MAX_SAFE_INTEGER, Math.floor(Number(count))))
    : 0;
  const safeNowMs = Number.isFinite(Number(nowMs)) ? Number(nowMs) : Date.now();
  const safeStartedAtMs = Number.isFinite(Number(startedAtMs)) ? Number(startedAtMs) : safeNowMs;
  const elapsedMs = Math.max(1, safeNowMs - safeStartedAtMs);
  const elapsedSec = Math.floor(elapsedMs / 1000);
  const ratePerSec = safeCount > 0 ? (safeCount / (elapsedMs / 1000)) : 0;
  const remaining = safeTotal > safeCount ? (safeTotal - safeCount) : 0;
  const etaSec = ratePerSec > 0 ? Math.ceil(remaining / ratePerSec) : null;
  const percent = safeTotal > 0
    ? ((safeCount / safeTotal) * 100).toFixed(1)
    : '0.0';
  const etaText = Number.isFinite(etaSec) ? `${etaSec}s` : 'n/a';
  const safeInFlight = Number.isFinite(Number(inFlight)) ? Math.max(0, Math.floor(Number(inFlight))) : 0;
  const safeTracked = Number.isFinite(Number(trackedSubprocesses))
    ? Math.max(0, Math.floor(Number(trackedSubprocesses)))
    : 0;
  return (
    `[watchdog] progress ${safeCount}/${safeTotal} (${percent}%) `
    + `elapsed=${elapsedSec}s rate=${ratePerSec.toFixed(2)} files/s eta=${etaText} `
    + `inFlight=${safeInFlight} trackedSubprocesses=${safeTracked}`
  );
};

/**
 * Run async cleanup with optional timeout/telemetry handling.
 *
 * Returns timing and timeout metadata regardless of cleanup outcome. Timeout
 * callbacks are best-effort and do not suppress original timeout errors.
 *
 * @param {{
 *  label:string,
 *  cleanup:Function,
 *  timeoutMs?:number,
 *  log?:(message:string,meta?:object)=>void,
 *  logMeta?:object|null,
 *  onTimeout?:Function|null
 * }} input
 * @returns {Promise<{skipped:boolean,timedOut:boolean,elapsedMs:number,error?:unknown}>}
 */
export const runCleanupWithTimeout = async ({
  label,
  cleanup,
  timeoutMs = FILE_PROCESS_CLEANUP_TIMEOUT_DEFAULT_MS,
  log = null,
  logMeta = null,
  onTimeout = null
}) => {
  if (typeof cleanup !== 'function') return { skipped: true, timedOut: false, elapsedMs: 0 };
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    const startAtMs = Date.now();
    await cleanup();
    return { skipped: false, timedOut: false, elapsedMs: Date.now() - startAtMs };
  }
  const startedAtMs = Date.now();
  try {
    await runWithTimeout(
      () => cleanup(),
      {
        timeoutMs,
        errorFactory: () => createTimeoutError({
          message: `[cleanup] ${label || 'cleanup'} timed out after ${timeoutMs}ms`,
          code: 'PROCESS_CLEANUP_TIMEOUT',
          retryable: false,
          meta: {
            label: label || 'cleanup',
            timeoutMs
          }
        })
      }
    );
    return { skipped: false, timedOut: false, elapsedMs: Date.now() - startedAtMs };
  } catch (err) {
    if (err?.code !== 'PROCESS_CLEANUP_TIMEOUT') throw err;
    const elapsedMs = Date.now() - startedAtMs;
    if (typeof log === 'function') {
      log(
        `[cleanup] ${label || 'cleanup'} timed out after ${timeoutMs}ms; continuing.`,
        {
          kind: 'warning',
          ...(logMeta && typeof logMeta === 'object' ? logMeta : {}),
          cleanupLabel: label || 'cleanup',
          timeoutMs,
          elapsedMs
        }
      );
    }
    if (typeof onTimeout === 'function') {
      try {
        await onTimeout(err);
      } catch {}
    }
    return { skipped: false, timedOut: true, elapsedMs, error: err };
  }
};
