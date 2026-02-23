import path from 'node:path';
import { runWithQueue } from '../../../../shared/concurrency.js';
import { getEnvConfig } from '../../../../shared/env.js';
import { fileExt, toPosix } from '../../../../shared/files.js';
import { countLinesForEntries } from '../../../../shared/file-stats.js';
import { log, logLine, showProgress } from '../../../../shared/progress.js';
import { createTimeoutError, runWithTimeout } from '../../../../shared/promise-timeout.js';
import { coerceNonNegativeInt, coercePositiveInt } from '../../../../shared/number-coerce.js';
import { throwIfAborted } from '../../../../shared/abort.js';
import { compareStrings } from '../../../../shared/sort.js';
import {
  captureProcessSnapshot,
  snapshotTrackedSubprocesses,
  terminateTrackedSubprocesses,
  withTrackedSubprocessSignalScope
} from '../../../../shared/subprocess.js';
import { createBuildCheckpoint } from '../../build-state.js';
import { createFileProcessor } from '../../file-processor.js';
import { getLanguageForFile } from '../../../language-registry.js';
import { runTreeSitterScheduler } from '../../tree-sitter-scheduler/runner.js';
import { createHeavyFilePerfAggregator, createPerfEventLogger } from '../../perf-event-log.js';
import { loadStructuralMatches } from '../../../structural.js';
import { planShardBatches, planShards } from '../../shards.js';
import { recordFileMetric } from '../../perf-profile.js';
import { createVfsManifestCollector } from '../../vfs-manifest-collector.js';
import { createTokenRetentionState } from './postings.js';
import { createPostingsQueue, estimatePostingsPayload } from './process-files/postings-queue.js';
import { buildOrderedAppender } from './process-files/ordered.js';
import { createShardRuntime, resolveCheckpointBatchSize } from './process-files/runtime.js';
import {
  buildDeterministicShardMergePlan,
  normalizeOwnershipSegment,
  resolveClusterSubsetRetryConfig,
  resolveEntryOrderIndex,
  resolveShardSubsetId,
  resolveShardSubsetMinOrderIndex,
  resolveShardWorkItemMinOrderIndex,
  runShardSubsetsWithRetry,
  sortEntriesByOrderIndex
} from './process-files/ordering.js';
import {
  buildExtractedProseLowYieldBailoutState,
  buildExtractedProseLowYieldBailoutSummary,
  EXTRACTED_PROSE_LOW_YIELD_SKIP_REASON,
  observeExtractedProseLowYieldSample,
  shouldSkipExtractedProseForLowYield
} from './process-files/extracted-prose.js';
import {
  logLexiconFilterAggregate,
  resolveOrderedAppenderConfig,
  resolvePostingsQueueConfig,
  resolveTreeSitterPlannerEntries
} from './process-files/planner.js';
import { SCHEDULER_QUEUE_NAMES } from '../../runtime/scheduler.js';
import { INDEX_PROFILE_VECTOR_ONLY } from '../../../../contracts/index-profile.js';
import { prepareScmFileMetaSnapshot } from '../../../scm/file-meta-snapshot.js';

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
const STAGE_TIMING_SCHEMA_VERSION = 1;
const STAGE_TIMING_SIZE_BINS = Object.freeze([
  Object.freeze({ id: '0-16kb', maxBytes: 16 * 1024 }),
  Object.freeze({ id: '16-64kb', maxBytes: 64 * 1024 }),
  Object.freeze({ id: '64-256kb', maxBytes: 256 * 1024 }),
  Object.freeze({ id: '256kb-1mb', maxBytes: 1024 * 1024 }),
  Object.freeze({ id: '1mb-4mb', maxBytes: 4 * 1024 * 1024 }),
  Object.freeze({ id: '4mb+', maxBytes: Number.POSITIVE_INFINITY })
]);
const FILE_QUEUE_DELAY_HISTOGRAM_BUCKETS_MS = Object.freeze([50, 100, 250, 500, 1000, 2000, 5000, 10000, 30000, 60000]);

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
const toIsoTimestamp = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? new Date(parsed).toISOString() : null;
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
 * Create histogram collector for duration samples.
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
 * @returns {{
 *   queueDelayMs:number,
 *   activeDurationMs:number,
 *   scmProcQueueWaitMs:number,
 *   activeProcessingDurationMs:number,
 *   writeDurationMs:number,
 *   totalDurationMs:number
 * }}
 */
export const resolveFileLifecycleDurations = (lifecycle = {}) => {
  const enqueuedAtMs = Number(lifecycle?.enqueuedAtMs);
  const dequeuedAtMs = Number(lifecycle?.dequeuedAtMs);
  const parseStartAtMs = Number(lifecycle?.parseStartAtMs);
  const parseEndAtMs = Number(lifecycle?.parseEndAtMs);
  const writeStartAtMs = Number(lifecycle?.writeStartAtMs);
  const writeEndAtMs = Number(lifecycle?.writeEndAtMs);
  const scmProcQueueWaitMs = clampDurationMs(lifecycle?.scmProcQueueWaitMs);
  const queueDelayMs = Number.isFinite(enqueuedAtMs) && Number.isFinite(dequeuedAtMs)
    ? Math.max(0, dequeuedAtMs - enqueuedAtMs)
    : 0;
  const activeDurationMs = Number.isFinite(parseStartAtMs) && Number.isFinite(parseEndAtMs)
    ? Math.max(0, parseEndAtMs - parseStartAtMs)
    : 0;
  const activeProcessingDurationMs = Math.max(0, activeDurationMs - scmProcQueueWaitMs);
  const writeDurationMs = Number.isFinite(writeStartAtMs) && Number.isFinite(writeEndAtMs)
    ? Math.max(0, writeEndAtMs - writeStartAtMs)
    : 0;
  const totalDurationMs = Number.isFinite(enqueuedAtMs) && Number.isFinite(writeEndAtMs)
    ? Math.max(0, writeEndAtMs - enqueuedAtMs)
    : (queueDelayMs + activeDurationMs + writeDurationMs);
  return {
    queueDelayMs,
    activeDurationMs,
    scmProcQueueWaitMs,
    activeProcessingDurationMs,
    writeDurationMs,
    totalDurationMs
  };
};

export const resolveEffectiveSlowFileDurationMs = ({ activeDurationMs, scmProcQueueWaitMs = 0 }) => {
  return Math.max(0, clampDurationMs(activeDurationMs) - clampDurationMs(scmProcQueueWaitMs));
};

export const shouldTriggerSlowFileWarning = ({
  activeDurationMs,
  thresholdMs,
  scmProcQueueWaitMs = 0
}) => {
  const threshold = Number(thresholdMs);
  if (!Number.isFinite(threshold) || threshold <= 0) return false;
  const effectiveDurationMs = resolveEffectiveSlowFileDurationMs({
    activeDurationMs,
    scmProcQueueWaitMs
  });
  return effectiveDurationMs >= threshold;
};

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

export const resolveChunkProcessingFeatureFlags = (runtime) => {
  const vectorOnlyProfile = runtime?.profile?.id === INDEX_PROFILE_VECTOR_ONLY;
  return {
    // Keep tokens populated for vector_only so retrieval query-AST matching
    // can still evaluate term/phrase predicates against ANN-ranked hits.
    tokenizeEnabled: true,
    sparsePostingsEnabled: !vectorOnlyProfile
  };
};

/**
 * Track ordered-appender completion promises and rethrow the first flush failure.
 *
 * `runWithQueue` may await throttling hooks (capacity) instead of each append completion.
 * This tracker keeps failures from `orderedAppender.enqueue()` observable even when callers
 * are only awaiting backpressure gates.
 *
 * @returns {{
 *   track:(completion:Promise<unknown>|unknown,onSettled?:(()=>void)|null)=>Promise<unknown>|unknown,
 *   throwIfFailed:()=>void,
 *   wait:(options?:{stallPollMs?:number,onStall?:(state:{pending:number,failed:boolean,stallCount:number})=>Promise<void>|void})=>Promise<void>,
 *   snapshot:()=>{pending:number,failed:boolean}
 * }}
 */
export const createOrderedCompletionTracker = () => {
  const pending = new Set();
  let firstError = null;

  const track = (completion, onSettled = null) => {
    if (!completion || typeof completion.then !== 'function') return completion;
    pending.add(completion);
    const settle = completion
      .catch((err) => {
        if (!firstError) firstError = err;
      })
      .finally(() => {
        pending.delete(completion);
        if (typeof onSettled === 'function') onSettled();
      });
    void settle.catch(() => {});
    return completion;
  };

  const throwIfFailed = () => {
    if (firstError) throw firstError;
  };

  const wait = async (options = {}) => {
    const stallPollMs = Number.isFinite(Number(options?.stallPollMs))
      ? Math.max(0, Math.floor(Number(options.stallPollMs)))
      : 0;
    const onStall = typeof options?.onStall === 'function' ? options.onStall : null;
    let stallCount = 0;
    let pendingDrainPromise = null;
    let pendingDrainSize = -1;
    while (pending.size > 0) {
      if (!pendingDrainPromise || pendingDrainSize !== pending.size) {
        pendingDrainSize = pending.size;
        pendingDrainPromise = Promise.allSettled(Array.from(pending));
      }
      if (!(stallPollMs > 0 && onStall)) {
        await pendingDrainPromise;
        pendingDrainPromise = null;
        continue;
      }
      const settled = await new Promise((resolve) => {
        let done = false;
        const timer = setTimeout(() => {
          if (done) return;
          done = true;
          resolve(false);
        }, stallPollMs);
        pendingDrainPromise.then(() => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          resolve(true);
        });
      });
      if (settled) {
        pendingDrainPromise = null;
        stallCount = 0;
        continue;
      }
      if (pending.size > 0) {
        stallCount += 1;
        await onStall({
          pending: pending.size,
          failed: Boolean(firstError),
          stallCount
        });
      }
    }
    throwIfFailed();
  };

  const snapshot = () => ({
    pending: pending.size,
    failed: Boolean(firstError)
  });

  return { track, throwIfFailed, wait, snapshot };
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

const resolveOptionalNonNegativeIntFromValues = (...values) => {
  for (const value of values) {
    const parsed = coerceOptionalNonNegativeInt(value);
    if (parsed != null) return parsed;
  }
  return null;
};

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

/**
 * Allow near-front ordered entries to bypass postings backpressure temporarily.
 *
 * This avoids pipeline stalls when the next ordered entry is only slightly
 * behind the current work item.
 *
 * @param {{orderIndex:number,nextOrderedIndex:number,bypassWindow?:number}} input
 * @returns {boolean}
 */
export const shouldBypassPostingsBackpressure = ({
  orderIndex,
  nextOrderedIndex,
  bypassWindow = 0
}) => {
  if (!Number.isFinite(orderIndex) || !Number.isFinite(nextOrderedIndex)) return false;
  const normalizedOrderIndex = Math.floor(orderIndex);
  const normalizedNextIndex = Math.floor(nextOrderedIndex);
  const normalizedWindow = Number.isFinite(bypassWindow)
    ? Math.max(0, Math.floor(bypassWindow))
    : 0;
  return normalizedOrderIndex <= (normalizedNextIndex + normalizedWindow);
};

export {
  buildDeterministicShardMergePlan,
  resolveClusterSubsetRetryConfig,
  resolveEntryOrderIndex,
  resolveShardSubsetId,
  resolveShardSubsetMinOrderIndex,
  runShardSubsetsWithRetry,
  sortEntriesByOrderIndex
};

const assignFileIndexes = (entries) => {
  if (!Array.isArray(entries)) return;
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    if (!entry || typeof entry !== 'object') continue;
    entry.fileIndex = i + 1;
  }
};

const resolveOrderedEntryProgressPlan = (entries) => {
  const safeEntries = Array.isArray(entries) ? entries : [];
  let minIndex = null;
  const expected = new Set();
  for (let i = 0; i < safeEntries.length; i += 1) {
    const entry = safeEntries[i];
    if (!entry || typeof entry !== 'object') continue;
    const startValue = resolveEntryOrderIndex(entry, null);
    if (Number.isFinite(startValue)) {
      minIndex = minIndex == null ? startValue : Math.min(minIndex, startValue);
    }
    const expectedValue = resolveEntryOrderIndex(entry, i);
    if (Number.isFinite(expectedValue)) expected.add(Math.floor(expectedValue));
  }
  return {
    startOrderIndex: Number.isFinite(minIndex) ? Math.max(0, Math.floor(minIndex)) : 0,
    expectedOrderIndices: Array.from(expected).sort((a, b) => a - b)
  };
};

const createStage1ProgressTracker = ({
  total = 0,
  mode = 'unknown',
  checkpoint = null,
  onTick = null
} = {}) => {
  const completedOrderIndexes = new Set();
  const safeTotal = Number.isFinite(Number(total))
    ? Math.max(0, Math.floor(Number(total)))
    : 0;
  const progress = {
    total: safeTotal,
    count: 0,
    tick() {
      this.count += 1;
      if (typeof onTick === 'function') onTick(this.count);
      showProgress('Files', this.count, this.total, { stage: 'processing', mode });
      checkpoint?.tick?.();
    }
  };
  const markOrderedEntryComplete = (orderIndex, shardProgress = null) => {
    if (!progress || typeof progress.tick !== 'function') return false;
    if (Number.isFinite(orderIndex)) {
      const normalizedOrderIndex = Math.floor(orderIndex);
      if (completedOrderIndexes.has(normalizedOrderIndex)) return false;
      completedOrderIndexes.add(normalizedOrderIndex);
    }
    progress.tick();
    if (shardProgress) {
      shardProgress.count += 1;
      showProgress('Shard', shardProgress.count, shardProgress.total, shardProgress.meta);
    }
    return true;
  };
  return {
    progress,
    markOrderedEntryComplete
  };
};

const toStage1StallFileSummary = (entry, nowMs = Date.now()) => {
  if (!entry || typeof entry !== 'object') return null;
  const startedAt = Number(entry.startedAt) || nowMs;
  return {
    orderIndex: Number.isFinite(entry.orderIndex) ? entry.orderIndex : null,
    file: entry.file || null,
    shardId: entry.shardId || null,
    fileIndex: Number.isFinite(entry.fileIndex) ? entry.fileIndex : null,
    ownershipId: typeof entry.ownershipId === 'string' ? entry.ownershipId : null,
    elapsedMs: Math.max(0, nowMs - startedAt)
  };
};

const collectStage1StalledFiles = (inFlightFiles, { limit = 6, nowMs = Date.now() } = {}) => (
  Array.from(inFlightFiles?.values?.() || [])
    .map((value) => toStage1StallFileSummary(value, nowMs))
    .filter(Boolean)
    .sort((a, b) => (b.elapsedMs || 0) - (a.elapsedMs || 0))
    .slice(0, limit)
);

const summarizeStage1QueueDelay = (queueDelaySummary) => ({
  count: Math.max(0, Math.floor(Number(queueDelaySummary?.count) || 0)),
  avgMs: Number(queueDelaySummary?.count) > 0
    ? clampDurationMs(queueDelaySummary?.totalMs) / Number(queueDelaySummary.count)
    : 0,
  maxMs: clampDurationMs(queueDelaySummary?.maxMs)
});

const formatStage1StalledFileText = (stalledFiles = []) => (
  stalledFiles
    .map((entry) => `${entry.file || 'unknown'}#${entry.orderIndex ?? '?'}@${Math.round((entry.elapsedMs || 0) / 1000)}s`)
    .join(', ')
);

const STALL_DIAGNOSTIC_QUEUE_NAMES = Object.freeze(['stage1.cpu', 'stage1.io', 'stage1.postings']);

const buildStage1SchedulerStallSnapshot = (runtime) => {
  if (typeof runtime?.scheduler?.stats !== 'function') return null;
  const stats = runtime.scheduler.stats();
  if (!stats || typeof stats !== 'object') return null;
  const queues = stats?.queues && typeof stats.queues === 'object' ? stats.queues : {};
  const summarizeQueue = (queueName) => {
    const queue = queues?.[queueName];
    if (!queue || typeof queue !== 'object') return null;
    return {
      name: queueName,
      surface: queue.surface || null,
      pending: Number(queue.pending) || 0,
      running: Number(queue.running) || 0,
      pendingBytes: Number(queue.pendingBytes) || 0,
      inFlightBytes: Number(queue.inFlightBytes) || 0,
      oldestWaitMs: Number(queue.oldestWaitMs) || 0
    };
  };
  const highlightedQueues = STALL_DIAGNOSTIC_QUEUE_NAMES
    .map((queueName) => summarizeQueue(queueName))
    .filter(Boolean);
  const topPendingQueues = Object.entries(queues)
    .map(([name, queue]) => ({
      name,
      surface: queue?.surface || null,
      pending: Number(queue?.pending) || 0,
      running: Number(queue?.running) || 0,
      oldestWaitMs: Number(queue?.oldestWaitMs) || 0
    }))
    .filter((entry) => entry.pending > 0 || entry.running > 0)
    .sort((left, right) => {
      if (right.pending !== left.pending) return right.pending - left.pending;
      if (right.running !== left.running) return right.running - left.running;
      return right.oldestWaitMs - left.oldestWaitMs;
    })
    .slice(0, 8);
  const parseSurface = stats?.adaptive?.surfaces?.parse && typeof stats.adaptive.surfaces.parse === 'object'
    ? {
      minConcurrency: Number(stats.adaptive.surfaces.parse.minConcurrency) || 0,
      maxConcurrency: Number(stats.adaptive.surfaces.parse.maxConcurrency) || 0,
      currentConcurrency: Number(stats.adaptive.surfaces.parse.currentConcurrency) || 0,
      running: Number(stats.adaptive.surfaces.parse.snapshot?.running) || 0,
      pending: Number(stats.adaptive.surfaces.parse.snapshot?.pending) || 0
    }
    : null;
  return {
    activity: {
      pending: Number(stats?.activity?.pending) || 0,
      running: Number(stats?.activity?.running) || 0
    },
    utilization: {
      cpu: Number(stats?.utilization?.cpu) || 0,
      io: Number(stats?.utilization?.io) || 0,
      mem: Number(stats?.utilization?.mem) || 0
    },
    parseSurface,
    highlightedQueues,
    topPendingQueues
  };
};

const formatStage1SchedulerStallSummary = (snapshot) => {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const parse = snapshot.parseSurface && typeof snapshot.parseSurface === 'object'
    ? snapshot.parseSurface
    : null;
  const queueByName = new Map(
    (Array.isArray(snapshot.highlightedQueues) ? snapshot.highlightedQueues : [])
      .map((entry) => [entry.name, entry])
  );
  const formatQueue = (name) => {
    const queue = queueByName.get(name);
    if (!queue) return `${name}=n/a`;
    return `${name}=r${queue.running}/p${queue.pending}/wait${Math.round((queue.oldestWaitMs || 0) / 1000)}s`;
  };
  return [
    parse
      ? `parse=r${parse.running}/p${parse.pending}/cap${parse.currentConcurrency}`
      : 'parse=n/a',
    formatQueue('stage1.cpu'),
    formatQueue('stage1.io'),
    formatQueue('stage1.postings')
  ].join(' ');
};

const buildStage1ProcessingStallSnapshot = ({
  reason = 'stall_snapshot',
  idleMs = null,
  includeStack = false,
  nowMs = Date.now(),
  lastProgressAt = 0,
  progress = null,
  processStart = 0,
  inFlightFiles,
  getOrderedPendingCount = () => 0,
  orderedAppender = null,
  postingsQueue = null,
  queueDelaySummary = null,
  stage1OwnershipPrefix = '',
  runtime = null
} = {}) => {
  const resolvedIdleMs = Number.isFinite(Number(idleMs))
    ? clampDurationMs(idleMs)
    : Math.max(0, nowMs - (Number(lastProgressAt) || nowMs));
  const orderedPending = getOrderedPendingCount();
  const orderedSnapshot = typeof orderedAppender?.snapshot === 'function'
    ? orderedAppender.snapshot()
    : null;
  const postingsSnapshot = typeof postingsQueue?.stats === 'function'
    ? postingsQueue.stats()
    : null;
  const stalledFiles = collectStage1StalledFiles(inFlightFiles, { limit: 6, nowMs });
  const trackedSubprocesses = snapshotTrackedSubprocesses({
    ownershipPrefix: stage1OwnershipPrefix,
    limit: 8
  });
  const schedulerSnapshot = buildStage1SchedulerStallSnapshot(runtime);
  return {
    reason,
    generatedAt: new Date(nowMs).toISOString(),
    source: 'stage1-watchdog',
    idleMs: resolvedIdleMs,
    progressDone: progress?.count || 0,
    progressTotal: progress?.total || 0,
    progressElapsedMs: Math.max(0, nowMs - processStart),
    lastProgressAt: toIsoTimestamp(lastProgressAt),
    inFlight: inFlightFiles?.size || 0,
    orderedPending,
    orderedSnapshot,
    postingsSnapshot,
    queueDelayMs: summarizeStage1QueueDelay(queueDelaySummary),
    stalledFiles,
    trackedSubprocesses,
    scheduler: schedulerSnapshot,
    process: captureProcessSnapshot({
      includeStack,
      frameLimit: includeStack ? 16 : 8,
      handleTypeLimit: 8
    })
  };
};

const summarizeStage1SoftKickCleanup = (cleanupResults = []) => {
  const summaries = (Array.isArray(cleanupResults) ? cleanupResults : [])
    .filter((entry) => entry && typeof entry === 'object');
  const attempted = summaries.reduce((sum, entry) => sum + (Number(entry.attempted) || 0), 0);
  const failures = summaries.reduce((sum, entry) => sum + (Number(entry.failures) || 0), 0);
  const terminatedPids = Array.from(new Set(
    summaries.flatMap((entry) => (
      Array.isArray(entry.terminatedPids)
        ? entry.terminatedPids.filter((pid) => Number.isFinite(pid))
        : []
    ))
  )).sort((a, b) => a - b);
  const ownershipIds = Array.from(new Set(
    summaries.flatMap((entry) => (
      Array.isArray(entry.terminatedOwnershipIds)
        ? entry.terminatedOwnershipIds.filter((value) => typeof value === 'string' && value)
        : []
    ))
  )).sort((left, right) => left.localeCompare(right));
  return {
    attempted,
    failures,
    terminatedPids,
    ownershipIds,
    cleanupResults: summaries
  };
};

const buildStage1ShardWorkPlan = ({
  shardExecutionPlan,
  shardIndexById,
  totals
}) => {
  const work = [];
  const totalShards = shardExecutionPlan.length;
  const totalFiles = totals.totalFiles;
  const totalLines = totals.totalLines;
  const totalBytes = totals.totalBytes;
  const totalCost = totals.totalCost;
  for (const shard of shardExecutionPlan) {
    const fileCount = shard.entries.length;
    const costPerFile = shard.costMs && fileCount ? shard.costMs / fileCount : 0;
    const fileShare = totalFiles > 0 ? fileCount / totalFiles : 0;
    const lineCount = shard.lineCount || 0;
    const lineShare = totalLines > 0 ? lineCount / totalLines : 0;
    const byteCount = shard.byteCount || 0;
    const byteShare = totalBytes > 0 ? byteCount / totalBytes : 0;
    const costMs = shard.costMs || 0;
    const costShare = totalCost > 0 ? costMs / totalCost : 0;
    const share = Math.max(fileShare, lineShare, byteShare, costShare);
    let parts = 1;
    if (share > 0.05) parts = share > 0.1 ? 4 : 2;
    parts = Math.min(parts, Math.max(1, fileCount));
    if (parts <= 1) {
      work.push({
        shard,
        entries: shard.entries,
        partIndex: 1,
        partTotal: 1,
        predictedCostMs: costPerFile ? costPerFile * fileCount : costMs,
        shardIndex: shardIndexById.get(shard.id) || 1,
        shardTotal: totalShards
      });
      continue;
    }
    const perPart = Math.ceil(fileCount / parts);
    for (let i = 0; i < parts; i += 1) {
      const start = i * perPart;
      const end = Math.min(start + perPart, fileCount);
      if (start >= end) continue;
      const partCount = end - start;
      work.push({
        shard,
        entries: shard.entries.slice(start, end),
        partIndex: i + 1,
        partTotal: parts,
        predictedCostMs: costPerFile ? costPerFile * partCount : costMs / parts,
        shardIndex: shardIndexById.get(shard.id) || 1,
        shardTotal: totalShards
      });
    }
  }
  return work;
};

const resolveStage1ShardExecutionQueuePlan = ({
  shardPlan,
  runtime,
  clusterModeEnabled = false,
  clusterDeterministicMerge = true
}) => {
  const shardExecutionPlan = [...shardPlan].sort((a, b) => {
    if (clusterModeEnabled && clusterDeterministicMerge) {
      return compareStrings(a.id, b.id);
    }
    const costDelta = (b.costMs || 0) - (a.costMs || 0);
    if (costDelta !== 0) return costDelta;
    const lineDelta = (b.lineCount || 0) - (a.lineCount || 0);
    if (lineDelta !== 0) return lineDelta;
    const sizeDelta = b.entries.length - a.entries.length;
    if (sizeDelta !== 0) return sizeDelta;
    return compareStrings(a.label || a.id, b.label || b.id);
  });
  const shardIndexById = new Map(
    shardExecutionPlan.map((shard, index) => [shard.id, index + 1])
  );
  const shardExecutionOrderById = new Map(
    shardExecutionPlan.map((shard, index) => [shard.id, index + 1])
  );
  const totals = {
    totalFiles: shardPlan.reduce((sum, shard) => sum + shard.entries.length, 0),
    totalLines: shardPlan.reduce((sum, shard) => sum + (shard.lineCount || 0), 0),
    totalBytes: shardPlan.reduce((sum, shard) => sum + (shard.byteCount || 0), 0),
    totalCost: shardPlan.reduce((sum, shard) => sum + (shard.costMs || 0), 0)
  };
  const shardWorkPlan = buildStage1ShardWorkPlan({
    shardExecutionPlan,
    shardIndexById,
    totals
  }).map((workItem) => ({
    ...workItem,
    subsetId: resolveShardSubsetId(workItem),
    firstOrderIndex: resolveShardWorkItemMinOrderIndex(workItem)
  }));
  const shardMergePlan = buildDeterministicShardMergePlan(shardWorkPlan);
  const mergeOrderBySubsetId = new Map(
    shardMergePlan.map((entry) => [entry.subsetId, entry.mergeIndex])
  );
  const mergeOrderByShardId = new Map();
  for (const entry of shardMergePlan) {
    const shardId = entry?.shardId;
    if (!shardId || mergeOrderByShardId.has(shardId)) continue;
    mergeOrderByShardId.set(shardId, entry.mergeIndex);
  }
  for (const workItem of shardWorkPlan) {
    workItem.mergeIndex = mergeOrderBySubsetId.get(workItem.subsetId) || null;
  }
  const defaultShardConcurrency = Math.max(
    1,
    Math.min(32, runtime.fileConcurrency, runtime.cpuConcurrency)
  );
  let shardConcurrency = Number.isFinite(runtime.shards?.cluster?.workerCount)
    ? Math.max(1, Math.floor(runtime.shards.cluster.workerCount))
    : (Number.isFinite(runtime.shards.maxWorkers)
      ? Math.max(1, Math.floor(runtime.shards.maxWorkers))
      : defaultShardConcurrency);
  shardConcurrency = Math.min(shardConcurrency, runtime.fileConcurrency);
  let shardBatches = planShardBatches(shardWorkPlan, shardConcurrency, {
    resolveWeight: (workItem) => Number.isFinite(workItem.predictedCostMs)
      ? workItem.predictedCostMs
      : (workItem.shard.costMs || workItem.shard.lineCount || workItem.entries.length || 0),
    resolveTieBreaker: (workItem) => {
      const shardId = workItem.shard?.id || workItem.shard?.label || '';
      const part = Number.isFinite(workItem.partIndex) ? workItem.partIndex : 0;
      return `${shardId}:${part}`;
    }
  });
  if (shardBatches.length) {
    shardBatches = shardBatches.map((batch) => [...batch].sort((a, b) => {
      const aOrder = Number.isFinite(a?.firstOrderIndex) ? a.firstOrderIndex : Number.MAX_SAFE_INTEGER;
      const bOrder = Number.isFinite(b?.firstOrderIndex) ? b.firstOrderIndex : Number.MAX_SAFE_INTEGER;
      if (aOrder !== bOrder) return aOrder - bOrder;
      const aMerge = Number.isFinite(a?.mergeIndex) ? a.mergeIndex : Number.MAX_SAFE_INTEGER;
      const bMerge = Number.isFinite(b?.mergeIndex) ? b.mergeIndex : Number.MAX_SAFE_INTEGER;
      if (aMerge !== bMerge) return aMerge - bMerge;
      const aShard = a?.shard?.id || a?.shard?.label || '';
      const bShard = b?.shard?.id || b?.shard?.label || '';
      return compareStrings(aShard, bShard);
    }));
  }
  if (!shardBatches.length && shardWorkPlan.length) {
    shardBatches = [shardWorkPlan.slice()];
  }
  shardConcurrency = Math.max(1, shardBatches.length);
  const perShardFileConcurrency = Math.max(
    1,
    Math.min(4, Math.floor(runtime.fileConcurrency / shardConcurrency))
  );
  const perShardImportConcurrency = Math.max(1, Math.floor(runtime.importConcurrency / shardConcurrency));
  const baseEmbedConcurrency = Number.isFinite(runtime.embeddingConcurrency)
    ? runtime.embeddingConcurrency
    : runtime.cpuConcurrency;
  const perShardEmbeddingConcurrency = Math.max(
    1,
    Math.min(perShardFileConcurrency, Math.floor(baseEmbedConcurrency / shardConcurrency))
  );
  return {
    shardExecutionPlan,
    shardExecutionOrderById,
    totals,
    shardWorkPlan,
    shardMergePlan,
    mergeOrderByShardId,
    shardBatches,
    shardConcurrency,
    perShardFileConcurrency,
    perShardImportConcurrency,
    perShardEmbeddingConcurrency
  };
};

/**
 * Main stage1 file-processing orchestration.
 * Handles scheduler prep, concurrent file processing, ordered output append,
 * sparse postings backpressure, and checkpoint/progress emission.
 *
 * @param {object} input
 * @returns {Promise<object>}
 */
export const processFiles = async ({
  mode,
  runtime,
  discovery,
  outDir,
  entries,
  contextWin,
  timing,
  crashLogger,
  state,
  perfProfile,
  cacheReporter,
  seenFiles,
  incrementalState,
  relationsEnabled,
  shardPerfProfile,
  fileTextCache,
  extractedProseYieldProfile = null,
  documentExtractionCache = null,
  abortSignal = null
}) => {
  const stageAbortController = typeof AbortController === 'function'
    ? new AbortController()
    : null;
  const effectiveAbortSignal = stageAbortController?.signal || abortSignal || null;
  let detachExternalAbort = null;
  if (stageAbortController && abortSignal && typeof abortSignal.addEventListener === 'function') {
    const forwardAbort = () => {
      if (effectiveAbortSignal?.aborted) return;
      try {
        stageAbortController.abort(abortSignal.reason);
      } catch {
        stageAbortController.abort();
      }
    };
    abortSignal.addEventListener('abort', forwardAbort, { once: true });
    detachExternalAbort = () => {
      abortSignal.removeEventListener('abort', forwardAbort);
    };
    if (abortSignal.aborted) forwardAbort();
  }
  const abortProcessing = (reason = null) => {
    if (!stageAbortController || effectiveAbortSignal?.aborted) return;
    try {
      stageAbortController.abort(reason || undefined);
    } catch {
      stageAbortController.abort();
    }
  };

  throwIfAborted(effectiveAbortSignal);
  log('Processing and indexing files...');
  crashLogger.updatePhase('processing');
  const stageFileCount = Array.isArray(entries) ? entries.length : 0;
  const stageChunkCount = Array.isArray(state?.chunks) ? state.chunks.length : 0;
  if (stageFileCount === 0 && stageChunkCount === 0) {
    logLine(
      `[stage1:${mode}] processing elided (zero modality: files=0 chunks=0).`,
      {
        kind: 'info',
        mode,
        stage: 'processing',
        event: 'stage_elided',
        fileCount: 0,
        chunkCount: 0
      }
    );
    if (timing && typeof timing === 'object') timing.processMs = 0;
    if (state && typeof state === 'object') {
      state.modalityStageElisions = {
        ...(state.modalityStageElisions || {}),
        [mode]: {
          source: 'process-files-guard',
          fileCount: 0,
          chunkCount: 0
        }
      };
    }
    return {
      tokenizationStats: null,
      shardSummary: null,
      shardPlan: [],
      shardExecution: null,
      postingsQueueStats: null,
      stageElided: true
    };
  }
  const processStart = Date.now();
  const stageFileWatchdogConfig = resolveFileWatchdogConfig(runtime, { repoFileCount: stageFileCount });
  const extractedProseExtrasCache = (mode === 'prose' || mode === 'extracted-prose')
    ? resolveExtractedProseExtrasCache(runtime)
    : null;
  const sharedScmMetaCache = (mode === 'prose' || mode === 'extracted-prose')
    ? resolveSharedScmMetaCache(runtime)
    : null;
  const primeExtractedProseExtrasCache = mode === 'prose'
    && Array.isArray(runtime?.requestedModes)
    && runtime.requestedModes.includes('extracted-prose');
  const stageTimingBreakdown = {
    parseChunk: { totalMs: 0, byLanguage: new Map(), bySizeBin: new Map() },
    inference: { totalMs: 0, byLanguage: new Map(), bySizeBin: new Map() },
    embedding: { totalMs: 0, byLanguage: new Map(), bySizeBin: new Map() }
  };
  const extractedProseLowYieldBailout = buildExtractedProseLowYieldBailoutState({
    mode,
    runtime,
    entries,
    persistedProfile: extractedProseYieldProfile
  });
  if (mode === 'extracted-prose' && extractedProseLowYieldBailout?.history?.disabledForYieldHistory) {
    logLine(
      '[stage1:extracted-prose] low-yield bailout disabled (persisted yield history detected).',
      {
        kind: 'info',
        mode,
        stage: 'processing',
        extractedProseLowYieldBailout: {
          disabledForYieldHistory: true,
          yieldedFiles: extractedProseLowYieldBailout.history.yieldedFiles,
          observedFiles: extractedProseLowYieldBailout.history.observedFiles,
          builds: extractedProseLowYieldBailout.history.builds
        }
      }
    );
  } else if (mode === 'extracted-prose' && extractedProseLowYieldBailout?.history?.reducedWarmup) {
    logLine(
      `[stage1:extracted-prose] low-yield warmup reduced `
        + `(${extractedProseLowYieldBailout.history.baseWarmupSampleSize}`
        + ` -> ${extractedProseLowYieldBailout.warmupSampleSize}) from persisted zero-yield history.`,
      {
        kind: 'info',
        mode,
        stage: 'processing',
        extractedProseLowYieldBailout: {
          reducedWarmup: true,
          baseWarmupSampleSize: extractedProseLowYieldBailout.history.baseWarmupSampleSize,
          warmupSampleSize: extractedProseLowYieldBailout.warmupSampleSize,
          observedFiles: extractedProseLowYieldBailout.history.observedFiles,
          builds: extractedProseLowYieldBailout.history.builds
        }
      }
    );
  }
  const extractedProseYieldProfilePrefilter = normalizeExtractedProseYieldProfilePrefilterState({
    mode,
    runtime,
    persistedProfile: extractedProseYieldProfile
  });
  const extractedProseYieldProfileObservation = createExtractedProseYieldProfileObservationState({
    mode,
    runtime
  });
  const queueDelayHistogram = createDurationHistogram(FILE_QUEUE_DELAY_HISTOGRAM_BUCKETS_MS);
  const queueDelaySummary = { count: 0, totalMs: 0, minMs: null, maxMs: 0 };
  const watchdogNearThreshold = {
    sampleCount: 0,
    nearThresholdCount: 0,
    slowWarningCount: 0,
    thresholdTotalMs: 0,
    activeTotalMs: 0
  };
  const lifecycleByOrderIndex = new Map();
  const lifecycleByRelKey = new Map();
  const queueDelayTelemetryChannel = 'stage1.file-queue-delay';
  runtime?.telemetry?.clearDurationHistogram?.(queueDelayTelemetryChannel);
  const ensureLifecycleRecord = ({
    orderIndex,
    file = null,
    fileIndex = null,
    shardId = null
  } = {}) => {
    if (!Number.isFinite(orderIndex)) return null;
    const normalizedOrderIndex = Math.floor(orderIndex);
    const existing = lifecycleByOrderIndex.get(normalizedOrderIndex);
    if (existing) {
      if (file && !existing.file) existing.file = file;
      if (Number.isFinite(fileIndex) && !Number.isFinite(existing.fileIndex)) {
        existing.fileIndex = Math.floor(fileIndex);
      }
      if (shardId && !existing.shardId) existing.shardId = shardId;
      return existing;
    }
    const created = {
      orderIndex: normalizedOrderIndex,
      file: file || null,
      fileIndex: Number.isFinite(fileIndex) ? Math.floor(fileIndex) : null,
      shardId: shardId || null,
      enqueuedAtMs: null,
      dequeuedAtMs: null,
      parseStartAtMs: null,
      parseEndAtMs: null,
      writeStartAtMs: null,
      writeEndAtMs: null
    };
    lifecycleByOrderIndex.set(normalizedOrderIndex, created);
    return created;
  };
  const updateStageTimingBucket = (bucketMap, key, { durationMs = 0, files = 1, bytes = 0, lines = 0 } = {}) => {
    const bucketKey = key || 'unknown';
    const entry = bucketMap.get(bucketKey) || {
      files: 0,
      totalMs: 0,
      bytes: 0,
      lines: 0
    };
    entry.files += Math.max(0, Math.floor(Number(files) || 0));
    entry.totalMs += clampDurationMs(durationMs);
    entry.bytes += Math.max(0, Math.floor(Number(bytes) || 0));
    entry.lines += Math.max(0, Math.floor(Number(lines) || 0));
    bucketMap.set(bucketKey, entry);
  };
  const recordStageTimingSample = (section, {
    languageId = null,
    bytes = 0,
    lines = 0,
    durationMs = 0
  } = {}) => {
    const sectionBucket = stageTimingBreakdown[section];
    if (!sectionBucket) return;
    const safeDurationMs = clampDurationMs(durationMs);
    if (safeDurationMs <= 0) return;
    const safeBytes = Math.max(0, Math.floor(Number(bytes) || 0));
    const safeLines = Math.max(0, Math.floor(Number(lines) || 0));
    const normalizedLanguage = languageId || 'unknown';
    const sizeBin = resolveStageTimingSizeBin(safeBytes);
    sectionBucket.totalMs += safeDurationMs;
    updateStageTimingBucket(sectionBucket.byLanguage, normalizedLanguage, {
      durationMs: safeDurationMs,
      files: 1,
      bytes: safeBytes,
      lines: safeLines
    });
    updateStageTimingBucket(sectionBucket.bySizeBin, sizeBin, {
      durationMs: safeDurationMs,
      files: 1,
      bytes: safeBytes,
      lines: safeLines
    });
  };
  const observeQueueDelay = (durationMs) => {
    const safeDurationMs = clampDurationMs(durationMs);
    queueDelaySummary.count += 1;
    queueDelaySummary.totalMs += safeDurationMs;
    queueDelaySummary.minMs = queueDelaySummary.minMs == null
      ? safeDurationMs
      : Math.min(queueDelaySummary.minMs, safeDurationMs);
    queueDelaySummary.maxMs = Math.max(queueDelaySummary.maxMs, safeDurationMs);
    queueDelayHistogram.observe(safeDurationMs);
    runtime?.telemetry?.recordDuration?.(queueDelayTelemetryChannel, safeDurationMs);
  };
  const observeWatchdogNearThreshold = ({
    activeDurationMs = 0,
    thresholdMs = 0,
    triggeredSlowWarning = false,
    lowerFraction = stageFileWatchdogConfig?.nearThresholdLowerFraction,
    upperFraction = stageFileWatchdogConfig?.nearThresholdUpperFraction
  } = {}) => {
    const threshold = Number(thresholdMs);
    if (!Number.isFinite(threshold) || threshold <= 0) return;
    const activeMs = clampDurationMs(activeDurationMs);
    watchdogNearThreshold.sampleCount += 1;
    watchdogNearThreshold.thresholdTotalMs += threshold;
    watchdogNearThreshold.activeTotalMs += activeMs;
    if (triggeredSlowWarning) {
      watchdogNearThreshold.slowWarningCount += 1;
      return;
    }
    if (isNearThresholdSlowFileDuration({
      activeDurationMs: activeMs,
      thresholdMs: threshold,
      lowerFraction,
      upperFraction
    })) {
      watchdogNearThreshold.nearThresholdCount += 1;
    }
  };
  const finalizeBreakdownBucket = (bucketMap) => (
    Object.fromEntries(
      Array.from(bucketMap.entries())
        .sort((a, b) => compareStrings(a[0], b[0]))
        .map(([key, value]) => {
          const totalMs = clampDurationMs(value?.totalMs);
          const files = Math.max(0, Math.floor(Number(value?.files) || 0));
          const bytes = Math.max(0, Math.floor(Number(value?.bytes) || 0));
          const lines = Math.max(0, Math.floor(Number(value?.lines) || 0));
          return [key, {
            files,
            totalMs,
            avgMs: files > 0 ? totalMs / files : 0,
            bytes,
            lines
          }];
        })
    )
  );
  const buildStageTimingBreakdownPayload = () => ({
    schemaVersion: STAGE_TIMING_SCHEMA_VERSION,
    parseChunk: {
      totalMs: clampDurationMs(stageTimingBreakdown.parseChunk.totalMs),
      byLanguage: finalizeBreakdownBucket(stageTimingBreakdown.parseChunk.byLanguage),
      bySizeBin: finalizeBreakdownBucket(stageTimingBreakdown.parseChunk.bySizeBin)
    },
    inference: {
      totalMs: clampDurationMs(stageTimingBreakdown.inference.totalMs),
      byLanguage: finalizeBreakdownBucket(stageTimingBreakdown.inference.byLanguage),
      bySizeBin: finalizeBreakdownBucket(stageTimingBreakdown.inference.bySizeBin)
    },
    embedding: {
      totalMs: clampDurationMs(stageTimingBreakdown.embedding.totalMs),
      byLanguage: finalizeBreakdownBucket(stageTimingBreakdown.embedding.byLanguage),
      bySizeBin: finalizeBreakdownBucket(stageTimingBreakdown.embedding.bySizeBin)
    },
    extractedProseLowYieldBailout: buildExtractedProseLowYieldBailoutSummary(extractedProseLowYieldBailout),
    watchdog: {
      queueDelayMs: {
        summary: {
          count: Math.max(0, Math.floor(queueDelaySummary.count)),
          totalMs: clampDurationMs(queueDelaySummary.totalMs),
          minMs: queueDelaySummary.minMs == null ? 0 : clampDurationMs(queueDelaySummary.minMs),
          maxMs: clampDurationMs(queueDelaySummary.maxMs),
          avgMs: queueDelaySummary.count > 0
            ? clampDurationMs(queueDelaySummary.totalMs) / queueDelaySummary.count
            : 0
        },
        histogram: queueDelayHistogram.snapshot()
      },
      nearThreshold: buildWatchdogNearThresholdSummary({
        sampleCount: watchdogNearThreshold.sampleCount,
        nearThresholdCount: watchdogNearThreshold.nearThresholdCount,
        slowWarningCount: watchdogNearThreshold.slowWarningCount,
        thresholdTotalMs: watchdogNearThreshold.thresholdTotalMs,
        activeTotalMs: watchdogNearThreshold.activeTotalMs,
        lowerFraction: stageFileWatchdogConfig?.nearThresholdLowerFraction,
        upperFraction: stageFileWatchdogConfig?.nearThresholdUpperFraction,
        alertFraction: stageFileWatchdogConfig?.nearThresholdAlertFraction,
        minSamples: stageFileWatchdogConfig?.nearThresholdMinSamples,
        slowFileMs: stageFileWatchdogConfig?.slowFileMs
      })
    }
  });
  const ioQueueConcurrency = Number.isFinite(runtime?.queues?.io?.concurrency)
    ? runtime.queues.io.concurrency
    : runtime.ioConcurrency;
  const cpuQueueConcurrency = Number.isFinite(runtime?.queues?.cpu?.concurrency)
    ? runtime.queues.cpu.concurrency
    : runtime.cpuConcurrency;
  log(
    `Indexing Concurrency: Files: ${runtime.fileConcurrency}, ` +
    `Imports: ${runtime.importConcurrency}, IO: ${ioQueueConcurrency}, CPU: ${cpuQueueConcurrency}`
  );
  const envConfig = getEnvConfig();
  const showFileProgress = envConfig.verbose === true || runtime?.argv?.verbose === true;
  const debugOrdered = envConfig.debugOrdered === true;
  const enablePerfEvents = envConfig.debugPerfEvents === true;
  const perfEventBaseLogger = await createPerfEventLogger({
    buildRoot: runtime.buildRoot || runtime.root,
    mode,
    stream: 'heavy-file',
    enabled: mode === 'code' && enablePerfEvents
  });
  const perfEventLogger = createHeavyFilePerfAggregator({
    logger: perfEventBaseLogger
  });

  let treeSitterScheduler = null;
  const treeSitterEnabled = mode === 'code' && runtime?.languageOptions?.treeSitter?.enabled !== false;
  if (treeSitterEnabled) {
    const plannerInput = resolveTreeSitterPlannerEntries({
      entries,
      root: runtime.root
    });
    if (plannerInput.skipped > 0) {
      log(
        `[tree-sitter:schedule] prefilter: skipped ${plannerInput.skipped} entries; `
        + `${plannerInput.entries.length} queued for planning.`
      );
    }
    log('[tree-sitter:schedule] planning global batches...');
    treeSitterScheduler = await runTreeSitterScheduler({
      mode,
      runtime,
      entries: plannerInput.entries,
      outDir,
      fileTextCache,
      abortSignal: effectiveAbortSignal,
      log,
      crashLogger
    });
    const schedStats = treeSitterScheduler?.stats ? treeSitterScheduler.stats() : null;
    if (schedStats) {
      log(
        `[tree-sitter:schedule] plan ready: grammars=${schedStats.grammarKeys} ` +
        `entries=${schedStats.indexEntries} cache=${schedStats.cacheEntries}`
      );
      if ((Number(schedStats.parserCrashSignatures) || 0) > 0) {
        const degradedSummary = {
          parserCrashSignatures: Number(schedStats.parserCrashSignatures) || 0,
          failedGrammarKeys: Number(schedStats.failedGrammarKeys) || 0,
          degradedVirtualPaths: Number(schedStats.degradedVirtualPaths) || 0
        };
        if (state && typeof state === 'object') {
          state.treeSitterDegraded = degradedSummary;
        }
        logLine(
          `[tree-sitter:schedule] degraded parser mode active: signatures=${degradedSummary.parserCrashSignatures} ` +
          `failedGrammars=${degradedSummary.failedGrammarKeys} ` +
          `degradedVirtualPaths=${degradedSummary.degradedVirtualPaths}`,
          {
            kind: 'warning',
            mode,
            stage: 'processing',
            substage: 'tree-sitter-scheduler',
            treeSitterDegraded: degradedSummary
          }
        );
      }
    }
  }

  const closeTreeSitterScheduler = async () => {
    if (!treeSitterScheduler || typeof treeSitterScheduler.close !== 'function') return;
    await treeSitterScheduler.close();
  };
  let stallSnapshotTimer = null;
  let progressHeartbeatTimer = null;
  let stallAbortTimer = null;
  const cleanupTimeoutMs = resolveProcessCleanupTimeoutMs(runtime);

  try {
    assignFileIndexes(entries);
    const repoFileCount = Array.isArray(entries) ? entries.length : 0;
    const scmFilesPosix = entries.map((entry) => (
      entry?.rel
        ? toPosix(entry.rel)
        : toPosix(path.relative(runtime.root, entry?.abs || ''))
    ));
    const scmSnapshotConfig = runtime?.scmConfig?.snapshot || {};
    const scmSnapshotEnabled = scmSnapshotConfig.enabled !== false;
    let scmFileMetaByPath = null;
    if (scmSnapshotEnabled) {
      const scmMetaStart = Date.now();
      const scmSnapshot = await prepareScmFileMetaSnapshot({
        repoCacheRoot: runtime.repoCacheRoot,
        provider: runtime.scmProvider,
        providerImpl: runtime.scmProviderImpl,
        repoRoot: runtime.scmRepoRoot,
        repoProvenance: runtime.repoProvenance,
        filesPosix: scmFilesPosix,
        includeChurn: scmSnapshotConfig.includeChurn === true,
        timeoutMs: Number.isFinite(Number(scmSnapshotConfig.timeoutMs))
          ? Number(scmSnapshotConfig.timeoutMs)
          : runtime?.scmConfig?.timeoutMs,
        maxFallbackConcurrency: Number.isFinite(Number(scmSnapshotConfig.maxFallbackConcurrency))
          ? Number(scmSnapshotConfig.maxFallbackConcurrency)
          : runtime.procConcurrency,
        log
      });
      scmFileMetaByPath = scmSnapshot?.fileMetaByPath || null;
      if (timing && typeof timing === 'object') {
        timing.scmMetaMs = Math.max(0, Date.now() - scmMetaStart);
      }
    }

    const structuralMatches = await loadStructuralMatches({
      repoRoot: runtime.root,
      repoCacheRoot: runtime.repoCacheRoot,
      log
    });
    const { tokenizeEnabled, sparsePostingsEnabled } = resolveChunkProcessingFeatureFlags(runtime);
    const tokenRetentionState = createTokenRetentionState({
      runtime,
      totalFiles: entries.length,
      sparsePostingsEnabled,
      log
    });
    const { tokenizationStats, appendChunkWithRetention } = tokenRetentionState;
    const postingsQueueConfig = sparsePostingsEnabled
      ? resolvePostingsQueueConfig(runtime)
      : null;
    const orderedAppenderConfig = resolveOrderedAppenderConfig(runtime);
    const updatePostingsTelemetry = (snapshot = null) => {
      if (!runtime?.telemetry?.setInFlightBytes) return;
      const pendingCount = Number(snapshot?.pendingCount) || 0;
      const pendingBytes = Number(snapshot?.pendingBytes) || 0;
      runtime.telemetry.setInFlightBytes('stage1.postings-queue', {
        count: pendingCount,
        bytes: pendingBytes
      });
    };
    const postingsQueue = postingsQueueConfig
      ? createPostingsQueue({
        ...postingsQueueConfig,
        onChange: updatePostingsTelemetry,
        log
      })
      : null;
    if (postingsQueue) updatePostingsTelemetry({ pendingCount: 0, pendingBytes: 0 });
    if (!postingsQueue) {
      runtime?.telemetry?.clearInFlightBytes?.('stage1.postings-queue');
    }
    if (postingsQueueConfig && runtime?.scheduler?.registerQueue) {
      runtime.scheduler.registerQueue(SCHEDULER_QUEUE_NAMES.stage1Postings, {
        ...(Number.isFinite(postingsQueueConfig.maxPending)
          ? { maxPending: postingsQueueConfig.maxPending }
          : {})
      });
    }
    const schedulePostings = sparsePostingsEnabled && runtime?.scheduler?.schedule
    // Avoid deadlocking the scheduler when Stage1 CPU work is already holding
    // the only CPU token (e.g. --threads 1). Postings apply runs on the same
    // JS thread, so account it against memory/backpressure only.
      ? (fn) => runtime.scheduler.schedule(SCHEDULER_QUEUE_NAMES.stage1Postings, { mem: 1 }, fn)
      : (fn) => fn();
    let checkpoint = null;
    let progress = null;
    let markOrderedEntryComplete = () => false;
    const {
      startOrderIndex,
      expectedOrderIndices
    } = resolveOrderedEntryProgressPlan(entries);
    const resolveResultLifecycleRecord = (result, shardMeta = null) => {
      if (!result || typeof result !== 'object') return null;
      const fromRelKey = result.relKey && lifecycleByRelKey.has(result.relKey)
        ? lifecycleByRelKey.get(result.relKey)
        : null;
      const fromOrderIndex = Number.isFinite(result?.orderIndex)
        ? Math.floor(result.orderIndex)
        : null;
      const resolvedOrderIndex = Number.isFinite(fromRelKey)
        ? fromRelKey
        : (Number.isFinite(fromOrderIndex) ? fromOrderIndex : null);
      if (!Number.isFinite(resolvedOrderIndex)) return null;
      return ensureLifecycleRecord({
        orderIndex: resolvedOrderIndex,
        file: result.relKey || result.abs || null,
        fileIndex: result.fileIndex,
        shardId: shardMeta?.id || null
      });
    };
    const applyFileResult = async (result, stateRef, shardMeta) => {
      if (!result) return;
      const lifecycle = resolveResultLifecycleRecord(result, shardMeta);
      if (lifecycle && !Number.isFinite(lifecycle.writeStartAtMs)) {
        lifecycle.writeStartAtMs = Date.now();
      }
      if (result.fileMetrics) {
        recordFileMetric(perfProfile, result.fileMetrics);
      }
      for (const chunk of result.chunks) {
        appendChunkWithRetention(stateRef, chunk, state);
      }
      if (result.manifestEntry) {
        if (shardMeta?.id) result.manifestEntry.shard = shardMeta.id;
        incrementalState.manifest.files[result.relKey] = result.manifestEntry;
      }
      if (result.fileInfo && result.relKey) {
        if (!stateRef.fileInfoByPath) stateRef.fileInfoByPath = new Map();
        stateRef.fileInfoByPath.set(result.relKey, result.fileInfo);
      }
      if (result.relKey && Array.isArray(result.chunks) && result.chunks.length) {
        if (!stateRef.fileDetailsByPath) stateRef.fileDetailsByPath = new Map();
        if (!stateRef.fileDetailsByPath.has(result.relKey)) {
          const first = result.chunks[0] || {};
          const info = result.fileInfo || {};
          stateRef.fileDetailsByPath.set(result.relKey, {
            file: result.relKey,
            ext: first.ext || fileExt(result.relKey),
            size: Number.isFinite(info.size) ? info.size : (Number.isFinite(first.fileSize) ? first.fileSize : null),
            hash: info.hash || first.fileHash || null,
            hashAlgo: info.hashAlgo || first.fileHashAlgo || null,
            externalDocs: first.externalDocs || null,
            last_modified: first.last_modified || null,
            last_author: first.last_author || null,
            churn: first.churn || null,
            churn_added: first.churn_added || null,
            churn_deleted: first.churn_deleted || null,
            churn_commits: first.churn_commits || null
          });
        }
      }
      if (Array.isArray(result.chunks) && result.chunks.length) {
        if (!stateRef.chunkUidToFile) stateRef.chunkUidToFile = new Map();
        for (const chunk of result.chunks) {
          const chunkUid = chunk?.chunkUid || chunk?.metaV2?.chunkUid || null;
          if (!chunkUid || stateRef.chunkUidToFile.has(chunkUid)) continue;
          stateRef.chunkUidToFile.set(chunkUid, result.relKey);
        }
      }
      if (result.fileRelations) {
        stateRef.fileRelations.set(result.relKey, result.fileRelations);
      }
      if (result.lexiconFilterStats && result.relKey) {
        if (!stateRef.lexiconRelationFilterByFile) {
          stateRef.lexiconRelationFilterByFile = new Map();
        }
        stateRef.lexiconRelationFilterByFile.set(result.relKey, {
          ...result.lexiconFilterStats,
          file: result.relKey
        });
      }
      if (Array.isArray(result.vfsManifestRows) && result.vfsManifestRows.length) {
        if (!stateRef.vfsManifestCollector) {
          stateRef.vfsManifestCollector = createVfsManifestCollector({
            buildRoot: runtime.buildRoot || runtime.root,
            log
          });
          stateRef.vfsManifestRows = null;
          stateRef.vfsManifestStats = stateRef.vfsManifestCollector.stats;
        }
        await stateRef.vfsManifestCollector.appendRows(result.vfsManifestRows, { log });
      }
      if (lifecycle) {
        lifecycle.writeEndAtMs = Date.now();
      }
      const lifecycleDurations = lifecycle ? resolveFileLifecycleDurations(lifecycle) : null;
      stateRef.scannedFilesTimes.push({
        file: result.abs,
        duration_ms: clampDurationMs(result.durationMs),
        cached: result.cached,
        ...(lifecycle
          ? {
            lifecycle: {
              enqueuedAt: toIsoTimestamp(lifecycle.enqueuedAtMs),
              dequeuedAt: toIsoTimestamp(lifecycle.dequeuedAtMs),
              parseStartAt: toIsoTimestamp(lifecycle.parseStartAtMs),
              parseEndAt: toIsoTimestamp(lifecycle.parseEndAtMs),
              writeStartAt: toIsoTimestamp(lifecycle.writeStartAtMs),
              writeEndAt: toIsoTimestamp(lifecycle.writeEndAtMs)
            },
            queue_delay_ms: lifecycleDurations?.queueDelayMs || 0,
            active_duration_ms: lifecycleDurations?.activeDurationMs || 0,
            write_duration_ms: lifecycleDurations?.writeDurationMs || 0
          }
          : {})
      });
      stateRef.scannedFiles.push(result.abs);
      if (result.relKey && Number.isFinite(lifecycle?.orderIndex)) {
        lifecycleByRelKey.delete(result.relKey);
      }
      if (Number.isFinite(lifecycle?.orderIndex)) {
        lifecycleByOrderIndex.delete(lifecycle.orderIndex);
      }
    };
    const orderedAppender = buildOrderedAppender(
      (result, stateRef, shardMeta) => schedulePostings(() => applyFileResult(result, stateRef, shardMeta)),
      state,
      {
        expectedCount: expectedOrderIndices.length || (Array.isArray(entries) ? entries.length : null),
        expectedIndices: expectedOrderIndices,
        startIndex: startOrderIndex,
        bucketSize: coercePositiveInt(runtime?.stage1Queues?.ordered?.bucketSize)
        ?? Math.max(256, runtime.fileConcurrency * 48),
        maxPendingBeforeBackpressure: orderedAppenderConfig.maxPendingBeforeBackpressure,
        maxPendingEmergencyFactor: orderedAppenderConfig.maxPendingEmergencyFactor,
        log: (message, meta = {}) => logLine(message, { ...meta, mode, stage: 'processing' }),
        stallMs: debugOrdered ? 5000 : undefined,
        debugOrdered
      }
    );
    const inFlightFiles = new Map();
    const stage1HangPolicy = resolveStage1HangPolicy(runtime, stageFileWatchdogConfig);
    const stallSnapshotMs = stage1HangPolicy.stallSnapshotMs;
    const progressHeartbeatMs = stage1HangPolicy.progressHeartbeatMs;
    let stage1StallAbortMs = stage1HangPolicy.stallAbortMs;
    const stage1StallSoftKickMs = stage1HangPolicy.stallSoftKickMs;
    const stage1StallSoftKickCooldownMs = stage1HangPolicy.stallSoftKickCooldownMs;
    const stage1StallSoftKickMaxAttempts = stage1HangPolicy.stallSoftKickMaxAttempts;
    const stage1OwnershipPrefix = `${resolveStage1FileSubprocessOwnershipPrefix(runtime, mode)}:`;
    let stage1StallAbortTriggered = false;
    let stage1StallSoftKickAttempts = 0;
    let stage1StallSoftKickSuccessCount = 0;
    let stage1StallSoftKickResetCount = 0;
    let stage1StallSoftKickInFlight = false;
    let lastStallSoftKickAt = 0;
    let activeOrderedCompletionTracker = null;
    let lastProgressAt = Date.now();
    let lastStallSnapshotAt = 0;
    let watchdogAdaptiveLogged = false;
    const getOrderedPendingCount = () => {
      if (!activeOrderedCompletionTracker || typeof activeOrderedCompletionTracker.snapshot !== 'function') {
        return 0;
      }
      const snapshot = activeOrderedCompletionTracker.snapshot();
      return Number(snapshot?.pending) || 0;
    };
    const collectStalledFiles = (limit = 6) => (
      collectStage1StalledFiles(inFlightFiles, { limit })
    );
    const buildProcessingStallSnapshot = ({
      reason = 'stall_snapshot',
      idleMs = null,
      includeStack = false
    } = {}) => buildStage1ProcessingStallSnapshot({
      reason,
      idleMs,
      includeStack,
      lastProgressAt,
      progress,
      processStart,
      inFlightFiles,
      getOrderedPendingCount,
      orderedAppender,
      postingsQueue,
      queueDelaySummary,
      stage1OwnershipPrefix: stage1OwnershipPrefix,
      runtime
    });
    const toStalledFileText = (stalledFiles = []) => formatStage1StalledFileText(stalledFiles);
    const formatSchedulerStallSummary = (snapshot) => formatStage1SchedulerStallSummary(snapshot);
    const summarizeSoftKickCleanup = (cleanupResults = []) => summarizeStage1SoftKickCleanup(cleanupResults);
    const performStage1SoftKick = async ({
      idleMs = 0,
      source = 'watchdog',
      snapshot = null
    } = {}) => {
      if (stage1StallSoftKickInFlight || stage1StallAbortTriggered) return;
      stage1StallSoftKickInFlight = true;
      stage1StallSoftKickAttempts += 1;
      const attempt = stage1StallSoftKickAttempts;
      lastStallSoftKickAt = Date.now();
      const resolvedSnapshot = snapshot || buildProcessingStallSnapshot({
        reason: 'stall_soft_kick',
        idleMs,
        includeStack: true
      });
      const stalledFiles = Array.isArray(resolvedSnapshot?.stalledFiles)
        ? resolvedSnapshot.stalledFiles
        : collectStalledFiles(6);
      const targetedOwnershipIds = Array.from(new Set(
        stalledFiles
          .map((entry) => entry?.ownershipId)
          .filter((value) => typeof value === 'string' && value)
      )).slice(0, 3);
      logLine(
        `[watchdog] soft-kick attempt ${attempt}/${stage1StallSoftKickMaxAttempts} `
          + `idle=${Math.round(clampDurationMs(idleMs) / 1000)}s source=${source} `
          + `targets=${targetedOwnershipIds.length || 0}`,
        {
          kind: 'warning',
          mode,
          stage: 'processing',
          idleMs: clampDurationMs(idleMs),
          source,
          softKickAttempt: attempt,
          softKickMaxAttempts: stage1StallSoftKickMaxAttempts,
          softKickThresholdMs: stage1StallSoftKickMs,
          targetedOwnershipIds,
          watchdogSnapshot: resolvedSnapshot
        }
      );
      try {
        const cleanupResults = [];
        if (targetedOwnershipIds.length > 0) {
          for (const ownershipId of targetedOwnershipIds) {
            cleanupResults.push(await terminateTrackedSubprocesses({
              reason: `stage1_processing_stall_soft_kick:${attempt}:${ownershipId}`,
              force: false,
              ownershipId
            }));
          }
        } else {
          cleanupResults.push(await terminateTrackedSubprocesses({
            reason: `stage1_processing_stall_soft_kick:${attempt}:prefix`,
            force: false,
            ownershipPrefix: stage1OwnershipPrefix
          }));
        }
        const cleanupSummary = summarizeSoftKickCleanup(cleanupResults);
        if (cleanupSummary.attempted > 0 && cleanupSummary.failures < cleanupSummary.attempted) {
          stage1StallSoftKickSuccessCount += 1;
        }
        logLine(
          `[watchdog] soft-kick result attempt=${attempt} attempted=${cleanupSummary.attempted} `
            + `failures=${cleanupSummary.failures} terminatedPids=${cleanupSummary.terminatedPids.length}`,
          {
            kind: cleanupSummary.failures > 0 ? 'warning' : 'status',
            mode,
            stage: 'processing',
            idleMs: clampDurationMs(idleMs),
            source,
            softKickAttempt: attempt,
            softKickResult: cleanupSummary
          }
        );
      } catch (error) {
        logLine(
          `[watchdog] soft-kick attempt ${attempt} failed: ${error?.message || error}`,
          {
            kind: 'warning',
            mode,
            stage: 'processing',
            idleMs: clampDurationMs(idleMs),
            source,
            softKickAttempt: attempt
          }
        );
      } finally {
        stage1StallSoftKickInFlight = false;
      }
    };
    const evaluateStalledProcessing = (source = 'watchdog') => {
      if (!progress || stage1StallAbortTriggered) return;
      const orderedPending = getOrderedPendingCount();
      if (progress.count >= progress.total && inFlightFiles.size === 0 && orderedPending === 0) return;
      const now = Date.now();
      const idleMs = Math.max(0, now - lastProgressAt);
      const decision = resolveStage1StallAction({
        idleMs,
        hardAbortMs: stage1StallAbortMs,
        softKickMs: stage1StallSoftKickMs,
        softKickAttempts: stage1StallSoftKickAttempts,
        softKickMaxAttempts: stage1StallSoftKickMaxAttempts,
        softKickInFlight: stage1StallSoftKickInFlight,
        lastSoftKickAtMs: lastStallSoftKickAt,
        softKickCooldownMs: stage1StallSoftKickCooldownMs,
        nowMs: now
      });
      if (decision.action === 'none') return;
      const snapshot = buildProcessingStallSnapshot({
        reason: decision.action === 'abort' ? 'stall_timeout' : 'stall_soft_kick',
        idleMs,
        includeStack: true
      });
      if (decision.action === 'soft-kick') {
        void performStage1SoftKick({
          idleMs,
          source,
          snapshot
        });
        return;
      }
      stage1StallAbortTriggered = true;
      const err = createTimeoutError({
        message: `Stage1 processing stalled for ${idleMs}ms at ${progress.count}/${progress.total}`,
        code: 'FILE_PROCESS_STALL_TIMEOUT',
        retryable: false,
        meta: {
          idleMs,
          progressDone: progress.count,
          progressTotal: progress.total,
          inFlight: inFlightFiles.size,
          orderedPending,
          trackedSubprocesses: Number(snapshot?.trackedSubprocesses?.total) || 0,
          softKickAttempts: stage1StallSoftKickAttempts
        }
      });
      logLine(
        `[watchdog] stall-timeout idle=${Math.round(idleMs / 1000)}s progress=${progress.count}/${progress.total}; aborting stage1.`,
        {
          kind: 'error',
          mode,
          stage: 'processing',
          source,
          code: err.code,
          idleMs,
          progressDone: progress.count,
          progressTotal: progress.total,
          inFlight: inFlightFiles.size,
          orderedPending,
          softKickAttempts: stage1StallSoftKickAttempts,
          softKickThresholdMs: stage1StallSoftKickMs,
          stallAbortMs: stage1StallAbortMs,
          watchdogSnapshot: snapshot
        }
      );
      const schedulerSummary = formatSchedulerStallSummary(snapshot?.scheduler);
      if (schedulerSummary) {
        logLine(`[watchdog] scheduler snapshot: ${schedulerSummary}`, {
          kind: 'error',
          mode,
          stage: 'processing',
          scheduler: snapshot?.scheduler || null
        });
      }
      if (Array.isArray(snapshot?.stalledFiles) && snapshot.stalledFiles.length) {
        logLine(`[watchdog] stalled files: ${toStalledFileText(snapshot.stalledFiles)}`, {
          kind: 'error',
          mode,
          stage: 'processing'
        });
      }
      const stackFrames = Array.isArray(snapshot?.process?.stack?.frames)
        ? snapshot.process.stack.frames
        : [];
      if (stackFrames.length > 0) {
        logLine(`[watchdog] stack snapshot: ${stackFrames.slice(0, 3).join(' | ')}`, {
          kind: 'error',
          mode,
          stage: 'processing'
        });
      }
      orderedAppender.abort(err);
      abortProcessing(err);
      void terminateTrackedSubprocesses({
        reason: 'stage1_processing_stall_timeout',
        force: false
      }).then((cleanup) => {
        if (!cleanup || cleanup.attempted <= 0) return;
        logLine(
          `[watchdog] cleaned ${cleanup.attempted} tracked subprocess(es) after stage1 stall-timeout.`,
          {
            kind: 'warning',
            mode,
            stage: 'processing',
            cleanup
          }
        );
      }).catch(() => {});
    };
    const emitProcessingStallSnapshot = () => {
      if (stallSnapshotMs <= 0 || !progress) return;
      const orderedPending = getOrderedPendingCount();
      if (progress.count >= progress.total && inFlightFiles.size === 0 && orderedPending === 0) return;
      const now = Date.now();
      const idleMs = Math.max(0, now - lastProgressAt);
      if (idleMs < stallSnapshotMs) return;
      if (lastStallSnapshotAt > 0 && now - lastStallSnapshotAt < 30000) return;
      lastStallSnapshotAt = now;
      const includeStack = (stage1StallSoftKickMs > 0 && idleMs >= stage1StallSoftKickMs)
        || (stage1StallAbortMs > 0 && idleMs >= stage1StallAbortMs);
      const snapshot = buildProcessingStallSnapshot({
        reason: 'stall_snapshot',
        idleMs,
        includeStack
      });
      const trackedSubprocesses = Number(snapshot?.trackedSubprocesses?.total) || 0;
      logLine(
        `[watchdog] stall snapshot idle=${Math.round(idleMs / 1000)}s progress=${progress.count}/${progress.total} `
          + `next=${snapshot?.orderedSnapshot?.nextIndex ?? '?'} pending=${snapshot?.orderedSnapshot?.pendingCount ?? '?'} `
          + `orderedPending=${snapshot?.orderedPending ?? 0} inFlight=${inFlightFiles.size} `
          + `trackedSubprocesses=${trackedSubprocesses}`,
        {
          kind: 'warning',
          mode,
          stage: 'processing',
          progressDone: progress.count,
          progressTotal: progress.total,
          idleMs,
          orderedSnapshot: snapshot?.orderedSnapshot || null,
          orderedPending: snapshot?.orderedPending || 0,
          postingsPending: snapshot?.postingsSnapshot?.pending || null,
          stalledFiles: snapshot?.stalledFiles || [],
          trackedSubprocesses,
          watchdogSnapshot: snapshot
        }
      );
      const schedulerSummary = formatSchedulerStallSummary(snapshot?.scheduler);
      if (schedulerSummary) {
        logLine(`[watchdog] scheduler snapshot: ${schedulerSummary}`, {
          kind: 'warning',
          mode,
          stage: 'processing',
          scheduler: snapshot?.scheduler || null
        });
      }
      if (Array.isArray(snapshot?.stalledFiles) && snapshot.stalledFiles.length) {
        logLine(`[watchdog] oldest in-flight: ${toStalledFileText(snapshot.stalledFiles)}`, {
          kind: 'warning',
          mode,
          stage: 'processing'
        });
      }
      const trackedEntries = Array.isArray(snapshot?.trackedSubprocesses?.entries)
        ? snapshot.trackedSubprocesses.entries
        : [];
      if (trackedEntries.length > 0) {
        const trackedText = trackedEntries
          .map((entry) => `${entry.pid ?? '?'}:${entry.ownershipId || entry.scope || 'unknown'}`)
          .join(', ');
        logLine(`[watchdog] tracked subprocess snapshot: ${trackedText}`, {
          kind: 'warning',
          mode,
          stage: 'processing'
        });
      }
      evaluateStalledProcessing('stall_snapshot');
    };
    const emitProcessingProgressHeartbeat = () => {
      if (progressHeartbeatMs <= 0 || !progress) return;
      const orderedPending = getOrderedPendingCount();
      if (progress.count >= progress.total && inFlightFiles.size === 0 && orderedPending === 0) return;
      const now = Date.now();
      const trackedSubprocesses = snapshotTrackedSubprocesses({
        ownershipPrefix: stage1OwnershipPrefix,
        limit: 1
      }).total;
      const oldestInFlight = collectStalledFiles(3)
        .map((entry) => `${entry.file || 'unknown'}@${Math.round((entry.elapsedMs || 0) / 1000)}s`);
      const oldestText = oldestInFlight.length ? ` oldest=${oldestInFlight.join(',')}` : '';
      logLine(
        `${buildFileProgressHeartbeatText({
          count: progress.count,
          total: progress.total,
          startedAtMs: processStart,
          nowMs: now,
          inFlight: inFlightFiles.size,
          trackedSubprocesses
        })} orderedPending=${orderedPending}${oldestText}`,
        {
          kind: 'status',
          mode,
          stage: 'processing',
          progressDone: progress.count,
          progressTotal: progress.total,
          inFlight: inFlightFiles.size,
          orderedPending,
          trackedSubprocesses,
          oldestInFlight
        }
      );
      evaluateStalledProcessing('progress_heartbeat');
    };
    logLine(
      `[watchdog] stage1 hang policy heartbeat=${progressHeartbeatMs}ms snapshot=${stallSnapshotMs}ms `
        + `softKick=${stage1StallSoftKickMs}ms abort=${stage1StallAbortMs}ms `
        + `softKickMaxAttempts=${stage1StallSoftKickMaxAttempts}`,
      {
        kind: 'status',
        mode,
        stage: 'processing',
        watchdogPolicy: {
          heartbeatMs: progressHeartbeatMs,
          snapshotMs: stallSnapshotMs,
          softKickMs: stage1StallSoftKickMs,
          softKickCooldownMs: stage1StallSoftKickCooldownMs,
          softKickMaxAttempts: stage1StallSoftKickMaxAttempts,
          abortMs: stage1StallAbortMs
        }
      }
    );
    const processEntries = async ({ entries: shardEntries, runtime: runtimeRef, shardMeta = null, stateRef }) => {
      const shardLabel = shardMeta?.label || shardMeta?.id || null;
      const shardProgress = shardMeta
        ? {
          total: shardEntries.length,
          count: 0,
          meta: {
            taskId: `shard:${shardMeta.id}:${shardMeta.partIndex || 1}`,
            stage: 'processing',
            mode,
            shardId: shardMeta.id,
            shardIndex: shardMeta.shardIndex || null,
            shardTotal: shardMeta.shardTotal || null,
            message: shardMeta.display || shardLabel || shardMeta.id,
            ephemeral: true
          }
        }
        : null;
      const { processFile } = createFileProcessor({
        root: runtimeRef.root,
        mode,
        fileTextCache,
        treeSitterScheduler,
        dictConfig: runtimeRef.dictConfig,
        dictWords: runtimeRef.dictWords,
        dictShared: runtimeRef.dictShared,
        codeDictWords: runtimeRef.codeDictWords,
        codeDictWordsByLanguage: runtimeRef.codeDictWordsByLanguage,
        codeDictLanguages: runtimeRef.codeDictLanguages,
        scmProvider: runtimeRef.scmProvider,
        scmProviderImpl: runtimeRef.scmProviderImpl,
        scmRepoRoot: runtimeRef.scmRepoRoot,
        scmConfig: runtimeRef.scmConfig,
        scmFileMetaByPath,
        scmMetaCache: sharedScmMetaCache,
        languageOptions: runtimeRef.languageOptions,
        postingsConfig: runtimeRef.postingsConfig,
        segmentsConfig: runtimeRef.segmentsConfig,
        commentsConfig: runtimeRef.commentsConfig,
        contextWin,
        incrementalState,
        getChunkEmbedding: runtimeRef.getChunkEmbedding,
        getChunkEmbeddings: runtimeRef.getChunkEmbeddings,
        embeddingBatchSize: runtimeRef.embeddingBatchSize,
        embeddingEnabled: runtimeRef.embeddingEnabled,
        embeddingNormalize: runtimeRef.embeddingNormalize,
        analysisPolicy: runtimeRef.analysisPolicy,
        typeInferenceEnabled: runtimeRef.typeInferenceEnabled,
        riskAnalysisEnabled: runtimeRef.riskAnalysisEnabled,
        tokenizeEnabled,
        riskConfig: runtimeRef.riskConfig,
        toolInfo: runtimeRef.toolInfo,
        seenFiles,
        gitBlameEnabled: runtimeRef.gitBlameEnabled,
        lintEnabled: runtimeRef.lintEnabled,
        complexityEnabled: runtimeRef.complexityEnabled,
        tokenizationStats,
        structuralMatches,
        documentExtractionConfig: runtimeRef.indexingConfig?.documentExtraction || null,
        documentExtractionCache,
        extractedProseYieldProfile: extractedProseYieldProfilePrefilter,
        cacheConfig: runtimeRef.cacheConfig,
        cacheReporter,
        queues: runtimeRef.queues,
        useCpuQueue: false,
        workerPool: runtimeRef.workerPool,
        crashLogger,
        relationsEnabled,
        skippedFiles: stateRef.skippedFiles,
        fileCaps: runtimeRef.fileCaps,
        maxFileBytes: runtimeRef.maxFileBytes,
        fileScan: runtimeRef.fileScan,
        generatedPolicy: runtimeRef.generatedPolicy,
        featureMetrics: runtimeRef.featureMetrics,
        perfEventLogger,
        buildStage: runtimeRef.stage,
        extractedProseExtrasCache,
        primeExtractedProseExtrasCache,
        abortSignal: effectiveAbortSignal
      });
      const fileWatchdogConfig = resolveFileWatchdogConfig(runtimeRef, { repoFileCount });
      if (stage1StallAbortMs > 0 && !stallAbortTimer) {
        const pollMs = Math.max(2000, Math.min(10000, Math.floor(stage1StallAbortMs / 6)));
        stallAbortTimer = setInterval(() => {
          evaluateStalledProcessing('stall_poll_timer');
        }, pollMs);
        stallAbortTimer.unref?.();
      }
      if (!watchdogAdaptiveLogged && Number(fileWatchdogConfig.adaptiveSlowFloorMs) > 0) {
        watchdogAdaptiveLogged = true;
        log(
          `[watchdog] large repo detected (${repoFileCount.toLocaleString()} files); `
          + `slow-file base threshold raised to ${fileWatchdogConfig.slowFileMs}ms.`
        );
      }
      const runEntryBatch = async (batchEntries) => {
        const orderedCompletionTracker = createOrderedCompletionTracker();
        const orderedWaitRecoveryPollMs = Math.max(
          200,
          Math.min(2000, Math.floor((stage1HangPolicy?.progressHeartbeatMs || 1000) / 2))
        );
        const recoverMissingOrderedGap = (source = 'ordered_wait', stallCount = 0) => {
          if (typeof orderedAppender?.recoverMissingRange !== 'function') return 0;
          if (inFlightFiles.size > 0) return 0;
          const trackerSnapshot = typeof orderedCompletionTracker.snapshot === 'function'
            ? orderedCompletionTracker.snapshot()
            : null;
          const pendingCount = Number(trackerSnapshot?.pending) || 0;
          if (pendingCount <= 0) return 0;
          const recovery = orderedAppender.recoverMissingRange({
            reason: stallCount > 0 ? `${source}:${stallCount}` : source
          });
          const recoveredCount = Number(recovery?.recovered) || 0;
          if (recoveredCount > 0) {
            lastProgressAt = Date.now();
            logLine(
              `[ordered] recovered ${recoveredCount} missing indices at queue-drain (${source}).`,
              {
                kind: 'warning',
                mode,
                stage: 'processing',
                source,
                recoveredCount,
                recovery
              }
            );
          }
          return recoveredCount;
        };
        const orderedBatchEntries = sortEntriesByOrderIndex(batchEntries);
        for (let i = 0; i < orderedBatchEntries.length; i += 1) {
          const entry = orderedBatchEntries[i];
          const orderIndex = resolveEntryOrderIndex(entry, i);
          const lifecycle = ensureLifecycleRecord({
            orderIndex,
            file: entry?.rel || toPosix(path.relative(runtimeRef.root, entry?.abs || '')),
            fileIndex: Number.isFinite(entry?.fileIndex) ? entry.fileIndex : null,
            shardId: shardMeta?.id || null
          });
          if (lifecycle && !Number.isFinite(lifecycle.enqueuedAtMs)) {
            lifecycle.enqueuedAtMs = Date.now();
          }
        }
        activeOrderedCompletionTracker = orderedCompletionTracker;
        try {
          await runWithQueue(
            runtimeRef.queues.cpu,
            orderedBatchEntries,
            async (entry, ctx) => {
              const queueIndex = Number.isFinite(ctx?.index) ? ctx.index : null;
              const orderIndex = resolveEntryOrderIndex(entry, queueIndex);
              const stableFileIndex = Number.isFinite(entry?.fileIndex)
                ? entry.fileIndex
                : (Number.isFinite(queueIndex) ? queueIndex + 1 : null);
              const rel = entry.rel || toPosix(path.relative(runtimeRef.root, entry.abs));
              if (shouldSkipExtractedProseForLowYield({
                bailout: extractedProseLowYieldBailout,
                orderIndex
              })) {
                const skippedAtMs = Date.now();
                const lifecycle = ensureLifecycleRecord({
                  orderIndex,
                  file: rel,
                  fileIndex: stableFileIndex,
                  shardId: shardMeta?.id || null
                });
                if (lifecycle) {
                  lifecycle.dequeuedAtMs = lifecycle.dequeuedAtMs ?? skippedAtMs;
                  lifecycle.parseStartAtMs = lifecycle.parseStartAtMs ?? skippedAtMs;
                  lifecycle.parseEndAtMs = skippedAtMs;
                  lifecycle.writeStartAtMs = skippedAtMs;
                  lifecycle.writeEndAtMs = skippedAtMs;
                }
                if (Array.isArray(stateRef.skippedFiles)) {
                  stateRef.skippedFiles.push({
                    file: rel,
                    reason: EXTRACTED_PROSE_LOW_YIELD_SKIP_REASON,
                    stage: 'process-files',
                    mode: 'extracted-prose',
                    qualityImpact: 'reduced-extracted-prose-recall'
                  });
                }
                extractedProseLowYieldBailout.skippedFiles += 1;
                return null;
              }
              const activeStartAtMs = Date.now();
              const fileWatchdogMs = resolveFileWatchdogMs(fileWatchdogConfig, entry);
              const fileHardTimeoutMs = resolveFileHardTimeoutMs(fileWatchdogConfig, entry, fileWatchdogMs);
              const fileSubprocessOwnershipId = buildStage1FileSubprocessOwnershipId({
                runtime: runtimeRef,
                mode,
                fileIndex: stableFileIndex,
                rel,
                shardId: shardMeta?.id || null
              });
              let watchdog = null;
              const lifecycle = ensureLifecycleRecord({
                orderIndex,
                file: rel,
                fileIndex: stableFileIndex,
                shardId: shardMeta?.id || null
              });
              if (lifecycle) {
                if (!Number.isFinite(lifecycle.dequeuedAtMs)) {
                  lifecycle.dequeuedAtMs = activeStartAtMs;
                }
                if (!Number.isFinite(lifecycle.parseStartAtMs)) {
                  lifecycle.parseStartAtMs = activeStartAtMs;
                }
                if (!Number.isFinite(lifecycle.scmProcQueueWaitMs)) {
                  lifecycle.scmProcQueueWaitMs = 0;
                }
                const lifecycleDurations = resolveFileLifecycleDurations(lifecycle);
                observeQueueDelay(lifecycleDurations.queueDelayMs);
              }
              if (Number.isFinite(orderIndex)) {
                inFlightFiles.set(orderIndex, {
                  orderIndex,
                  file: rel,
                  fileIndex: stableFileIndex,
                  shardId: shardMeta?.id || null,
                  ownershipId: fileSubprocessOwnershipId,
                  startedAt: activeStartAtMs
                });
              }
              if (fileWatchdogMs > 0) {
                watchdog = setTimeout(() => {
                  const activeDurationMs = Math.max(0, Date.now() - activeStartAtMs);
                  const lifecycleDurations = lifecycle
                    ? resolveFileLifecycleDurations(lifecycle)
                    : null;
                  const scmProcQueueWaitMs = lifecycleDurations?.scmProcQueueWaitMs || 0;
                  const effectiveDurationMs = resolveEffectiveSlowFileDurationMs({
                    activeDurationMs,
                    scmProcQueueWaitMs
                  });
                  if (!shouldTriggerSlowFileWarning({
                    activeDurationMs,
                    thresholdMs: fileWatchdogMs,
                    scmProcQueueWaitMs
                  })) {
                    return;
                  }
                  const queueDelayMs = lifecycleDurations?.queueDelayMs || 0;
                  const lineText = Number.isFinite(entry.lines) ? ` lines ${entry.lines}` : '';
                  logLine(`[watchdog] slow file ${stableFileIndex ?? '?'} ${rel} (${Math.round(effectiveDurationMs)}ms)${lineText}`, {
                    kind: 'file-watchdog',
                    mode,
                    stage: 'processing',
                    file: rel,
                    fileIndex: stableFileIndex,
                    total: progress.total,
                    lines: entry.lines || null,
                    durationMs: effectiveDurationMs,
                    effectiveDurationMs,
                    activeDurationMs,
                    scmProcQueueWaitMs,
                    queueDelayMs,
                    thresholdMs: fileWatchdogMs
                  });
                }, fileWatchdogMs);
                watchdog.unref?.();
              }
              if (showFileProgress) {
                const shardText = shardLabel ? `shard ${shardLabel}` : 'shard';
                const shardPrefix = `[${shardText}]`;
                const countText = `${stableFileIndex ?? '?'}/${progress.total}`;
                const lineText = Number.isFinite(entry.lines) ? `lines ${entry.lines}` : null;
                const parts = [shardPrefix, countText, lineText, rel].filter(Boolean);
                logLine(parts.join(' '), {
                  kind: 'file-progress',
                  mode,
                  stage: 'processing',
                  shardId: shardMeta?.id || null,
                  file: rel,
                  fileIndex: stableFileIndex,
                  total: progress.total,
                  lines: entry.lines || null
                });
              }
              crashLogger.updateFile({
                phase: 'processing',
                mode,
                stage: runtimeRef.stage,
                fileIndex: stableFileIndex,
                total: progress.total,
                file: entry.rel,
                size: entry.stat?.size || null,
                shardId: shardMeta?.id || null
              });
              try {
                return await runWithTimeout(
                  (signal) => withTrackedSubprocessSignalScope(
                    signal,
                    fileSubprocessOwnershipId,
                    () => processFile(entry, stableFileIndex, {
                      signal,
                      onScmProcQueueWait: (queueWaitMs) => {
                        if (!(Number.isFinite(queueWaitMs) && queueWaitMs > 0)) return;
                        if (lifecycle) {
                          lifecycle.scmProcQueueWaitMs = (Number(lifecycle.scmProcQueueWaitMs) || 0) + queueWaitMs;
                        }
                      }
                    })
                  ),
                  {
                    timeoutMs: fileHardTimeoutMs,
                    signal: effectiveAbortSignal,
                    errorFactory: () => createTimeoutError({
                      message: `File processing timed out after ${fileHardTimeoutMs}ms (${rel})`,
                      code: 'FILE_PROCESS_TIMEOUT',
                      retryable: false,
                      meta: {
                        file: rel,
                        fileIndex: stableFileIndex,
                        timeoutMs: fileHardTimeoutMs,
                        ownershipId: fileSubprocessOwnershipId
                      }
                    })
                  }
                );
              } catch (err) {
                if (err?.code === 'FILE_PROCESS_TIMEOUT') {
                  logLine(
                    `[watchdog] hard-timeout file ${stableFileIndex ?? '?'} ${rel} (${fileHardTimeoutMs}ms)`,
                    {
                      kind: 'warning',
                      mode,
                      stage: 'processing',
                      file: rel,
                      fileIndex: stableFileIndex,
                      timeoutMs: fileHardTimeoutMs,
                      ownershipId: fileSubprocessOwnershipId,
                      shardId: shardMeta?.id || null
                    }
                  );
                  const cleanup = await terminateTrackedSubprocesses({
                    reason: `stage1_file_timeout:${fileSubprocessOwnershipId}`,
                    force: false,
                    ownershipId: fileSubprocessOwnershipId
                  });
                  if (cleanup?.attempted > 0) {
                    const terminatedPids = Array.isArray(cleanup.terminatedPids)
                      ? cleanup.terminatedPids
                      : [];
                    const terminatedOwnershipIds = Array.isArray(cleanup.terminatedOwnershipIds)
                      ? cleanup.terminatedOwnershipIds
                      : [];
                    logLine(
                      `[watchdog] cleaned ${cleanup.attempted} tracked subprocess(es) after timeout (scoped) `
                        + `pids=${terminatedPids.length ? terminatedPids.join(',') : 'none'} `
                        + `ownership=${terminatedOwnershipIds.length ? terminatedOwnershipIds.join(',') : fileSubprocessOwnershipId}`,
                      {
                        kind: 'warning',
                        mode,
                        stage: 'processing',
                        file: rel,
                        fileIndex: stableFileIndex,
                        timeoutMs: fileHardTimeoutMs,
                        cleanupScope: fileSubprocessOwnershipId,
                        cleanupOwnershipId: fileSubprocessOwnershipId,
                        cleanupTerminatedPids: terminatedPids,
                        cleanupTerminatedOwnershipIds: terminatedOwnershipIds,
                        cleanupKillAudit: Array.isArray(cleanup.killAudit) ? cleanup.killAudit : [],
                        cleanup
                      }
                    );
                  }
                }
                crashLogger.logError({
                  phase: 'processing',
                  mode,
                  stage: runtimeRef.stage,
                  fileIndex: stableFileIndex,
                  total: progress.total,
                  file: entry.rel,
                  size: entry.stat?.size || null,
                  shardId: shardMeta?.id || null,
                  message: err?.message || String(err),
                  stack: err?.stack || null
                });
                throw err;
              } finally {
                const activeDurationMs = Math.max(0, Date.now() - activeStartAtMs);
                const scmProcQueueWaitMs = lifecycle
                  ? (resolveFileLifecycleDurations(lifecycle).scmProcQueueWaitMs || 0)
                  : 0;
                const effectiveDurationMs = resolveEffectiveSlowFileDurationMs({
                  activeDurationMs,
                  scmProcQueueWaitMs
                });
                const triggeredSlowWarning = shouldTriggerSlowFileWarning({
                  activeDurationMs,
                  thresholdMs: fileWatchdogMs,
                  scmProcQueueWaitMs
                });
                observeWatchdogNearThreshold({
                  activeDurationMs: effectiveDurationMs,
                  thresholdMs: fileWatchdogMs,
                  triggeredSlowWarning,
                  lowerFraction: fileWatchdogConfig?.nearThresholdLowerFraction,
                  upperFraction: fileWatchdogConfig?.nearThresholdUpperFraction
                });
                if (lifecycle) {
                  lifecycle.parseEndAtMs = Date.now();
                }
                if (watchdog) {
                  clearTimeout(watchdog);
                }
                if (Number.isFinite(orderIndex)) {
                  inFlightFiles.delete(orderIndex);
                }
              }
            },
            {
              collectResults: false,
              signal: effectiveAbortSignal,
              onBeforeDispatch: async (ctx) => {
                if (typeof orderedAppender.waitForCapacity === 'function') {
                  const entryIndex = Number.isFinite(ctx?.index) ? ctx.index : 0;
                  const entry = orderedBatchEntries[entryIndex];
                  const orderIndex = resolveEntryOrderIndex(entry, entryIndex);
                  const dispatchBypassWindow = Math.max(1, Math.floor(runtimeRef.fileConcurrency || 1));
                  await orderedAppender.waitForCapacity({
                    orderIndex,
                    bypassWindow: dispatchBypassWindow
                  });
                }
                orderedCompletionTracker.throwIfFailed();
              },
              onResult: async (result, ctx) => {
                const entryIndex = Number.isFinite(ctx?.index) ? ctx.index : 0;
                const entry = orderedBatchEntries[entryIndex];
                const orderIndex = resolveEntryOrderIndex(entry, entryIndex);
                observeExtractedProseYieldProfileResult({
                  observation: extractedProseYieldProfileObservation,
                  entry,
                  result,
                  runtimeRoot: runtimeRef.root
                });
                const bailoutDecision = observeExtractedProseLowYieldSample({
                  bailout: extractedProseLowYieldBailout,
                  orderIndex,
                  result
                });
                if (bailoutDecision?.triggered) {
                  const ratioPct = (bailoutDecision.observedYieldRatio * 100).toFixed(1);
                  logLine(
                    `[stage1:extracted-prose] low-yield bailout engaged after `
                      + `${bailoutDecision.observedSamples} warmup files `
                      + `(yield=${bailoutDecision.yieldedSamples}, ratio=${ratioPct}%, `
                      + `threshold=${Math.round(bailoutDecision.minYieldRatio * 100)}%).`,
                    {
                      kind: 'warning',
                      mode,
                      stage: 'processing',
                      qualityImpact: 'reduced-extracted-prose-recall',
                      extractedProseLowYieldBailout: bailoutDecision
                    }
                  );
                }
                markOrderedEntryComplete(orderIndex, shardProgress);
                if (!result) {
                  if (entry?.rel) lifecycleByRelKey.delete(entry.rel);
                  if (Number.isFinite(orderIndex)) {
                    lifecycleByOrderIndex.delete(Math.floor(orderIndex));
                  }
                  return orderedAppender.skip(orderIndex);
                }
                if (Number.isFinite(orderIndex)) {
                  result.orderIndex = Math.floor(orderIndex);
                }
                if (result?.relKey && Number.isFinite(orderIndex)) {
                  lifecycleByRelKey.set(result.relKey, Math.floor(orderIndex));
                }
                const lifecycle = ensureLifecycleRecord({
                  orderIndex,
                  file: result?.relKey || entry?.rel || null,
                  fileIndex: result?.fileIndex ?? entry?.fileIndex ?? null,
                  shardId: shardMeta?.id || null
                });
                if (lifecycle && !Number.isFinite(lifecycle.parseEndAtMs)) {
                  lifecycle.parseEndAtMs = Date.now();
                }
                const fileMetrics = result?.fileMetrics;
                if (fileMetrics && typeof fileMetrics === 'object') {
                  const bytes = Math.max(0, Math.floor(Number(fileMetrics.bytes) || 0));
                  const lines = Math.max(0, Math.floor(Number(fileMetrics.lines) || 0));
                  const languageId = fileMetrics.languageId || getLanguageForFile(entry?.ext, entry?.rel)?.id || 'unknown';
                  recordStageTimingSample('parseChunk', {
                    languageId,
                    bytes,
                    lines,
                    durationMs: clampDurationMs(fileMetrics.parseMs) + clampDurationMs(fileMetrics.tokenizeMs)
                  });
                  recordStageTimingSample('inference', {
                    languageId,
                    bytes,
                    lines,
                    durationMs: clampDurationMs(fileMetrics.enrichMs)
                  });
                  recordStageTimingSample('embedding', {
                    languageId,
                    bytes,
                    lines,
                    durationMs: clampDurationMs(fileMetrics.embeddingMs)
                  });
                }
                const reservation = sparsePostingsEnabled && postingsQueue
                  ? await (() => {
                    const payload = estimatePostingsPayload(result);
                    const nextOrderedIndex = typeof orderedAppender.peekNextIndex === 'function'
                      ? orderedAppender.peekNextIndex()
                      : null;
                    const bypassBackpressure = shouldBypassPostingsBackpressure({
                      orderIndex,
                      nextOrderedIndex,
                      bypassWindow: orderedAppenderConfig.maxPendingBeforeBackpressure
                    });
                    return postingsQueue.reserve({
                      ...payload,
                      bypass: bypassBackpressure
                    });
                  })()
                  : { release: () => {} };
                const completion = orderedAppender.enqueue(orderIndex, result, shardMeta);
                orderedCompletionTracker.track(completion, () => {
                  reservation.release();
                });
              },
              onError: async (err, ctx) => {
                const entryIndex = Number.isFinite(ctx?.index) ? ctx.index : 0;
                const entry = orderedBatchEntries[entryIndex];
                const orderIndex = resolveEntryOrderIndex(entry, entryIndex);
                observeExtractedProseLowYieldSample({
                  bailout: extractedProseLowYieldBailout,
                  orderIndex,
                  result: null
                });
                const rel = entry?.rel || toPosix(path.relative(runtimeRef.root, entry?.abs || ''));
                const timeoutText = err?.code === 'FILE_PROCESS_TIMEOUT' && Number.isFinite(err?.meta?.timeoutMs)
                  ? ` timeout=${err.meta.timeoutMs}ms`
                  : '';
                logLine(
                  `[ordered] skipping failed file ${orderIndex} ${rel}${timeoutText} (${err?.message || err})`,
                  {
                    kind: 'warning',
                    mode,
                    stage: 'processing',
                    file: rel,
                    fileIndex: entry?.fileIndex || null,
                    shardId: shardMeta?.id || null
                  }
                );
                markOrderedEntryComplete(orderIndex, shardProgress);
                if (entry?.rel) lifecycleByRelKey.delete(entry.rel);
                if (Number.isFinite(orderIndex)) {
                  lifecycleByOrderIndex.delete(Math.floor(orderIndex));
                }
                await orderedAppender.skip(orderIndex);
              },
              retries: 2,
              retryDelayMs: 200
            }
          );
          recoverMissingOrderedGap('queue_drain_pre_wait');
          await orderedCompletionTracker.wait({
            stallPollMs: orderedWaitRecoveryPollMs,
            onStall: ({ stallCount }) => {
              orderedCompletionTracker.throwIfFailed();
              recoverMissingOrderedGap('queue_drain_wait', stallCount);
            }
          });
        } finally {
          if (activeOrderedCompletionTracker === orderedCompletionTracker) {
            activeOrderedCompletionTracker = null;
          }
        }
      };
      try {
        await runEntryBatch(shardEntries);
      } catch (err) {
        const retryEnabled = shardMeta?.allowRetry === true;
        if (!retryEnabled) {
          // If the shard processing fails before a contiguous `orderIndex` is
          // enqueued, later tasks may be blocked waiting for an ordered flush.
          // Abort rejects any waiting promises to prevent hangs/leaks.
          orderedAppender.abort(err);
        }
        throw err;
      }
    };

    const discoveryLineCounts = discovery?.lineCounts instanceof Map ? discovery.lineCounts : null;
    const clusterModeEnabled = runtime.shards?.cluster?.enabled === true;
    const clusterDeterministicMerge = runtime.shards?.cluster?.deterministicMerge !== false;
    let lineCounts = discoveryLineCounts;
    if (runtime.shards?.enabled && !lineCounts) {
      const hasEntryLines = entries.some((entry) => Number.isFinite(entry?.lines) && entry.lines > 0);
      if (!hasEntryLines) {
        const lineStart = Date.now();
        const lineConcurrency = Math.max(1, Math.min(128, runtime.cpuConcurrency * 2));
        if (envConfig.verbose === true) {
          log(`→ Shard planning: counting lines (${lineConcurrency} workers)...`);
        }
        lineCounts = await countLinesForEntries(entries, { concurrency: lineConcurrency });
        timing.lineCountsMs = Date.now() - lineStart;
      }
    }
    const shardFeatureWeights = {
      relations: relationsEnabled ? 0.15 : 0,
      flow: (runtime.astDataflowEnabled || runtime.controlFlowEnabled) ? 0.1 : 0,
      treeSitter: runtime.languageOptions?.treeSitter?.enabled !== false ? 0.1 : 0,
      tooling: runtime.toolingEnabled ? 0.1 : 0,
      embeddings: runtime.embeddingEnabled ? 0.2 : 0
    };
    const shardPlan = runtime.shards?.enabled
      ? planShards(entries, {
        mode,
        maxShards: runtime.shards.maxShards,
        minFiles: runtime.shards.minFiles,
        dirDepth: runtime.shards.dirDepth,
        lineCounts,
        perfProfile: shardPerfProfile,
        featureWeights: shardFeatureWeights,
        maxShardBytes: runtime.shards.maxShardBytes,
        maxShardLines: runtime.shards.maxShardLines
      })
      : null;
    let shardSummary = shardPlan
      ? shardPlan.map((shard) => ({
        id: shard.id,
        label: shard.label || shard.id,
        dir: shard.dir,
        lang: shard.lang,
        fileCount: shard.entries.length,
        lineCount: shard.lineCount || 0,
        byteCount: shard.byteCount || 0,
        costMs: shard.costMs || 0
      }))
      : [];
    const clusterRetryConfig = resolveClusterSubsetRetryConfig(runtime);
    let shardExecutionMeta = runtime.shards?.enabled
      ? {
        enabled: true,
        mode: clusterModeEnabled ? 'cluster' : 'local',
        mergeOrder: clusterDeterministicMerge ? 'stable' : 'adaptive',
        deterministicMerge: clusterDeterministicMerge,
        shardCount: Array.isArray(shardPlan) ? shardPlan.length : 0,
        subsetCount: 0,
        workerCount: 1,
        workers: [],
        mergeOrderCount: 0,
        mergeOrderPreview: [],
        mergeOrderTail: [],
        retry: {
          enabled: false,
          maxSubsetRetries: 0,
          retryDelayMs: 0,
          attemptedSubsets: 0,
          retriedSubsets: 0,
          recoveredSubsets: 0,
          failedSubsets: 0
        }
      }
      : { enabled: false };
    const checkpointBatchSize = resolveCheckpointBatchSize(entries.length, shardPlan);
    checkpoint = createBuildCheckpoint({
      buildRoot: runtime.buildRoot,
      mode,
      totalFiles: entries.length,
      batchSize: checkpointBatchSize
    });
    const stage1ProgressTracker = createStage1ProgressTracker({
      total: entries.length,
      mode,
      checkpoint,
      onTick: () => {
        lastProgressAt = Date.now();
        if (stage1StallSoftKickAttempts > 0) {
          stage1StallSoftKickAttempts = 0;
          lastStallSoftKickAt = 0;
          stage1StallSoftKickResetCount += 1;
        }
      }
    });
    progress = stage1ProgressTracker.progress;
    markOrderedEntryComplete = stage1ProgressTracker.markOrderedEntryComplete;
    if (stallSnapshotMs > 0) {
      stallSnapshotTimer = setInterval(() => {
        emitProcessingStallSnapshot();
      }, Math.min(30000, Math.max(10000, Math.floor(stallSnapshotMs / 2))));
      stallSnapshotTimer.unref?.();
    }
    if (progressHeartbeatMs > 0) {
      progressHeartbeatTimer = setInterval(() => {
        emitProcessingProgressHeartbeat();
      }, progressHeartbeatMs);
      progressHeartbeatTimer.unref?.();
    }
    if (shardPlan && shardPlan.length > 1) {
      const shardQueuePlan = resolveStage1ShardExecutionQueuePlan({
        shardPlan,
        runtime,
        clusterModeEnabled,
        clusterDeterministicMerge
      });
      const {
        shardExecutionPlan,
        shardExecutionOrderById,
        totals: {
          totalFiles,
          totalLines,
          totalBytes,
          totalCost
        },
        shardWorkPlan,
        shardMergePlan,
        mergeOrderByShardId,
        shardBatches,
        shardConcurrency,
        perShardFileConcurrency,
        perShardImportConcurrency,
        perShardEmbeddingConcurrency
      } = shardQueuePlan;
      if (envConfig.verbose === true) {
        const top = shardExecutionPlan.slice(0, Math.min(10, shardExecutionPlan.length));
        const costLabel = totalCost ? `, est ${Math.round(totalCost).toLocaleString()}ms` : '';
        log(`→ Shard plan: ${shardPlan.length} shards, ${totalFiles.toLocaleString()} files, ${totalLines.toLocaleString()} lines${costLabel}.`);
        for (const shard of top) {
          const lineCount = shard.lineCount || 0;
          const byteCount = shard.byteCount || 0;
          const costMs = shard.costMs || 0;
          const costText = costMs ? ` | est ${Math.round(costMs).toLocaleString()}ms` : '';
          log(`[shards] ${shard.label || shard.id} | files ${shard.entries.length.toLocaleString()} | lines ${lineCount.toLocaleString()} | bytes ${byteCount.toLocaleString()}${costText}`);
        }
        const splitGroups = new Map();
        for (const shard of shardPlan) {
          if (!shard.splitFrom) continue;
          const group = splitGroups.get(shard.splitFrom) || { count: 0, lines: 0, bytes: 0, cost: 0 };
          group.count += 1;
          group.lines += shard.lineCount || 0;
          group.bytes += shard.byteCount || 0;
          group.cost += shard.costMs || 0;
          splitGroups.set(shard.splitFrom, group);
        }
        for (const [label, group] of splitGroups) {
          const costText = group.cost ? `, est ${Math.round(group.cost).toLocaleString()}ms` : '';
          log(`[shards] split ${label} -> ${group.count} parts (${group.lines.toLocaleString()} lines, ${group.bytes.toLocaleString()} bytes${costText})`);
        }
      }
      shardSummary = shardSummary.map((summary) => ({
        ...summary,
        executionOrder: shardExecutionOrderById.get(summary.id) || null,
        mergeOrder: mergeOrderByShardId.get(summary.id) || null
      }));
      const shardModeLabel = clusterModeEnabled ? 'cluster' : 'local';
      const mergeModeLabel = clusterDeterministicMerge ? 'stable' : 'adaptive';
      const clusterRetryEnabled = clusterModeEnabled && clusterRetryConfig.enabled;
      const retryStats = {
        retriedSubsetIds: new Set(),
        recoveredSubsetIds: new Set(),
        failedSubsetIds: new Set()
      };
      log(
        `→ Sharding enabled: ${shardPlan.length} shards ` +
        `(mode=${shardModeLabel}, merge=${mergeModeLabel}, concurrency=${shardConcurrency}, ` +
        `per-shard files=${perShardFileConcurrency}, subset-retry=${clusterRetryEnabled
          ? `${clusterRetryConfig.maxSubsetRetries}x@${clusterRetryConfig.retryDelayMs}ms`
          : 'off'}).`
      );
      const mergeOrderIds = shardMergePlan.map((entry) => entry.subsetId);
      if (clusterModeEnabled) {
        const preview = mergeOrderIds.slice(0, 12).join(', ');
        const overflow = mergeOrderIds.length > 12
          ? ` … (+${mergeOrderIds.length - 12} more)`
          : '';
        log(`[shards] deterministic merge order (${mergeModeLabel}): ${preview || 'none'}${overflow}`);
      }
      const workerContexts = shardBatches.map((batch, workerIndex) => ({
        workerId: `${shardModeLabel}-worker-${String(workerIndex + 1).padStart(2, '0')}`,
        workerIndex: workerIndex + 1,
        batch,
        subsetCount: batch.length
      }));
      const runShardWorker = async (workerContext) => {
        const { workerId, workerIndex, batch } = workerContext;
        const shardRuntime = createShardRuntime(runtime, {
          fileConcurrency: perShardFileConcurrency,
          importConcurrency: perShardImportConcurrency,
          embeddingConcurrency: perShardEmbeddingConcurrency
        });
        shardRuntime.clusterWorker = {
          id: workerId,
          index: workerIndex,
          mode: shardModeLabel
        };
        logLine(
          `[shards] worker ${workerId} starting (${batch.length} subset${batch.length === 1 ? '' : 's'})`,
          {
            kind: 'status',
            mode,
            stage: 'processing',
            shardWorkerId: workerId,
            shardWorkerIndex: workerIndex,
            shardWorkerSubsetCount: batch.length
          }
        );
        try {
          const retryResult = await runShardSubsetsWithRetry({
            workItems: batch,
            executeWorkItem: async (workItem, retryContext) => {
              const {
                shard,
                entries: shardEntries,
                partIndex,
                partTotal,
                shardIndex,
                shardTotal,
                subsetId,
                mergeIndex
              } = workItem;
              const shardLabel = shard.label || shard.id;
              let shardBracket = shardLabel === shard.id ? null : shard.id;
              if (partTotal > 1) {
                const partLabel = `part ${partIndex}/${partTotal}`;
                shardBracket = shardBracket ? `${shardBracket} ${partLabel}` : partLabel;
              }
              const shardDisplay = shardLabel + (shardBracket ? ` [${shardBracket}]` : '');
              log(
                `→ Shard ${shardIndex}/${shardTotal}: ${shardDisplay} (${shardEntries.length} files)` +
                ` [worker=${workerId} subset=${subsetId} merge=${mergeIndex ?? '?'} ` +
                `attempt=${retryContext.attempt}/${retryContext.maxAttempts}]`,
                {
                  shardId: shard.id,
                  shardIndex,
                  shardTotal,
                  partIndex,
                  partTotal,
                  fileCount: shardEntries.length,
                  shardWorkerId: workerId,
                  shardSubsetId: subsetId,
                  shardSubsetMergeOrder: mergeIndex ?? null,
                  shardSubsetAttempt: retryContext.attempt,
                  shardSubsetMaxAttempts: retryContext.maxAttempts
                }
              );
              await processEntries({
                entries: shardEntries,
                runtime: shardRuntime,
                shardMeta: {
                  ...shard,
                  partIndex,
                  partTotal,
                  shardIndex,
                  shardTotal,
                  display: shardDisplay,
                  subsetId,
                  workerId,
                  mergeIndex,
                  attempt: retryContext.attempt,
                  maxAttempts: retryContext.maxAttempts,
                  allowRetry: clusterRetryEnabled
                },
                stateRef: state
              });
            },
            maxSubsetRetries: clusterRetryEnabled ? clusterRetryConfig.maxSubsetRetries : 0,
            retryDelayMs: clusterRetryEnabled ? clusterRetryConfig.retryDelayMs : 0,
            onRetry: ({ subsetId, attempt, maxAttempts, error }) => {
              logLine(
                `[shards] retrying subset ${subsetId} ` +
                `(attempt ${attempt + 1}/${maxAttempts}): ${error?.message || error}`,
                {
                  kind: 'warning',
                  mode,
                  stage: 'processing',
                  shardWorkerId: workerId,
                  shardSubsetId: subsetId,
                  shardSubsetAttempt: attempt,
                  shardSubsetMaxAttempts: maxAttempts,
                  shardSubsetRetrying: true
                }
              );
            }
          });
          for (const subsetId of retryResult.retriedSubsetIds || []) {
            retryStats.retriedSubsetIds.add(subsetId);
          }
          for (const subsetId of retryResult.recoveredSubsetIds || []) {
            retryStats.recoveredSubsetIds.add(subsetId);
          }
          logLine(
            `[shards] worker ${workerId} complete (${batch.length} subset${batch.length === 1 ? '' : 's'})`,
            {
              kind: 'status',
              mode,
              stage: 'processing',
              shardWorkerId: workerId,
              shardWorkerIndex: workerIndex,
              shardWorkerSubsetCount: batch.length
            }
          );
        } finally {
          await shardRuntime.destroy?.();
        }
      };
      const workerResults = await Promise.allSettled(
        workerContexts.map((workerContext) => runShardWorker(workerContext))
      );
      const workerFailures = workerResults
        .filter((result) => result.status === 'rejected')
        .map((result) => result.reason);
      for (const failure of workerFailures) {
        const subsetId = failure?.shardSubsetId;
        if (subsetId) retryStats.failedSubsetIds.add(subsetId);
      }
      if (workerFailures.length) {
        const firstFailure = workerFailures[0] || new Error('shard worker failed');
        orderedAppender.abort(firstFailure);
        throw firstFailure;
      }
      shardExecutionMeta = {
        enabled: true,
        mode: shardModeLabel,
        mergeOrder: mergeModeLabel,
        deterministicMerge: clusterDeterministicMerge,
        shardCount: shardPlan.length,
        subsetCount: shardWorkPlan.length,
        workerCount: workerContexts.length,
        workers: workerContexts.map((workerContext) => ({
          workerId: workerContext.workerId,
          subsetCount: workerContext.subsetCount,
          subsetIds: workerContext.batch.map((workItem) => workItem.subsetId)
        })),
        mergeOrderCount: mergeOrderIds.length,
        mergeOrderPreview: mergeOrderIds.slice(0, 64),
        mergeOrderTail: mergeOrderIds.length > 64
          ? mergeOrderIds.slice(-8)
          : [],
        retry: {
          enabled: clusterRetryEnabled,
          maxSubsetRetries: clusterRetryEnabled ? clusterRetryConfig.maxSubsetRetries : 0,
          retryDelayMs: clusterRetryEnabled ? clusterRetryConfig.retryDelayMs : 0,
          attemptedSubsets: shardWorkPlan.length,
          retriedSubsets: retryStats.retriedSubsetIds.size,
          recoveredSubsets: retryStats.recoveredSubsetIds.size,
          failedSubsets: retryStats.failedSubsetIds.size
        }
      };
    } else {
      await processEntries({ entries, runtime, stateRef: state });
      if (runtime.shards?.enabled) {
        shardSummary = shardSummary.map((summary, index) => ({
          ...summary,
          executionOrder: index + 1,
          mergeOrder: index + 1
        }));
        const defaultSubsetId = shardSummary[0]?.id
          ? `${normalizeOwnershipSegment(shardSummary[0].id, 'unknown')}#0001/0001`
          : null;
        shardExecutionMeta = {
          ...shardExecutionMeta,
          shardCount: shardSummary.length,
          subsetCount: shardSummary.length,
          workerCount: 1,
          workers: [{
            workerId: `${clusterModeEnabled ? 'cluster' : 'local'}-worker-01`,
            subsetCount: shardSummary.length,
            subsetIds: defaultSubsetId ? [defaultSubsetId] : []
          }],
          mergeOrderCount: defaultSubsetId ? 1 : 0,
          mergeOrderPreview: defaultSubsetId ? [defaultSubsetId] : [],
          mergeOrderTail: [],
          retry: {
            enabled: false,
            maxSubsetRetries: 0,
            retryDelayMs: 0,
            attemptedSubsets: shardSummary.length,
            retriedSubsets: 0,
            recoveredSubsets: 0,
            failedSubsets: 0
          }
        };
      }
    }
    if (incrementalState?.manifest) {
      const updatedAt = new Date().toISOString();
      incrementalState.manifest.shards = runtime.shards?.enabled
        ? {
          enabled: true,
          updatedAt,
          mode: shardExecutionMeta?.mode || null,
          mergeOrder: shardExecutionMeta?.mergeOrder || null,
          deterministicMerge: shardExecutionMeta?.deterministicMerge ?? null,
          workerCount: shardExecutionMeta?.workerCount ?? null,
          retry: shardExecutionMeta?.retry || null,
          plan: shardSummary
        }
        : { enabled: false, updatedAt };
    }
    showProgress('Files', progress.total, progress.total, { stage: 'processing', mode });
    checkpoint.finish();
    timing.processMs = Date.now() - processStart;
    const stageTimingBreakdownPayload = buildStageTimingBreakdownPayload();
    const extractedProseLowYieldSummary = buildExtractedProseLowYieldBailoutSummary(extractedProseLowYieldBailout);
    const extractedProseYieldProfileSummary = buildExtractedProseYieldProfileObservationSummary({
      observation: extractedProseYieldProfileObservation,
      skippedFiles: state?.skippedFiles
    });
    const watchdogNearThresholdSummary = stageTimingBreakdownPayload?.watchdog?.nearThreshold;
    if (watchdogNearThresholdSummary?.anomaly) {
      const ratioPct = (watchdogNearThresholdSummary.nearThresholdRatio * 100).toFixed(1);
      const lowerPct = (watchdogNearThresholdSummary.lowerFraction * 100).toFixed(0);
      const upperPct = (watchdogNearThresholdSummary.upperFraction * 100).toFixed(0);
      const suggestedSlowFileMs = Number(watchdogNearThresholdSummary.suggestedSlowFileMs);
      const suggestionText = Number.isFinite(suggestedSlowFileMs) && suggestedSlowFileMs > 0
        ? `consider stage1.watchdog.slowFileMs=${Math.floor(suggestedSlowFileMs)}`
        : 'consider raising stage1.watchdog.slowFileMs';
      logLine(
        `[watchdog] near-threshold anomaly: ${watchdogNearThresholdSummary.nearThresholdCount}`
          + `/${watchdogNearThresholdSummary.sampleCount} files (${ratioPct}%) in ${lowerPct}-${upperPct}% window; `
          + `${suggestionText}.`,
        {
          kind: 'warning',
          mode,
          stage: 'processing',
          watchdog: {
            nearThreshold: watchdogNearThresholdSummary
          }
        }
      );
    }
    if (timing && typeof timing === 'object') {
      timing.stageTimingBreakdown = stageTimingBreakdownPayload;
      timing.extractedProseLowYieldBailout = extractedProseLowYieldSummary;
      timing.extractedProseYieldProfile = extractedProseYieldProfileSummary;
      timing.shards = shardExecutionMeta;
      timing.watchdog = {
        ...(timing.watchdog && typeof timing.watchdog === 'object' ? timing.watchdog : {}),
        queueDelayMs: stageTimingBreakdownPayload?.watchdog?.queueDelayMs || null,
        nearThreshold: stageTimingBreakdownPayload?.watchdog?.nearThreshold || null,
        stallRecovery: {
          softKickAttempts: stage1StallSoftKickAttempts,
          softKickSuccessfulAttempts: stage1StallSoftKickSuccessCount,
          softKickResetCount: stage1StallSoftKickResetCount,
          softKickThresholdMs: stage1StallSoftKickMs,
          softKickCooldownMs: stage1StallSoftKickCooldownMs,
          softKickMaxAttempts: stage1StallSoftKickMaxAttempts,
          stallAbortMs: stage1StallAbortMs
        }
      };
    }
    if (state && typeof state === 'object') {
      state.extractedProseLowYieldBailout = extractedProseLowYieldSummary;
      state.extractedProseYieldProfile = extractedProseYieldProfileSummary;
      state.shardExecution = shardExecutionMeta;
    }
    const parseSkipCount = state.skippedFiles.filter((entry) => entry?.reason === 'parse-error').length;
    const relationSkipCount = state.skippedFiles.filter((entry) => entry?.reason === 'relation-error').length;
    const skipTotal = parseSkipCount + relationSkipCount;
    if (skipTotal > 0) {
      const parts = [];
      if (parseSkipCount) parts.push(`parse=${parseSkipCount}`);
      if (relationSkipCount) parts.push(`relations=${relationSkipCount}`);
      log(`Warning: skipped ${skipTotal} files due to parse/relations errors (${parts.join(', ')}).`);
    }

    const postingsQueueStats = postingsQueue?.stats ? postingsQueue.stats() : null;
    if (postingsQueueStats) {
      if (timing) timing.postingsQueue = postingsQueueStats;
      if (state) state.postingsQueueStats = postingsQueueStats;
    }
    logLexiconFilterAggregate({ state, logFn: log });

    return {
      tokenizationStats,
      shardSummary,
      shardPlan,
      shardExecution: shardExecutionMeta,
      postingsQueueStats,
      extractedProseLowYieldBailout: extractedProseLowYieldSummary,
      extractedProseYieldProfile: extractedProseYieldProfileSummary
    };
  } finally {
    if (typeof stallSnapshotTimer === 'object' && stallSnapshotTimer) {
      clearInterval(stallSnapshotTimer);
    }
    if (typeof progressHeartbeatTimer === 'object' && progressHeartbeatTimer) {
      clearInterval(progressHeartbeatTimer);
    }
    if (typeof stallAbortTimer === 'object' && stallAbortTimer) {
      clearInterval(stallAbortTimer);
    }
    if (typeof detachExternalAbort === 'function') {
      detachExternalAbort();
    }
    runtime?.telemetry?.clearInFlightBytes?.('stage1.postings-queue');
    runtime?.telemetry?.clearDurationHistogram?.(queueDelayTelemetryChannel);
    await runCleanupWithTimeout({
      label: 'perf-event-logger.close',
      cleanup: () => perfEventLogger.close(),
      timeoutMs: cleanupTimeoutMs,
      log: (line, meta) => logLine(line, {
        ...(meta || {}),
        mode,
        stage: 'processing'
      })
    });
    await runCleanupWithTimeout({
      label: 'tree-sitter-scheduler.close',
      cleanup: () => closeTreeSitterScheduler(),
      timeoutMs: cleanupTimeoutMs,
      log: (line, meta) => logLine(line, {
        ...(meta || {}),
        mode,
        stage: 'processing'
      }),
      onTimeout: async () => {
        const cleanup = await terminateTrackedSubprocesses({
          reason: 'tree_sitter_scheduler_close_timeout',
          force: true
        });
        if (cleanup?.attempted > 0) {
          logLine(
            `[cleanup] forced termination of ${cleanup.attempted} tracked subprocess(es) after scheduler close timeout.`,
            {
              kind: 'warning',
              mode,
              stage: 'processing',
              cleanup
            }
          );
        }
      }
    });
  }
};


