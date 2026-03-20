import {
  runWithQueue,
  createOrderedCompletionTracker as createSharedOrderedCompletionTracker
} from '../../../../shared/concurrency.js';
import { getEnvConfig } from '../../../../shared/env.js';
import { fileExt, toPosix } from '../../../../shared/files.js';
import { countLinesForEntries } from '../../../../shared/file-stats.js';
import { log, logLine, showProgress } from '../../../../shared/progress.js';
import { awaitWithKeepalive } from '../../../../shared/promise-keepalive.js';
import { createTimeoutError, runWithTimeout } from '../../../../shared/promise-timeout.js';
import { coerceNonNegativeInt, coercePositiveInt } from '../../../../shared/number-coerce.js';
import { coerceAbortSignal, composeAbortSignals, throwIfAborted } from '../../../../shared/abort.js';
import { compareStrings } from '../../../../shared/sort.js';
import { toArray } from '../../../../shared/iterables.js';
import {
  FILE_PROGRESS_HEARTBEAT_DEFAULT_MS,
  resolveStage1HangPolicy,
  resolveStage1StallAbortTimeoutMs,
  resolveStage1StallAction,
  resolveStage1StallSoftKickTimeoutMs
} from '../../../../shared/indexing/stage1-watchdog-policy.js';
import {
  buildProgressTimeoutBudget,
  evaluateProgressTimeout
} from '../../../../shared/indexing/progress-timeout-policy.js';
import {
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
import { planShards } from '../../shards.js';
import { recordFileMetric } from '../../perf-profile.js';
import { createVfsManifestCollector } from '../../vfs-manifest-collector.js';
import { resolveHangProbeConfig, runWithHangProbe } from '../hang-probe.js';
import { createTokenRetentionState } from './postings.js';
import { createPostingsQueue } from './process-files/postings-queue.js';
import { buildOrderedAppender } from './process-files/ordered.js';
import { resolveCheckpointBatchSize } from './process-files/runtime.js';
import {
  buildFileProgressHeartbeatText,
  createStage1ProgressTracker
} from './process-files/progress.js';
import {
  createStage1TimingBreakdownTracker
} from './process-files/stage-timing.js';
import { executeStage1ShardProcessing } from './process-files/shard-execution.js';
import { finalizeStage1ProcessingResult } from './process-files/results.js';
import { buildExtractedProseYieldProfileFamily } from '../../file-processor/skip.js';
import {
  buildContiguousSeqWindows,
  buildDeterministicShardMergePlan,
  resolveActiveSeqWindows,
  resolveClusterSubsetRetryConfig,
  resolveEntryOrderIndex,
  resolveStage1WindowPlannerConfig,
  resolveShardSubsetId,
  resolveShardSubsetMinOrderIndex,
  runShardSubsetsWithRetry,
  sortEntriesByOrderIndex
} from './process-files/ordering.js';
import {
  compactDocumentExtractionCacheEntries,
  createMutableKeyValueStore,
  DOCUMENT_EXTRACTION_CACHE_FILE,
  DOCUMENT_EXTRACTION_CACHE_MAX_ENTRIES,
  DOCUMENT_EXTRACTION_CACHE_MAX_ENTRY_TEXT_BYTES,
  DOCUMENT_EXTRACTION_CACHE_MAX_LOAD_BYTES,
  DOCUMENT_EXTRACTION_CACHE_MAX_TOTAL_ENTRY_BYTES,
  loadDocumentExtractionCacheState,
  loadExtractedProseYieldProfileState,
  normalizeYieldProfileFamilyStats,
  persistDocumentExtractionCacheState,
  persistExtractedProseYieldProfileState,
  resolveExtractedProseExtrasCache,
  resolveSharedScmMetaCache
} from './process-files/runtime-state.js';
import {
  buildWatchdogNearThresholdSummary,
  createDurationHistogram,
  isNearThresholdSlowFileDuration,
  resolveEffectiveSlowFileDurationMs,
  resolveFileHardTimeoutMs,
  resolveFileLifecycleDurations,
  resolveFileWatchdogConfig,
  resolveFileWatchdogMs,
  resolveProcessCleanupTimeoutMs,
  resolveStageTimingSizeBin,
  shouldTriggerSlowFileWarning
} from './process-files/watchdog-policy.js';
import {
  buildStage1FileSubprocessOwnershipId,
  buildTrackedProcessFileTaskSummaryText,
  createTrackedProcessFileTaskRegistry,
  drainTrackedProcessFileTasks,
  resolveStage1FileSubprocessOwnershipPrefix,
  runCleanupWithTimeout,
  runStage1TailCleanupTasks
} from './process-files/task-lifecycle.js';
import {
  runApplyWithPostingsBackpressure,
  shouldBypassPostingsBackpressure
} from './process-files/backpressure.js';
import {
  assignFileIndexes,
  clampShardConcurrencyToRuntime,
  resolveOrderedEntryProgressPlan,
  resolveStage1OrderingIntegrity,
  resolveStage1ShardExecutionQueuePlan,
  resolveStableEntryOrderIndex,
  sortShardBatchesByDeterministicMergeOrder
} from './process-files/shard-plan.js';
import {
  buildExtractedProseLowYieldCohort,
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
import {
  buildStage1ProcessingStallSnapshot,
  collectStage1StalledFiles,
  formatStage1SchedulerStallSummary,
  formatStage1StalledFileText,
  summarizeStage1SoftKickCleanup
} from './process-files/stall-diagnostics.js';
import { SCHEDULER_QUEUE_NAMES } from '../../runtime/scheduler.js';
import { INDEX_PROFILE_VECTOR_ONLY } from '../../../../contracts/index-profile.js';
import { prepareScmFileMetaSnapshot } from '../../../scm/file-meta-snapshot.js';

export {
  buildWatchdogNearThresholdSummary,
  buildFileProgressHeartbeatText,
  buildStage1FileSubprocessOwnershipId,
  buildTrackedProcessFileTaskSummaryText,
  clampShardConcurrencyToRuntime,
  compactDocumentExtractionCacheEntries,
  createDurationHistogram,
  createTrackedProcessFileTaskRegistry,
  DOCUMENT_EXTRACTION_CACHE_FILE,
  DOCUMENT_EXTRACTION_CACHE_MAX_ENTRIES,
  DOCUMENT_EXTRACTION_CACHE_MAX_ENTRY_TEXT_BYTES,
  DOCUMENT_EXTRACTION_CACHE_MAX_LOAD_BYTES,
  DOCUMENT_EXTRACTION_CACHE_MAX_TOTAL_ENTRY_BYTES,
  drainTrackedProcessFileTasks,
  isNearThresholdSlowFileDuration,
  loadDocumentExtractionCacheState,
  resolveEffectiveSlowFileDurationMs,
  resolveExtractedProseExtrasCache,
  resolveFileHardTimeoutMs,
  resolveFileLifecycleDurations,
  resolveFileWatchdogConfig,
  resolveFileWatchdogMs,
  resolveProcessCleanupTimeoutMs,
  resolveSharedScmMetaCache,
  resolveStage1FileSubprocessOwnershipPrefix,
  resolveStage1HangPolicy,
  resolveStage1OrderingIntegrity,
  resolveStageTimingSizeBin,
  resolveStage1StallAbortTimeoutMs,
  resolveStage1StallAction,
  resolveStage1StallSoftKickTimeoutMs,
  runApplyWithPostingsBackpressure,
  runCleanupWithTimeout,
  runStage1TailCleanupTasks,
  shouldBypassPostingsBackpressure,
  shouldTriggerSlowFileWarning,
  sortShardBatchesByDeterministicMergeOrder
};
const STAGE1_ORDERED_COMPLETION_TIMEOUT_FALLBACK_MS = 2 * 60 * 1000;
const STAGE1_ORDERED_FLUSH_TIMEOUT_FALLBACK_MS = 90 * 1000;
const STAGE1_ORDERED_COMPLETION_STALL_POLL_DEFAULT_MS = 5000;
const FILE_QUEUE_DELAY_HISTOGRAM_BUCKETS_MS = Object.freeze([50, 100, 250, 500, 1000, 2000, 5000, 10000, 30000, 60000]);

const clampDurationMs = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
};

const toIsoTimestamp = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? new Date(parsed).toISOString() : null;
};

/**
 * Resolve stage1 feature gates for tokenization and sparse postings.
 *
 * @param {object} runtime
 * @returns {{tokenizeEnabled:boolean,sparsePostingsEnabled:boolean}}
 */
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
 * Shared ordered-completion tracker used by stage1 ordered appender plumbing.
 *
 * @type {import('../../../../shared/concurrency/ordered-completion.js').createOrderedCompletionTracker}
 */
export const createOrderedCompletionTracker = createSharedOrderedCompletionTracker;

/**
 * Keep outer stage1 orchestration awaits referenced while the underlying work
 * may temporarily degrade into pure promise waits with no libuv handles.
 *
 * This prevents Node from terminating `build_index.js` with unsettled
 * top-level await while watchdog/timeout logic still owns the true outcome.
 *
 * @template T
 * @param {Promise<T>|T} promise
 * @returns {Promise<T>}
 */
export const awaitStage1Barrier = (promise) => awaitWithKeepalive(Promise.resolve(promise));
const coerceOptionalNonNegativeInt = (value) => {
  if (value === null || value === undefined) return null;
  return coerceNonNegativeInt(value);
};

const resolveOrderedCompletionTimeoutMs = ({
  runtime = null,
  stallAbortMs = 0,
  stallSoftKickMs = 0
} = {}) => {
  const configured = coerceOptionalNonNegativeInt(runtime?.stage1Queues?.ordered?.completionTimeoutMs);
  if (configured != null) return configured;
  const abortBudgetMs = Number(stallAbortMs);
  if (Number.isFinite(abortBudgetMs) && abortBudgetMs > 0) {
    return Math.max(1000, Math.floor(abortBudgetMs));
  }
  const softKickBudgetMs = Number(stallSoftKickMs);
  if (Number.isFinite(softKickBudgetMs) && softKickBudgetMs > 0) {
    return Math.max(1000, Math.floor(softKickBudgetMs * 2));
  }
  return STAGE1_ORDERED_COMPLETION_TIMEOUT_FALLBACK_MS;
};

/**
 * Resolve stall-poll cadence used while awaiting ordered completion drain.
 *
 * @param {{runtime?:object}} [input]
 * @returns {number}
 */
const resolveOrderedCompletionStallPollMs = ({ runtime = null } = {}) => {
  const configured = coerceOptionalNonNegativeInt(runtime?.stage1Queues?.ordered?.completionStallPollMs);
  return configured != null
    ? configured
    : STAGE1_ORDERED_COMPLETION_STALL_POLL_DEFAULT_MS;
};

/**
 * Resolve timeout budget for one ordered-flush write operation.
 *
 * @param {{runtime?:object}} [input]
 * @returns {number}
 */
const resolveOrderedFlushTimeoutMs = ({ runtime = null } = {}) => {
  const configured = coerceOptionalNonNegativeInt(runtime?.stage1Queues?.ordered?.flushTimeoutMs);
  if (configured != null) return configured;
  const completionTimeoutMs = coerceOptionalNonNegativeInt(runtime?.stage1Queues?.ordered?.completionTimeoutMs);
  if (Number.isFinite(completionTimeoutMs) && completionTimeoutMs > 0) {
    return Math.max(
      10000,
      Math.min(STAGE1_ORDERED_FLUSH_TIMEOUT_FALLBACK_MS, Math.floor(completionTimeoutMs))
    );
  }
  return STAGE1_ORDERED_FLUSH_TIMEOUT_FALLBACK_MS;
};

/**
 * Resolve stage1 ordering integrity against expected and completed order-index
 * sets.
 *
 * @param {{
 *   expectedOrderIndices?:number[],
 *   completedOrderIndices?:Iterable<number>,
 *   progressCount?:number,
 *   progressTotal?:number,
 *   terminalCount?:number|null,
 *   committedCount?:number|null,
 *   totalSeqCount?:number|null
 * }} [input]
 * @returns {{
 *   ok:boolean,
 *   expectedCount:number,
 *   completedCount:number,
 *   terminalCount:number|null,
 *   committedCount:number|null,
 *   totalSeqCount:number|null,
 *   missingIndices:number[],
 *   missingCount:number,
 *   progressComplete:boolean,
 *   progressCount:number,
 *   progressTotal:number
 * }}
 */
export {
  buildDeterministicShardMergePlan,
  resolveClusterSubsetRetryConfig,
  resolveEntryOrderIndex,
  resolveShardSubsetId,
  resolveShardSubsetMinOrderIndex,
  runShardSubsetsWithRetry,
  sortEntriesByOrderIndex
};
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
  abortSignal = null
}) => {
  const stage1OwnershipPrefix = `${resolveStage1FileSubprocessOwnershipPrefix(runtime, mode)}:`;
  const stageAbortController = typeof AbortController === 'function'
    ? new AbortController()
    : null;
  const effectiveAbortSignal = stageAbortController?.signal || abortSignal || null;
  let detachExternalAbort = null;
  if (stageAbortController && abortSignal && typeof abortSignal.addEventListener === 'function') {
    /**
     * Propagate outer abort to file-local controller.
     *
     * @returns {void}
     */
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
  /**
   * Abort active stage1 processing and trigger runtime cancellation hooks.
   *
   * @param {unknown} [reason]
   * @returns {void}
   */
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
  const extractedProseYieldProfileState = mode === 'extracted-prose'
    ? await loadExtractedProseYieldProfileState({ runtime, log })
    : null;
  const extractedProseYieldProfile = mode === 'extracted-prose'
    ? normalizeYieldProfileEntry(extractedProseYieldProfileState?.entries?.['extracted-prose'])
    : null;
  const extractedProseLowYieldHistory = extractedProseYieldProfile
    ? {
      builds: extractedProseYieldProfile.builds,
      observedFiles: extractedProseYieldProfile.totals?.observedFiles || 0,
      yieldedFiles: extractedProseYieldProfile.totals?.yieldedFiles || 0,
      chunkCount: extractedProseYieldProfile.totals?.chunkCount || 0,
      families: extractedProseYieldProfile.families || {}
    }
    : null;
  const documentExtractionCacheState = mode === 'extracted-prose'
    ? await loadDocumentExtractionCacheState({ runtime, log })
    : null;
  const documentExtractionCacheStore = mode === 'extracted-prose'
    ? createMutableKeyValueStore(documentExtractionCacheState?.entries || {})
    : null;
  const sharedScmMetaCache = resolveSharedScmMetaCache(runtime, cacheReporter);
  const extractedProseExtrasCache = resolveExtractedProseExtrasCache(runtime, cacheReporter);
  const primeExtractedProseExtrasCache = mode === 'prose';
  const extractedProseYieldRunStats = {
    observedFiles: 0,
    yieldedFiles: 0,
    chunkCount: 0,
    families: new Map(),
    cohorts: new Map()
  };
  const lowYieldBypassOrderIndices = new Set();
  const stageFileWatchdogConfig = resolveFileWatchdogConfig(runtime, { repoFileCount: stageFileCount });
  const extractedProseLowYieldBailout = buildExtractedProseLowYieldBailoutState({
    mode,
    runtime,
    entries,
    history: extractedProseLowYieldHistory
  });
  const queueDelayTelemetryChannel = 'stage1.file-queue-delay';
  runtime?.telemetry?.clearDurationHistogram?.(queueDelayTelemetryChannel);
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
  const stageTimingTracker = createStage1TimingBreakdownTracker({
    runtime,
    queueDelayHistogramBucketsMs: FILE_QUEUE_DELAY_HISTOGRAM_BUCKETS_MS,
    queueDelayTelemetryChannel,
    stageFileWatchdogConfig,
    extractedProseLowYieldBailout
  });
  const {
    recordStageTimingSample,
    observeQueueDelay,
    observeWatchdogNearThreshold,
    buildPayload: buildStageTimingBreakdownPayload
  } = stageTimingTracker;
  const lifecycleByOrderIndex = new Map();
  const lifecycleByRelKey = new Map();
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
  const recordExtractedProseYieldObservation = ({ entry = null, result = null } = {}) => {
    if (mode !== 'extracted-prose') return;
    const relPath = entry?.rel
      || (entry?.abs ? toPosix(path.relative(runtime.root, entry.abs)) : null);
    const ext = entry?.ext || fileExt(relPath || entry?.abs || '');
    const family = buildExtractedProseYieldProfileFamily({
      relPath,
      absPath: entry?.abs || null,
      ext
    });
    const cohort = buildExtractedProseLowYieldCohort({
      relPath,
      absPath: entry?.abs || null,
      ext,
      pathFamily: family?.pathFamily || null
    });
    const chunkCount = Math.max(0, Math.floor(Number(result?.chunks?.length) || 0));
    extractedProseYieldRunStats.observedFiles += 1;
    if (chunkCount > 0) {
      extractedProseYieldRunStats.yieldedFiles += 1;
    }
    extractedProseYieldRunStats.chunkCount += chunkCount;
    const familyStats = extractedProseYieldRunStats.families.get(family.key) || {
      observedFiles: 0,
      yieldedFiles: 0,
      chunkCount: 0
    };
    familyStats.observedFiles += 1;
    if (chunkCount > 0) {
      familyStats.yieldedFiles += 1;
    }
    familyStats.chunkCount += chunkCount;
    extractedProseYieldRunStats.families.set(family.key, familyStats);
    const cohortStats = extractedProseYieldRunStats.cohorts.get(cohort.key) || {
      observedFiles: 0,
      yieldedFiles: 0,
      chunkCount: 0
    };
    cohortStats.observedFiles += 1;
    if (chunkCount > 0) {
      cohortStats.yieldedFiles += 1;
    }
    cohortStats.chunkCount += chunkCount;
    extractedProseYieldRunStats.cohorts.set(cohort.key, cohortStats);
  };
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
  const hangProbeConfig = resolveHangProbeConfig(envConfig);
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
  const cleanupTimeoutMs = resolveProcessCleanupTimeoutMs(runtime);

  /**
   * Stop and flush tree-sitter scheduler resources when used by this stage.
   *
   * @param {{onTimeout?:Function|null}} [input]
   * @returns {Promise<{skipped:boolean,timedOut:boolean,elapsedMs:number,error?:unknown}>}
   */
  const closeTreeSitterScheduler = async ({ onTimeout = null } = {}) => {
    if (!treeSitterScheduler || typeof treeSitterScheduler.close !== 'function') {
      return { skipped: true, timedOut: false, elapsedMs: 0 };
    }
    return runCleanupWithTimeout({
      label: 'tree-sitter-scheduler.close',
      cleanup: () => treeSitterScheduler.close(),
      timeoutMs: cleanupTimeoutMs,
      log: (line, meta) => logLine(line, {
        ...(meta || {}),
        mode,
        stage: 'processing'
      }),
      onTimeout
    });
  };
  let stallSnapshotTimer = null;
  let progressHeartbeatTimer = null;
  let stallAbortTimer = null;
  let preDispatchWatchdogTimer = null;
  let orderedCompletionTracker = null;
  const activeOrderedCompletionTrackers = new Set();
  const inFlightProcessFileTasks = createTrackedProcessFileTaskRegistry({
    name: `stage1:${String(runtime?.buildId || 'unknown-build')}:${mode || 'unknown-mode'}`
  });
  let stage1ShuttingDown = false;

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
    /**
     * Publish postings queue snapshot to stage1 and global telemetry channels.
     *
     * @param {object|null} [snapshot]
     * @returns {void}
     */
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
      ? (fn, signal = effectiveAbortSignal) => {
        const schedulerSignal = coerceAbortSignal(signal);
        return runtime.scheduler.schedule(
          SCHEDULER_QUEUE_NAMES.stage1Postings,
          {
            mem: 1,
            signal: schedulerSignal
          },
          fn
        );
      }
      : (fn) => fn();
    let checkpoint = null;
    let progress = null;
    let markOrderedEntryComplete = () => false;
    let getStage1ProgressSnapshot = () => ({
      total: Number.isFinite(progress?.total) ? progress.total : 0,
      count: Number.isFinite(progress?.count) ? progress.count : 0,
      completedOrderIndices: []
    });
    const {
      startOrderIndex,
      expectedOrderIndices,
      orderIndexToRel
    } = resolveOrderedEntryProgressPlan(entries);
    const stage1WindowPlannerConfig = resolveStage1WindowPlannerConfig(runtime);
    const stage1WindowPlannerEntries = sortEntriesByOrderIndex(entries);
    let stage1SeqWindows = buildContiguousSeqWindows(stage1WindowPlannerEntries, {
      presorted: true,
      config: stage1WindowPlannerConfig
    });
    let stage1ActiveWindows = resolveActiveSeqWindows(stage1SeqWindows, startOrderIndex, {
      maxActiveWindows: stage1WindowPlannerConfig.maxActiveWindows
    });
    const stage1WindowReplanIntervalMs = Math.max(
      250,
      coerceNonNegativeInt(runtime?.stage1Queues?.window?.replanIntervalMs)
      ?? 2000
    );
    const stage1WindowReplanMinSeqAdvance = Math.max(
      1,
      coercePositiveInt(runtime?.stage1Queues?.window?.replanMinSeqAdvance)
      ?? Math.max(4, Math.floor(runtime.fileConcurrency || 1))
    );
    let stage1WindowReplanAttemptCount = 0;
    let stage1WindowReplanChangedCount = 0;
    let stage1LastWindowReplanAtMs = 0;
    let stage1LastWindowReplanCommitSeq = Number.isFinite(startOrderIndex)
      ? Math.floor(startOrderIndex)
      : 0;
    let stage1LastWindowTelemetry = null;
    /**
     * Resolve lifecycle timing row from processor result payload.
     *
     * @param {object} result
     * @param {object|null} [shardMeta]
     * @returns {object}
     */
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
    /**
     * Merge one file-processing result into stage state and write pipelines.
     *
     * @param {object} result
     * @param {object} stateRef
     * @param {object|null} shardMeta
     * @param {{signal?:AbortSignal|null}} [context]
     * @returns {Promise<void>}
     */
    const applyFileResult = async (result, stateRef, shardMeta, context = {}) => {
      if (!result) return;
      const applySignal = context?.signal && typeof context.signal.aborted === 'boolean'
        ? context.signal
        : null;
      throwIfAborted(applySignal);
      const lifecycle = resolveResultLifecycleRecord(result, shardMeta);
      if (lifecycle && !Number.isFinite(lifecycle.writeStartAtMs)) {
        lifecycle.writeStartAtMs = Date.now();
      }
      if (result.fileMetrics) {
        recordFileMetric(perfProfile, result.fileMetrics);
      }
      throwIfAborted(applySignal);
      for (const chunk of result.chunks) {
        appendChunkWithRetention(stateRef, chunk, state);
      }
      throwIfAborted(applySignal);
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
        throwIfAborted(applySignal);
        await stateRef.vfsManifestCollector.appendRows(result.vfsManifestRows, { log });
        throwIfAborted(applySignal);
      }
      if (lifecycle) {
        lifecycle.writeEndAtMs = Date.now();
      }
      const lifecycleDurations = lifecycle ? resolveFileLifecycleDurations(lifecycle) : null;
      throwIfAborted(applySignal);
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
    /**
     * Apply one ordered stage1 result while holding postings backpressure
     * reservation only during the actual write/apply window.
     *
     * @param {object} result
     * @param {object} stateRef
     * @param {object|null} [shardMeta=null]
     * @param {{signal?:AbortSignal|null}} [context]
     * @returns {Promise<unknown>}
     */
    const applyOrderedResultWithBackpressure = async (
      result,
      stateRef,
      shardMeta = null,
      context = null
    ) => runApplyWithPostingsBackpressure({
      sparsePostingsEnabled,
      postingsQueue,
      result,
      signal: context?.signal && typeof context.signal.aborted === 'boolean'
        ? context.signal
        : effectiveAbortSignal,
      reserveTimeoutMs: coerceOptionalNonNegativeInt(postingsQueueConfig?.reserveTimeoutMs),
      runApply: ({ signal } = {}) => schedulePostings(async () => {
        throwIfAborted(signal);
        await applyFileResult(result, stateRef, shardMeta, { signal });
        throwIfAborted(signal);
      }, signal)
    });
    const orderedFlushTimeoutMs = resolveOrderedFlushTimeoutMs({ runtime });
    const orderedAppender = buildOrderedAppender(
      applyOrderedResultWithBackpressure,
      state,
      {
        expectedCount: expectedOrderIndices.length || (Array.isArray(entries) ? entries.length : null),
        expectedIndices: expectedOrderIndices,
        startIndex: startOrderIndex,
        bucketSize: coercePositiveInt(runtime?.stage1Queues?.ordered?.bucketSize)
        ?? Math.max(256, runtime.fileConcurrency * 48),
        maxPendingBeforeBackpressure: orderedAppenderConfig.maxPendingBeforeBackpressure,
        maxPendingEmergencyFactor: orderedAppenderConfig.maxPendingEmergencyFactor,
        maxPendingBytes: orderedAppenderConfig.maxPendingBytes,
        commitLagHard: orderedAppenderConfig.commitLagHard,
        resumeHysteresisRatio: orderedAppenderConfig.resumeHysteresisRatio,
        leaseTimeoutMs: runtime?.stage1Queues?.window?.leaseTimeoutMs,
        dispatchLeaseTimeoutMs: runtime?.stage1Queues?.window?.dispatchLeaseTimeoutMs,
        runId: runtime?.buildId || null,
        flushTimeoutMs: orderedFlushTimeoutMs,
        signal: effectiveAbortSignal,
        log: (message, meta = {}) => logLine(message, { ...meta, mode, stage: 'processing' }),
        stallMs: debugOrdered ? 5000 : undefined,
        debugOrdered
      }
    );
    const inFlightFiles = new Map();
    /**
     * Clear one tracked in-flight file lifecycle entry once result handling
     * (enqueue/skip/error) has fully settled.
     *
     * @param {number|null} orderIndex
     * @returns {void}
     */
    const clearInFlightFile = (orderIndex) => {
      if (!Number.isFinite(orderIndex)) return;
      inFlightFiles.delete(Math.floor(orderIndex));
    };
    const stage1HangPolicy = resolveStage1HangPolicy(runtime, stageFileWatchdogConfig);
    const stallSnapshotMs = stage1HangPolicy.stallSnapshotMs;
    const progressHeartbeatMs = stage1HangPolicy.progressHeartbeatMs;
    let stage1StallAbortMs = stage1HangPolicy.stallAbortMs;
    const stage1StallSoftKickMs = stage1HangPolicy.stallSoftKickMs;
    const stage1StallSoftKickCooldownMs = stage1HangPolicy.stallSoftKickCooldownMs;
    const stage1StallSoftKickMaxAttempts = stage1HangPolicy.stallSoftKickMaxAttempts;
    let stage1StallAbortTriggered = false;
    let stage1StallSoftKickAttempts = 0;
    let stage1StallSoftKickSuccessCount = 0;
    let stage1StallSoftKickResetCount = 0;
    let stage1StallSoftKickInFlight = false;
    let lastStallSoftKickAt = 0;
    const orderedCompletionTimeoutMs = resolveOrderedCompletionTimeoutMs({
      runtime,
      stallAbortMs: stage1StallAbortMs,
      stallSoftKickMs: stage1StallSoftKickMs
    });
    const orderedCompletionStallPollMs = resolveOrderedCompletionStallPollMs({
      runtime
    });
    const effectiveOrderedCompletionTimeoutMs = orderedCompletionTimeoutMs > 0
      ? orderedCompletionTimeoutMs
      : STAGE1_ORDERED_COMPLETION_TIMEOUT_FALLBACK_MS;
    const orderedCompletionGuardTimeoutMs = Math.max(
      effectiveOrderedCompletionTimeoutMs + Math.max(1000, orderedCompletionStallPollMs),
      STAGE1_ORDERED_COMPLETION_TIMEOUT_FALLBACK_MS
    );
    const orderedCapacityWaitTimeoutMs = Math.max(
      1000,
      Math.min(
        orderedCompletionGuardTimeoutMs,
        stage1StallAbortMs > 0 ? stage1StallAbortMs : orderedCompletionGuardTimeoutMs
      )
    );
    /**
     * Track all ordered flush completions across the entire stage1 mode run.
     *
     * Per-subset drain waits can deadlock when a subset with higher order-index
     * entries waits before the lower-index subset has been dispatched. A single
     * shared tracker lets each subset enqueue work without blocking on future
     * subsets; we drain exactly once after all subsets/workers have run.
     */
    orderedCompletionTracker = createOrderedCompletionTracker();
    activeOrderedCompletionTrackers.add(orderedCompletionTracker);
    let lastProgressAt = Date.now();
    let lastOrderedCompletionAt = Date.now();
    let lastStallSnapshotAt = 0;
    let watchdogAdaptiveLogged = false;
    const stage1TimeoutSignals = {
      lastQueueMovementAtMs: Date.now(),
      lastByteProgressAtMs: Date.now(),
      queueBaselineKey: null,
      byteBaselineKey: null
    };
    /**
     * Resolve pending ordered-appender queue depth for watchdog snapshots.
     *
     * @returns {number}
     */
    const getOrderedPendingCount = () => {
      if (!activeOrderedCompletionTrackers.size) {
        return 0;
      }
      let pendingCount = 0;
      for (const tracker of activeOrderedCompletionTrackers) {
        if (!tracker || typeof tracker.snapshot !== 'function') continue;
        const snapshot = tracker.snapshot();
        pendingCount += Number(snapshot?.pending) || 0;
      }
      return pendingCount;
    };
    const readStage1InFlightBytesTotal = () => {
      const total = Number(runtime?.telemetry?.readInFlightBytes?.()?.total);
      return Number.isFinite(total) && total >= 0 ? Math.floor(total) : 0;
    };
    const observeStage1TimeoutSignals = (nowMs = Date.now()) => {
      const orderedSnapshot = typeof orderedAppender.snapshot === 'function'
        ? orderedAppender.snapshot()
        : null;
      const postingsSnapshot = typeof postingsQueue?.stats === 'function'
        ? postingsQueue.stats()
        : null;
      const queueBaselineKey = [
        Number(orderedSnapshot?.nextIndex) || 0,
        Number(orderedSnapshot?.pendingCount) || 0,
        Number(orderedSnapshot?.commitLag) || 0,
        Number(orderedSnapshot?.terminalCount) || 0
      ].join(':');
      const byteBaselineKey = [
        Number(orderedSnapshot?.pendingBytes) || 0,
        Number(postingsSnapshot?.pendingBytes) || 0,
        readStage1InFlightBytesTotal()
      ].join(':');
      if (stage1TimeoutSignals.queueBaselineKey !== queueBaselineKey) {
        stage1TimeoutSignals.queueBaselineKey = queueBaselineKey;
        stage1TimeoutSignals.lastQueueMovementAtMs = nowMs;
      }
      if (stage1TimeoutSignals.byteBaselineKey !== byteBaselineKey) {
        stage1TimeoutSignals.byteBaselineKey = byteBaselineKey;
        stage1TimeoutSignals.lastByteProgressAtMs = nowMs;
      }
      return {
        orderedSnapshot,
        postingsSnapshot,
        inFlightBytesTotal: readStage1InFlightBytesTotal()
      };
    };
    const resolveStage1TimeoutDecision = ({
      nowMs = Date.now(),
      orderedPending = getOrderedPendingCount()
    } = {}) => {
      const signals = observeStage1TimeoutSignals(nowMs);
      const phase = signals?.orderedSnapshot?.flushActive
        ? 'stage1-ordered-flush'
        : orderedPending > 0
          ? 'stage1-ordered-backpressure'
          : 'stage1-active-processing';
      const budget = buildProgressTimeoutBudget({
        phase,
        baseTimeoutMs: stage1StallAbortMs > 0 ? stage1StallAbortMs : Math.max(stallSnapshotMs, 1),
        maxTimeoutMs: stage1StallAbortMs > 0 ? stage1StallAbortMs : null,
        scheduledFileCount: progress?.total || 0,
        activeBatchCount: inFlightFiles.size,
        completedUnits: progress?.count || 0,
        totalUnits: progress?.total || 0,
        elapsedMs: Math.max(0, nowMs - processStart)
      });
      return evaluateProgressTimeout({
        budget,
        heartbeatAgeMs: Math.max(0, nowMs - lastProgressAt),
        queueMovementAgeMs: Math.max(0, nowMs - stage1TimeoutSignals.lastQueueMovementAtMs),
        byteProgressAgeMs: Math.max(0, nowMs - stage1TimeoutSignals.lastByteProgressAtMs),
        queueExpected: orderedPending > 0 || (Number(signals?.orderedSnapshot?.pendingCount) || 0) > 0,
        byteProgressExpected: Boolean(signals?.orderedSnapshot?.flushActive)
          || (Number(signals?.orderedSnapshot?.pendingBytes) || 0) > 0
          || (Number(signals?.postingsSnapshot?.pendingBytes) || 0) > 0
          || (Number(signals?.inFlightBytesTotal) || 0) > 0
      });
    };
    const hasStage1WindowLayoutChanged = (before, after) => {
      const beforeWindows = Array.isArray(before) ? before : [];
      const afterWindows = Array.isArray(after) ? after : [];
      if (beforeWindows.length !== afterWindows.length) return true;
      for (let i = 0; i < beforeWindows.length; i += 1) {
        const left = beforeWindows[i];
        const right = afterWindows[i];
        if (!left || !right) return true;
        if (left.startSeq !== right.startSeq || left.endSeq !== right.endSeq) return true;
        if (left.entryCount !== right.entryCount) return true;
      }
      return false;
    };
    const resolveStage1ComputeUtilization = () => {
      if (!runtime?.scheduler || typeof runtime.scheduler.stats !== 'function') return null;
      try {
        const schedulerStats = runtime.scheduler.stats();
        const utilization = Number(schedulerStats?.utilization?.overall);
        return Number.isFinite(utilization) ? utilization : null;
      } catch {
        return null;
      }
    };
    const resolveStage1WindowTelemetrySnapshot = (nextCommitSeq = null) => {
      const orderedSnapshot = typeof orderedAppender.snapshot === 'function'
        ? orderedAppender.snapshot()
        : null;
      const resolvedNextCommitSeq = Number.isFinite(nextCommitSeq)
        ? Math.floor(nextCommitSeq)
        : Number.isFinite(orderedSnapshot?.nextCommitSeq)
          ? Math.floor(orderedSnapshot.nextCommitSeq)
          : (Number.isFinite(startOrderIndex) ? Math.floor(startOrderIndex) : 0);
      const commitLag = Number(orderedSnapshot?.commitLag);
      const bufferedBytes = Number(orderedSnapshot?.pendingBytes);
      return {
        commitLag: Number.isFinite(commitLag) ? Math.max(0, Math.floor(commitLag)) : 0,
        bufferedBytes: Number.isFinite(bufferedBytes) ? Math.max(0, Math.floor(bufferedBytes)) : 0,
        computeUtilization: resolveStage1ComputeUtilization(),
        nextCommitSeq: resolvedNextCommitSeq
      };
    };
    const maybeReplanStage1Windows = ({
      reason = 'cursor_refresh',
      force = false,
      nextCommitSeq = null
    } = {}) => {
      if (!stage1WindowPlannerConfig.adaptive) {
        return false;
      }
      const resolvedNextCommitSeq = Number.isFinite(nextCommitSeq)
        ? Math.floor(nextCommitSeq)
        : (typeof orderedAppender.peekNextIndex === 'function'
          ? orderedAppender.peekNextIndex()
          : startOrderIndex);
      const nowMs = Date.now();
      const elapsedSinceLastMs = Math.max(0, nowMs - stage1LastWindowReplanAtMs);
      const seqAdvance = Math.max(
        0,
        Math.abs((Number.isFinite(resolvedNextCommitSeq) ? resolvedNextCommitSeq : 0) - stage1LastWindowReplanCommitSeq)
      );
      if (!force && stage1LastWindowReplanAtMs > 0) {
        if (elapsedSinceLastMs < stage1WindowReplanIntervalMs) {
          return false;
        }
        const forcedIdleReplanMs = stage1WindowReplanIntervalMs * 4;
        if (seqAdvance < stage1WindowReplanMinSeqAdvance && elapsedSinceLastMs < forcedIdleReplanMs) {
          return false;
        }
      }
      stage1LastWindowReplanAtMs = nowMs;
      if (Number.isFinite(resolvedNextCommitSeq)) {
        stage1LastWindowReplanCommitSeq = Math.floor(resolvedNextCommitSeq);
      }
      stage1WindowReplanAttemptCount += 1;
      const telemetrySnapshot = resolveStage1WindowTelemetrySnapshot(resolvedNextCommitSeq);
      stage1LastWindowTelemetry = telemetrySnapshot;
      const nextWindows = buildContiguousSeqWindows(stage1WindowPlannerEntries, {
        presorted: true,
        config: stage1WindowPlannerConfig,
        telemetrySnapshot
      });
      if (!Array.isArray(nextWindows) || !nextWindows.length) {
        return false;
      }
      const changed = hasStage1WindowLayoutChanged(stage1SeqWindows, nextWindows);
      if (!changed) {
        return false;
      }
      stage1SeqWindows = nextWindows;
      stage1WindowReplanChangedCount += 1;
      const utilizationText = Number.isFinite(telemetrySnapshot.computeUtilization)
        ? telemetrySnapshot.computeUtilization.toFixed(2)
        : 'n/a';
      logLine(
        `[stage1-window] replanned windows reason=${reason} count=${nextWindows.length}`
          + ` next=${telemetrySnapshot.nextCommitSeq} commitLag=${telemetrySnapshot.commitLag}`
          + ` pendingBytes=${telemetrySnapshot.bufferedBytes} util=${utilizationText}`,
        {
          kind: 'status',
          mode,
          stage: 'processing',
          stage1Windows: {
            reason,
            attempts: stage1WindowReplanAttemptCount,
            changed: stage1WindowReplanChangedCount,
            telemetry: telemetrySnapshot,
            windowCount: nextWindows.length
          }
        }
      );
      return true;
    };
    const refreshStage1ActiveWindows = () => {
      const nextCommitSeq = typeof orderedAppender.peekNextIndex === 'function'
        ? orderedAppender.peekNextIndex()
        : startOrderIndex;
      maybeReplanStage1Windows({
        reason: 'cursor_refresh',
        nextCommitSeq
      });
      stage1ActiveWindows = resolveActiveSeqWindows(stage1SeqWindows, nextCommitSeq, {
        maxActiveWindows: stage1WindowPlannerConfig.maxActiveWindows
      });
      return stage1ActiveWindows;
    };
    const resolveStage1WindowSnapshot = () => {
      const active = refreshStage1ActiveWindows();
      return {
        windowCount: stage1SeqWindows.length,
        activeWindowCount: active.length,
        activeWindows: active.map((window) => ({
          windowId: window.windowId,
          startSeq: window.startSeq,
          endSeq: window.endSeq,
          entryCount: window.entryCount,
          predictedCost: window.predictedCost,
          predictedBytes: window.predictedBytes
        }))
      };
    };
    const isOrderIndexInStage1ActiveWindow = (orderIndex, snapshot = null) => {
      if (!Number.isFinite(orderIndex)) return true;
      const normalizedOrderIndex = Math.floor(orderIndex);
      const activeWindowSnapshot = snapshot || resolveStage1WindowSnapshot();
      return activeWindowSnapshot.activeWindows.some(
        (window) => normalizedOrderIndex >= window.startSeq && normalizedOrderIndex <= window.endSeq
      );
    };
    const waitForStage1ActiveWindow = async (orderIndex, { signal = null } = {}) => {
      if (!Number.isFinite(orderIndex)) {
        return resolveStage1WindowSnapshot();
      }
      const normalizedOrderIndex = Math.floor(orderIndex);
      const pollMs = Math.max(10, Math.min(250, orderedCompletionStallPollMs));
      const timeoutMs = Math.max(1000, orderedCapacityWaitTimeoutMs);
      const startedAtMs = Date.now();
      let stallCount = 0;
      while (true) {
        throwIfAborted(signal);
        const activeWindowSnapshot = resolveStage1WindowSnapshot();
        if (isOrderIndexInStage1ActiveWindow(normalizedOrderIndex, activeWindowSnapshot)) {
          return activeWindowSnapshot;
        }
        stallCount += 1;
        const elapsedMs = Math.max(0, Date.now() - startedAtMs);
        if (stallCount === 1 || (stallCount % 3) === 0) {
          logLine(
            `[ordered] dispatch waiting for active window seq=${normalizedOrderIndex}`
              + ` next=${orderedAppender.peekNextIndex?.() ?? '?'} elapsed=${Math.round(elapsedMs / 1000)}s`,
            {
              kind: 'warning',
              mode,
              stage: 'processing',
              stage1Windows: activeWindowSnapshot
            }
          );
        }
        if (elapsedMs >= timeoutMs) {
          throw createTimeoutError({
            message: `Ordered dispatch active-window wait timed out for seq ${normalizedOrderIndex} after ${timeoutMs}ms.`,
            code: 'ORDERED_ACTIVE_WINDOW_WAIT_TIMEOUT',
            retryable: false,
            meta: {
              orderIndex: normalizedOrderIndex,
              timeoutMs,
              elapsedMs,
              stage1Windows: activeWindowSnapshot,
              nextCommitSeq: orderedAppender.peekNextIndex?.() ?? null
            }
          });
        }
        if (stallCount === 1 || (stallCount % 2) === 0) {
          const recovered = attemptOrderedGapRecovery({
            snapshot: {
              orderedSnapshot: typeof orderedAppender.snapshot === 'function'
                ? orderedAppender.snapshot()
                : null,
              inFlight: inFlightFiles.size
            },
            reason: 'ordered_dispatch_active_window_wait'
          });
          if (Number(recovered?.recovered) > 0) {
            continue;
          }
        }
        evaluateStalledProcessing('ordered_dispatch_active_window_wait');
        await new Promise((resolve) => setTimeout(resolve, pollMs));
      }
    };
    /**
     * Determine whether ordered backlog has entered head-of-line backpressure.
     *
     * In this state, generic file progress is not a reliable liveness signal,
     * because out-of-order work can continue while the ordered head remains
     * blocked and dispatch cannot advance.
     *
     * @param {number} [orderedPending=0]
     * @returns {boolean}
     */
    const isOrderedHeadOfLineBackpressured = (orderedPending = 0) => {
      const normalizedPending = Number.isFinite(Number(orderedPending))
        ? Math.max(0, Math.floor(Number(orderedPending)))
        : 0;
      if (normalizedPending <= 0) return false;
      const liveOrderedThreshold = Number(
        typeof orderedAppender?.snapshot === 'function'
          ? orderedAppender.snapshot()?.maxPendingBeforeBackpressure
          : null
      );
      const configuredLimit = Number(orderedAppenderConfig?.maxPendingBeforeBackpressure);
      const fallbackLimit = Math.max(1, Math.floor(runtime.fileConcurrency || 1));
      const backpressureThreshold = Number.isFinite(liveOrderedThreshold) && liveOrderedThreshold > 0
        ? Math.max(1, Math.floor(liveOrderedThreshold))
        : Number.isFinite(configuredLimit) && configuredLimit > 0
          ? Math.max(1, Math.floor(configuredLimit))
          : fallbackLimit;
      return normalizedPending >= backpressureThreshold;
    };
    /**
     * Resolve stall-idle anchor timestamp for stage1 watchdog decisions.
     *
     * @param {number} [orderedPending=0]
     * @returns {number}
     */
    const resolveStage1LastActivityAt = (orderedPending = 0) => (
      isOrderedHeadOfLineBackpressured(orderedPending)
        ? lastOrderedCompletionAt
        : Math.max(lastProgressAt, lastOrderedCompletionAt)
    );
    /**
     * Collect currently stalled in-flight files for watchdog logging.
     *
     * @param {number} [limit=6]
     * @returns {object[]}
     */
    const collectStalledFiles = (limit = 6) => (
      collectStage1StalledFiles(inFlightFiles, { limit })
    );
    const buildProcessingStallSnapshot = ({
      reason = 'stall_snapshot',
      idleMs = null,
      includeStack = false
    } = {}) => {
      const orderedPending = getOrderedPendingCount();
      return buildStage1ProcessingStallSnapshot({
        reason,
        idleMs,
        includeStack,
        lastProgressAt: resolveStage1LastActivityAt(orderedPending),
        progress,
        processStart,
        inFlightFiles,
        getOrderedPendingCount,
        orderedAppender,
        postingsQueue,
        queueDelaySummary,
        stage1WindowSnapshot: resolveStage1WindowSnapshot(),
        stage1OwnershipPrefix: stage1OwnershipPrefix,
        runtime
      });
    };
    /**
     * Format stalled-file rows for heartbeat/abort logs.
     *
     * @param {object[]} [stalledFiles]
     * @returns {string}
     */
    const toStalledFileText = (stalledFiles = []) => formatStage1StalledFileText(stalledFiles);
    /**
     * Format scheduler stall snapshot to compact log summary.
     *
     * @param {object|null} snapshot
     * @returns {string|null}
     */
    const formatSchedulerStallSummary = (snapshot) => formatStage1SchedulerStallSummary(snapshot);
    /**
     * Summarize soft-kick cleanup results for diagnostics payload.
     *
     * @param {Array<object>} [cleanupResults]
     * @returns {{count:number,timedOut:number,errors:number}}
     */
    const summarizeSoftKickCleanup = (cleanupResults = []) => summarizeStage1SoftKickCleanup(cleanupResults);
    /**
     * Stage1 hard-cutover note:
     * legacy ordered gap recovery is removed. Progress depends on contiguous
     * seq terminalization only. During stalls we only reclaim expired leases.
     *
     * @returns {{recovered:number,start:number|null,end:number|null,nextIndex:number}|null}
     */
    const attemptOrderedGapRecovery = ({
      snapshot = null,
      reason = 'stage1_stall_recovery'
    } = {}) => {
      void snapshot;
      void reason;
      if (!orderedAppender || typeof orderedAppender.reclaimExpiredLeases !== 'function') return null;
      const reclaimedSeqs = orderedAppender.reclaimExpiredLeases();
      if (!Array.isArray(reclaimedSeqs) || reclaimedSeqs.length === 0) return null;
      lastOrderedCompletionAt = Date.now();
      const recovery = {
        recovered: reclaimedSeqs.length,
        start: reclaimedSeqs[0],
        end: reclaimedSeqs[reclaimedSeqs.length - 1],
        nextIndex: typeof orderedAppender.peekNextIndex === 'function'
          ? orderedAppender.peekNextIndex()
          : null
      };
      logLine(
        `[ordered] reclaimed ${recovery.recovered} expired in-flight seq lease(s) ${recovery.start}-${recovery.end}.`,
        {
          kind: 'warning',
          mode,
          stage: 'processing',
          orderedRecovery: recovery
        }
      );
      return recovery;
    };
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
      try {
        const resolvedSnapshot = snapshot || buildProcessingStallSnapshot({
          reason: 'stall_soft_kick',
          idleMs,
          includeStack: true
        });
        const stalledFiles = Array.isArray(resolvedSnapshot?.stalledFiles)
          ? resolvedSnapshot.stalledFiles
          : collectStalledFiles(6);
        const recoveredRange = attemptOrderedGapRecovery({
          snapshot: resolvedSnapshot,
          reason: `stage1_soft_kick:${attempt}:${source}`
        });
        if (Number(recoveredRange?.recovered) > 0) {
          stage1StallSoftKickSuccessCount += 1;
          return;
        }
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
        }
      } finally {
        // Reset the latch on *all* exits, including fast recovery returns.
        stage1StallSoftKickInFlight = false;
      }
    };
    /**
     * Evaluate current idle state and trigger soft-kick/abort actions as needed.
     *
     * @param {string} [source='watchdog']
     * @returns {void}
     */
    const evaluateStalledProcessing = (source = 'watchdog') => {
      if (!progress || stage1StallAbortTriggered) return;
      const orderedPending = getOrderedPendingCount();
      if (progress.count >= progress.total && inFlightFiles.size === 0 && orderedPending === 0) return;
      const now = Date.now();
      const lastActivityAt = resolveStage1LastActivityAt(orderedPending);
      const idleMs = Math.max(0, now - lastActivityAt);
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
      const timeoutDecision = resolveStage1TimeoutDecision({
        nowMs: now,
        orderedPending
      });
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
      if (!timeoutDecision.timedOut) {
        return;
      }
      const recoveredBeforeAbort = attemptOrderedGapRecovery({
        snapshot,
        reason: `stage1_stall_abort:${source}`
      });
      if (Number(recoveredBeforeAbort?.recovered) > 0) {
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
          softKickAttempts: stage1StallSoftKickAttempts,
          timeoutClass: timeoutDecision.timeoutClass,
          timeoutBudget: timeoutDecision.budget,
          observedProgress: timeoutDecision.observedProgress
        }
      });
      logLine(
        `[watchdog] stall-timeout class=${timeoutDecision.timeoutClass || 'unknown'} `
          + `idle=${Math.round(idleMs / 1000)}s progress=${progress.count}/${progress.total}; aborting stage1.`,
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
          timeoutClass: timeoutDecision.timeoutClass,
          timeoutBudget: timeoutDecision.budget,
          observedProgress: timeoutDecision.observedProgress,
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
    /**
     * Emit a watchdog stall snapshot event/log payload.
     *
     * @returns {void}
     */
    const emitProcessingStallSnapshot = () => {
      if (stallSnapshotMs <= 0 || !progress) return;
      const orderedPending = getOrderedPendingCount();
      if (progress.count >= progress.total && inFlightFiles.size === 0 && orderedPending === 0) return;
      const now = Date.now();
      const lastActivityAt = resolveStage1LastActivityAt(orderedPending);
      const idleMs = Math.max(0, now - lastActivityAt);
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
      const flushActive = snapshot?.orderedSnapshot?.flushActive && typeof snapshot.orderedSnapshot.flushActive === 'object'
        ? snapshot.orderedSnapshot.flushActive
        : null;
      const flushText = flushActive
        ? ` flush=${flushActive.orderIndex ?? '?'}@${Math.round((Number(flushActive.elapsedMs) || 0) / 1000)}s`
        : '';
      logLine(
        `[watchdog] stall snapshot idle=${Math.round(idleMs / 1000)}s progress=${progress.count}/${progress.total} `
          + `next=${snapshot?.orderedSnapshot?.nextIndex ?? '?'} pending=${snapshot?.orderedSnapshot?.pendingCount ?? '?'} `
          + `orderedPending=${snapshot?.orderedPending ?? 0} inFlight=${inFlightFiles.size} `
          + `trackedSubprocesses=${trackedSubprocesses}${flushText}`,
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
    /**
     * Emit periodic progress heartbeat and run stall evaluation.
     *
     * @returns {void}
     */
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
        + `softKickMaxAttempts=${stage1StallSoftKickMaxAttempts} orderedFlushTimeout=${orderedFlushTimeoutMs}ms`,
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
          abortMs: stage1StallAbortMs,
          orderedFlushTimeoutMs
        }
      }
    );
    let preDispatchPhase = 'initializing';
    let preDispatchPhaseAtMs = Date.now();
    const markPreDispatchPhase = (phase) => {
      preDispatchPhase = phase;
      preDispatchPhaseAtMs = Date.now();
    };
    const clearPreDispatchWatchdog = () => {
      if (typeof preDispatchWatchdogTimer === 'object' && preDispatchWatchdogTimer) {
        clearInterval(preDispatchWatchdogTimer);
      }
      preDispatchWatchdogTimer = null;
    };
    const preDispatchHeartbeatMs = Math.max(10000, progressHeartbeatMs || FILE_PROGRESS_HEARTBEAT_DEFAULT_MS);
    if (preDispatchHeartbeatMs > 0) {
      preDispatchWatchdogTimer = setInterval(() => {
        if (stage1StallAbortTriggered) return;
        const elapsedMs = Math.max(0, Date.now() - preDispatchPhaseAtMs);
        if (elapsedMs >= preDispatchHeartbeatMs) {
          logLine(
            `[watchdog] pre-dispatch heartbeat phase=${preDispatchPhase} elapsed=${Math.round(elapsedMs / 1000)}s`,
            {
              kind: 'warning',
              mode,
              stage: 'processing',
              preDispatchPhase,
              idleMs: elapsedMs
            }
          );
        }
        if (stage1StallAbortMs > 0 && elapsedMs >= stage1StallAbortMs) {
          stage1StallAbortTriggered = true;
          const err = createTimeoutError({
            message: `Stage1 pre-dispatch stalled in phase=${preDispatchPhase} for ${elapsedMs}ms`,
            code: 'FILE_PROCESS_STALL_TIMEOUT',
            retryable: false,
            meta: {
              phase: preDispatchPhase,
              elapsedMs
            }
          });
          orderedAppender.abort(err);
          abortProcessing(err);
        }
      }, preDispatchHeartbeatMs);
      preDispatchWatchdogTimer.unref?.();
    }
    /**
     * Process one shard or global entry list with stage1 watchdog integration.
     *
     * @param {{entries:object[],runtime:object,shardMeta?:object|null,stateRef:object}} input
     * @returns {Promise<void>}
     */
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
        documentExtractionCache: documentExtractionCacheStore,
        extractedProseYieldProfile,
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
      /**
       * Execute one bounded entry batch and update queue telemetry around it.
       *
       * @param {object[]} batchEntries
       * @returns {Promise<void>}
       */
      const runEntryBatch = async (batchEntries) => {
        const orderedBatchEntries = sortEntriesByOrderIndex(batchEntries);
        for (let i = 0; i < orderedBatchEntries.length; i += 1) {
          const entry = orderedBatchEntries[i];
          const orderIndex = resolveStableEntryOrderIndex(entry, i);
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
        await runWithQueue(
          runtimeRef.queues.cpu,
          orderedBatchEntries,
          async (entry, ctx) => {
            const queueIndex = Number.isFinite(ctx?.index) ? ctx.index : null;
            const orderIndex = resolveStableEntryOrderIndex(entry, queueIndex);
            if (Number.isFinite(orderIndex) && typeof orderedAppender.noteInFlight === 'function') {
              orderedAppender.noteInFlight(Math.floor(orderIndex), Number(entry?.fileIndex) || 0);
            }
            const stableFileIndex = Number.isFinite(entry?.fileIndex)
              ? entry.fileIndex
              : (Number.isFinite(queueIndex) ? queueIndex + 1 : null);
            const rel = entry.rel || toPosix(path.relative(runtimeRef.root, entry.abs));
            if (shouldSkipExtractedProseForLowYield({
              bailout: extractedProseLowYieldBailout,
              orderIndex,
              entry
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
              recordExtractedProseYieldObservation({ entry, result: null });
              if (Number.isFinite(orderIndex)) {
                lowYieldBypassOrderIndices.add(Math.floor(orderIndex));
              }
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
                (signal) => {
                  if (stage1ShuttingDown) {
                    const err = new Error('[cleanup] stage1 tail cleanup has started; refusing new process-file task.');
                    err.code = 'ERR_STAGE1_SHUTTING_DOWN';
                    throw err;
                  }
                  const rawProcessFileTask = withTrackedSubprocessSignalScope(
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
                  );
                  inFlightProcessFileTasks.track(rawProcessFileTask, {
                    file: rel,
                    fileIndex: stableFileIndex,
                    orderIndex,
                    shardId: shardMeta?.id || null,
                    ownershipId: fileSubprocessOwnershipId,
                    startedAtMs: activeStartAtMs
                  });
                  return rawProcessFileTask;
                },
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
            }
          },
          {
            collectResults: false,
            signal: effectiveAbortSignal,
            onBeforeDispatch: async (ctx) => {
              if (typeof orderedAppender.waitForCapacity === 'function') {
                const entryIndex = Number.isFinite(ctx?.index) ? ctx.index : 0;
                const entry = orderedBatchEntries[entryIndex];
                const orderIndex = resolveStableEntryOrderIndex(entry, entryIndex);
                await waitForStage1ActiveWindow(orderIndex, {
                  signal: effectiveAbortSignal
                });
                const dispatchBypassWindow = Math.max(1, Math.floor(runtimeRef.fileConcurrency || 1));
                const nextOrderedIndex = typeof orderedAppender.peekNextIndex === 'function'
                  ? orderedAppender.peekNextIndex()
                  : null;
                const withinBypassWindow = Number.isFinite(orderIndex)
                    && Number.isFinite(nextOrderedIndex)
                    && orderIndex <= (nextOrderedIndex + dispatchBypassWindow);
                const shouldProbeCapacity = entryIndex === 0
                    || (entryIndex % dispatchBypassWindow) === 0;
                if (!withinBypassWindow && shouldProbeCapacity) {
                  await orderedAppender.waitForCapacity({
                    orderIndex,
                    bypassWindow: dispatchBypassWindow,
                    signal: effectiveAbortSignal,
                    timeoutMs: orderedCapacityWaitTimeoutMs,
                    stallPollMs: orderedCompletionStallPollMs,
                    onStall: ({ stallCount, elapsedMs, pending, nextIndex, snapshot }) => {
                      if (stallCount === 1 || (stallCount % 3) === 0) {
                        logLine(
                          `[ordered] dispatch capacity wait pending=${pending} elapsed=${Math.round(elapsedMs / 1000)}s`
                              + ` next=${nextIndex ?? '?'} order=${orderIndex}`,
                          {
                            kind: 'warning',
                            mode,
                            stage: 'processing',
                            orderedPending: pending,
                            idleMs: elapsedMs,
                            orderedSnapshot: snapshot || null
                          }
                        );
                      }
                      if (stallCount === 1 || (stallCount % 2) === 0) {
                        const recovered = attemptOrderedGapRecovery({
                          snapshot: {
                            orderedSnapshot: snapshot || null,
                            inFlight: inFlightFiles.size
                          },
                          reason: 'ordered_dispatch_capacity_wait'
                        });
                        if (Number(recovered?.recovered) > 0) return;
                      }
                      evaluateStalledProcessing('ordered_dispatch_capacity_wait');
                    }
                  });
                }
              }
              orderedCompletionTracker.throwIfFailed();
            },
            onResult: async (result, ctx) => {
              const entryIndex = Number.isFinite(ctx?.index) ? ctx.index : 0;
              const entry = orderedBatchEntries[entryIndex];
              const orderIndex = resolveStableEntryOrderIndex(entry, entryIndex);
              try {
                const bypassedForLowYield = Number.isFinite(orderIndex)
                  ? lowYieldBypassOrderIndices.delete(Math.floor(orderIndex))
                  : false;
                if (!bypassedForLowYield) {
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
                  recordExtractedProseYieldObservation({ entry, result });
                }
                if (!result) {
                  if (entry?.rel) lifecycleByRelKey.delete(entry.rel);
                  if (Number.isFinite(orderIndex)) {
                    lifecycleByOrderIndex.delete(Math.floor(orderIndex));
                  }
                  const completion = orderedAppender.skip(orderIndex);
                  markOrderedEntryComplete(
                    orderIndex,
                    shardProgress,
                    entry?.rel || (entry?.abs ? toPosix(path.relative(runtimeRef.root, entry.abs)) : null)
                  );
                  orderedCompletionTracker.track(completion, () => {
                    lastOrderedCompletionAt = Date.now();
                    refreshStage1ActiveWindows();
                  });
                  return;
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
                const completion = orderedAppender.enqueue(orderIndex, result, shardMeta);
                markOrderedEntryComplete(
                  orderIndex,
                  shardProgress,
                  entry?.rel || (entry?.abs ? toPosix(path.relative(runtimeRef.root, entry.abs)) : null)
                );
                orderedCompletionTracker.track(completion, () => {
                  lastOrderedCompletionAt = Date.now();
                  refreshStage1ActiveWindows();
                });
              } finally {
                clearInFlightFile(orderIndex);
              }
            },
            onError: async (err, ctx) => {
              const entryIndex = Number.isFinite(ctx?.index) ? ctx.index : 0;
              const entry = orderedBatchEntries[entryIndex];
              const orderIndex = resolveStableEntryOrderIndex(entry, entryIndex);
              try {
                observeExtractedProseLowYieldSample({
                  bailout: extractedProseLowYieldBailout,
                  orderIndex,
                  result: null
                });
                recordExtractedProseYieldObservation({ entry, result: null });
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
                if (entry?.rel) lifecycleByRelKey.delete(entry.rel);
                if (Number.isFinite(orderIndex)) {
                  lifecycleByOrderIndex.delete(Math.floor(orderIndex));
                }
                const completion = orderedAppender.skip(orderIndex);
                markOrderedEntryComplete(
                  orderIndex,
                  shardProgress,
                  entry?.rel || (entry?.abs ? toPosix(path.relative(runtimeRef.root, entry.abs)) : null)
                );
                orderedCompletionTracker.track(completion, () => {
                  lastOrderedCompletionAt = Date.now();
                  refreshStage1ActiveWindows();
                });
              } finally {
                clearInFlightFile(orderIndex);
              }
            },
            retries: 2,
            retryDelayMs: 200,
            signal: effectiveAbortSignal,
            requireSignal: true,
            signalLabel: 'build.stage1.process-files.runWithQueue',
            pendingDrainTimeoutMs: orderedCompletionGuardTimeoutMs,
            pendingDrainStallPollMs: orderedCompletionStallPollMs,
            onPendingDrainStall: ({ pending, elapsedMs }) => {
              if (pending <= 0) return;
              const elapsedSeconds = Math.max(0, Math.round(elapsedMs / 1000));
              if (elapsedSeconds === 0) return;
              if (elapsedSeconds % 15 !== 0) return;
              logLine(
                `[ordered] queue pending-drain waiting pending=${pending} elapsed=${elapsedSeconds}s`,
                {
                  kind: 'warning',
                  mode,
                  stage: 'processing',
                  orderedPending: pending,
                  idleMs: elapsedMs
                }
              );
            }
          }
        );
        attemptOrderedGapRecovery({
          snapshot: {
            orderedSnapshot: typeof orderedAppender.snapshot === 'function'
              ? orderedAppender.snapshot()
              : null,
            inFlight: inFlightFiles.size
          },
          reason: 'queue_drain_pre_wait'
        });
        orderedCompletionTracker.throwIfFailed();
      };
      try {
        await runEntryBatch(shardEntries);
      } catch (err) {
        const retryEnabled = shardMeta?.allowRetry === true;
        if (retryEnabled) {
          const retryOrderIndices = shardEntries
            .map((entry, entryIndex) => resolveStableEntryOrderIndex(entry, entryIndex))
            .filter((value) => Number.isFinite(value))
            .map((value) => Math.floor(value));
          await drainTrackedProcessFileTasks({
            registry: inFlightProcessFileTasks,
            timeoutMs: orderedCompletionGuardTimeoutMs,
            log,
            logMeta: {
              kind: 'warning',
              mode,
              stage: 'processing',
              shardId: shardMeta?.id || null
            },
            onTimeout: async (timeoutError) => {
              orderedAppender.abort(timeoutError);
              abortProcessing(timeoutError);
            }
          });
          if (typeof orderedAppender.resetForRetry === 'function') {
            const resetCount = orderedAppender.resetForRetry(retryOrderIndices);
            if (resetCount > 0) {
              logLine(
                `[ordered] reset ${resetCount} non-terminal seq(s) for retry in shard ${shardMeta?.id || 'unknown'}.`,
                {
                  kind: 'warning',
                  mode,
                  stage: 'processing',
                  shardId: shardMeta?.id || null,
                  orderedResetCount: resetCount
                }
              );
            }
          }
        } else {
          // If the shard processing fails before a contiguous `orderIndex` is
          // enqueued, later tasks may be blocked waiting for an ordered flush.
          // Abort rejects any waiting promises to prevent hangs/leaks.
          orderedAppender.abort(err);
          abortProcessing(err);
        }
        throw err;
      }
    };
    /**
     * Drain all ordered completions once every shard/subset has dispatched work.
     *
     * Draining per subset can create a circular wait where a high-order subset
     * waits on lower indices that belong to a subset not yet scheduled on that
     * worker. Waiting once at mode tail guarantees those lower indices have had
     * a chance to run before we enforce full ordered completion.
     *
     * @returns {Promise<void>}
     */
    const awaitOrderedCompletionDrain = async () => {
      attemptOrderedGapRecovery({
        snapshot: {
          orderedSnapshot: typeof orderedAppender.snapshot === 'function'
            ? orderedAppender.snapshot()
            : null,
          inFlight: inFlightFiles.size
        },
        reason: 'queue_drain_pre_wait'
      });
      if (typeof orderedAppender.drain === 'function') {
        orderedAppender.drain().catch(() => {});
      }
      await runWithTimeout(
        (timeoutSignal) => orderedCompletionTracker.wait({
          timeoutMs: effectiveOrderedCompletionTimeoutMs,
          stallPollMs: orderedCompletionStallPollMs,
          signal: composeAbortSignals(effectiveAbortSignal, timeoutSignal),
          onStall: ({ pending, stallCount, elapsedMs }) => {
            const orderedSnapshot = typeof orderedAppender.snapshot === 'function'
              ? orderedAppender.snapshot()
              : null;
            const flushActive = orderedSnapshot?.flushActive && typeof orderedSnapshot.flushActive === 'object'
              ? orderedSnapshot.flushActive
              : null;
            const flushActiveText = flushActive
              ? ` flush=${flushActive.orderIndex ?? '?'}@${Math.round((Number(flushActive.elapsedMs) || 0) / 1000)}s`
              : '';
            const seenCount = Number(orderedSnapshot?.seenCount);
            const expectedCount = Number(orderedSnapshot?.expectedCount);
            const seenText = Number.isFinite(expectedCount) && expectedCount > 0 && Number.isFinite(seenCount)
              ? ` seen=${seenCount}/${expectedCount}`
              : '';
            const committedCount = Number(orderedSnapshot?.committedCount);
            const commitText = Number.isFinite(expectedCount) && expectedCount > 0 && Number.isFinite(committedCount)
              ? ` committed=${committedCount}/${expectedCount}`
              : '';
            const drainRunCount = Number(orderedSnapshot?.drainRunCount);
            const drainCommitCount = Number(orderedSnapshot?.drainCommitCount);
            const drainText = Number.isFinite(drainRunCount) || Number.isFinite(drainCommitCount)
              ? ` drain=${Number.isFinite(drainRunCount) ? drainRunCount : '?'}:${Number.isFinite(drainCommitCount) ? drainCommitCount : '?'}`
              : '';
            const drainErrorCode = typeof orderedSnapshot?.drainLastErrorCode === 'string' && orderedSnapshot.drainLastErrorCode
              ? ` drainErr=${orderedSnapshot.drainLastErrorCode}`
              : '';
            const drainPhase = typeof orderedSnapshot?.drainPhase === 'string' && orderedSnapshot.drainPhase
              ? ` phase=${orderedSnapshot.drainPhase}`
              : '';
            const headState = Number(orderedSnapshot?.headState);
            const headTerminalState = Number(orderedSnapshot?.headTerminalState);
            const headStateText = Number.isFinite(headState)
              ? ` head=${headState}${Number.isFinite(headTerminalState) ? `/${headTerminalState}` : ''}`
              : '';
            const abortedText = orderedSnapshot?.aborted === true ? ' aborted=1' : '';
            if (stallCount === 1 || (stallCount % 3) === 0) {
              logLine(
                `[ordered] completion drain waiting pending=${pending} elapsed=${Math.round(elapsedMs / 1000)}s`
                  + ` next=${orderedSnapshot?.nextIndex ?? '?'}${seenText}${commitText}${headStateText}${abortedText}${drainText}${drainErrorCode}${drainPhase}${flushActiveText}`,
                {
                  kind: 'warning',
                  mode,
                  stage: 'processing',
                  orderedPending: pending,
                  idleMs: elapsedMs,
                  orderedSnapshot: orderedSnapshot || null
                }
              );
            }
            if (stallCount === 1 || (stallCount % 2) === 0) {
              if (typeof orderedAppender.drain === 'function') {
                orderedAppender.drain().catch(() => {});
              }
              const recovered = attemptOrderedGapRecovery({
                snapshot: {
                  orderedSnapshot,
                  inFlight: inFlightFiles.size
                },
                reason: 'ordered_completion_wait'
              });
              if (Number(recovered?.recovered) > 0) return;
            }
            evaluateStalledProcessing('ordered_completion_wait');
          }
        }),
        {
          timeoutMs: orderedCompletionGuardTimeoutMs,
          signal: effectiveAbortSignal,
          errorFactory: () => createTimeoutError({
            message: `Ordered completion wait guard timed out after ${orderedCompletionGuardTimeoutMs}ms.`,
            code: 'ORDERED_COMPLETION_WAIT_TIMEOUT',
            retryable: false,
            meta: {
              timeoutMs: orderedCompletionGuardTimeoutMs,
              completionTimeoutMs: effectiveOrderedCompletionTimeoutMs,
              stallPollMs: orderedCompletionStallPollMs,
              mode
            }
          })
        }
      );
      orderedCompletionTracker.throwIfFailed();
      if (typeof orderedAppender.assertCompletion === 'function') {
        orderedAppender.assertCompletion();
      }
    };

    const discoveryLineCounts = discovery?.lineCounts instanceof Map ? discovery.lineCounts : null;
    markPreDispatchPhase('line-counts');
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
    markPreDispatchPhase('shard-planning');
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
    markPreDispatchPhase('checkpoint-setup');
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
        const orderedPending = getOrderedPendingCount();
        const orderedHeadBlocked = isOrderedHeadOfLineBackpressured(orderedPending);
        if (stage1StallSoftKickAttempts > 0 && !orderedHeadBlocked) {
          stage1StallSoftKickAttempts = 0;
          lastStallSoftKickAt = 0;
          stage1StallSoftKickResetCount += 1;
        }
      }
    });
    progress = stage1ProgressTracker.progress;
    markOrderedEntryComplete = stage1ProgressTracker.markOrderedEntryComplete;
    getStage1ProgressSnapshot = stage1ProgressTracker.snapshot;
    if (stallSnapshotMs > 0) {
      const stallSnapshotIntervalMs = Math.max(250, Math.floor(stallSnapshotMs / 2));
      stallSnapshotTimer = setInterval(() => {
        emitProcessingStallSnapshot();
      }, stallSnapshotIntervalMs);
      stallSnapshotTimer.unref?.();
    }
    if (progressHeartbeatMs > 0) {
      progressHeartbeatTimer = setInterval(() => {
        emitProcessingProgressHeartbeat();
      }, progressHeartbeatMs);
      progressHeartbeatTimer.unref?.();
    }
    clearPreDispatchWatchdog();
    markPreDispatchPhase('stage1-dispatch');
    const shardQueuePlan = shardPlan && shardPlan.length > 1
      ? resolveStage1ShardExecutionQueuePlan({
        shardPlan,
        runtime,
        clusterModeEnabled,
        clusterDeterministicMerge
      })
      : null;
    ({
      shardSummary,
      shardExecutionMeta
    } = await executeStage1ShardProcessing({
      entries,
      runtime,
      state,
      envConfig,
      mode,
      relationsEnabled,
      shardPlan,
      initialShardSummary: shardSummary,
      shardQueuePlan,
      clusterModeEnabled,
      clusterDeterministicMerge,
      clusterRetryConfig,
      awaitStage1Barrier,
      processEntries,
      orderedAppender,
      abortProcessing,
      log,
      logLine
    }));
    await awaitStage1Barrier(awaitOrderedCompletionDrain());
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
    if (mode === 'extracted-prose') {
      const profileConfig = normalizeExtractedProseYieldProfilePrefilterConfig(
        runtime?.indexingConfig?.extractedProse?.prefilter?.yieldProfile || null
      );
      const existingProfileEntry = normalizeYieldProfileEntry(
        extractedProseYieldProfileState?.entries?.['extracted-prose'],
        profileConfig
      );
      const mergedFamilies = { ...(existingProfileEntry.families || {}) };
      const mergedCohorts = { ...(existingProfileEntry.cohorts || {}) };
      for (const [familyKey, familyStats] of extractedProseYieldRunStats.families.entries()) {
        const current = normalizeYieldProfileFamilyStats(mergedFamilies[familyKey] || null);
        mergedFamilies[familyKey] = normalizeYieldProfileFamilyStats({
          observedFiles: current.observedFiles + toSafeNonNegativeInt(familyStats?.observedFiles),
          yieldedFiles: current.yieldedFiles + toSafeNonNegativeInt(familyStats?.yieldedFiles),
          chunkCount: current.chunkCount + toSafeNonNegativeInt(familyStats?.chunkCount)
        });
      }
      for (const [cohortKey, cohortStats] of extractedProseYieldRunStats.cohorts.entries()) {
        const current = normalizeYieldProfileFamilyStats(mergedCohorts[cohortKey] || null);
        mergedCohorts[cohortKey] = normalizeYieldProfileFamilyStats({
          observedFiles: current.observedFiles + toSafeNonNegativeInt(cohortStats?.observedFiles),
          yieldedFiles: current.yieldedFiles + toSafeNonNegativeInt(cohortStats?.yieldedFiles),
          chunkCount: current.chunkCount + toSafeNonNegativeInt(cohortStats?.chunkCount)
        });
      }
      const mergedTotals = normalizeYieldProfileFamilyStats({
        observedFiles: toSafeNonNegativeInt(existingProfileEntry.totals?.observedFiles)
          + extractedProseYieldRunStats.observedFiles,
        yieldedFiles: toSafeNonNegativeInt(existingProfileEntry.totals?.yieldedFiles)
          + extractedProseYieldRunStats.yieldedFiles,
        chunkCount: toSafeNonNegativeInt(existingProfileEntry.totals?.chunkCount)
          + extractedProseYieldRunStats.chunkCount
      });
      const mergedProfileEntry = {
        config: profileConfig,
        builds: toSafeNonNegativeInt(existingProfileEntry.builds) + 1,
        totals: mergedTotals,
        families: mergedFamilies,
        cohorts: mergedCohorts,
        fingerprint: extractedProseLowYieldBailout?.repoFingerprint || existingProfileEntry.fingerprint || null
      };
      const mergedYieldProfileState = {
        version: EXTRACTED_PROSE_YIELD_PROFILE_VERSION,
        entries: {
          'extracted-prose': mergedProfileEntry
        }
      };
      await persistExtractedProseYieldProfileState({
        runtime,
        state: mergedYieldProfileState,
        log
      });
      await persistDocumentExtractionCacheState({
        runtime,
        cacheStore: documentExtractionCacheStore,
        log
      });
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
    showProgress('Files', progress.total, progress.total, { stage: 'processing', mode });
    return finalizeStage1ProcessingResult({
      mode,
      log,
      logLine,
      logLexiconFilterAggregate,
      timing,
      state,
      shardSummary,
      shardPlan,
      shardExecutionMeta,
      stallRecovery: {
        softKickAttempts: stage1StallSoftKickAttempts,
        softKickSuccessfulAttempts: stage1StallSoftKickSuccessCount,
        softKickResetCount: stage1StallSoftKickResetCount,
        softKickThresholdMs: stage1StallSoftKickMs,
        softKickCooldownMs: stage1StallSoftKickCooldownMs,
        softKickMaxAttempts: stage1StallSoftKickMaxAttempts,
        stallAbortMs: stage1StallAbortMs
      },
      checkpoint,
      processStart,
      buildStageTimingBreakdownPayload,
      buildExtractedProseLowYieldBailoutSummary,
      extractedProseLowYieldBailout,
      stage1WindowPlannerConfig,
      stage1WindowReplanIntervalMs,
      stage1WindowReplanMinSeqAdvance,
      stage1WindowReplanAttemptCount,
      stage1WindowReplanChangedCount,
      stage1LastWindowTelemetry,
      stage1SeqWindows,
      resolveStage1WindowSnapshot,
      expectedOrderIndices,
      getStage1ProgressSnapshot,
      orderedAppender,
      resolveStage1OrderingIntegrity,
      startOrderIndex,
      orderIndexToRel,
      postingsQueue,
      tokenizationStats
    });
  } finally {
    stage1ShuttingDown = true;
    inFlightProcessFileTasks.seal('stage1 tail cleanup');
    if (orderedCompletionTracker) {
      activeOrderedCompletionTrackers.delete(orderedCompletionTracker);
    }
    if (typeof stallSnapshotTimer === 'object' && stallSnapshotTimer) {
      clearInterval(stallSnapshotTimer);
    }
    if (typeof progressHeartbeatTimer === 'object' && progressHeartbeatTimer) {
      clearInterval(progressHeartbeatTimer);
    }
    if (typeof stallAbortTimer === 'object' && stallAbortTimer) {
      clearInterval(stallAbortTimer);
    }
    if (typeof preDispatchWatchdogTimer === 'object' && preDispatchWatchdogTimer) {
      clearInterval(preDispatchWatchdogTimer);
    }
    if (typeof detachExternalAbort === 'function') {
      detachExternalAbort();
    }
    runtime?.telemetry?.clearInFlightBytes?.('stage1.postings-queue');
    runtime?.telemetry?.clearDurationHistogram?.(queueDelayTelemetryChannel);
    await runWithHangProbe({
      ...hangProbeConfig,
      label: 'stage1.tail-cleanup',
      mode,
      stage: 'processing',
      step: 'cleanup',
      log: logLine,
      meta: { cleanupTimeoutMs },
      run: () => runStage1TailCleanupTasks({
        sequential: true,
        tasks: [
          {
            label: 'stage1.process-file-drain',
            run: async () => {
              const drainLog = (line, meta) => logLine(line, {
                ...(meta || {}),
                mode,
                stage: 'processing'
              });
              const drainResult = await drainTrackedProcessFileTasks({
                registry: inFlightProcessFileTasks,
                timeoutMs: cleanupTimeoutMs,
                log: drainLog,
                logMeta: {
                  mode,
                  stage: 'processing'
                },
                onTimeout: async (_error, pendingEntries) => {
                  const subprocessSnapshot = snapshotTrackedSubprocesses({
                    ownershipPrefix: stage1OwnershipPrefix,
                    limit: 12
                  });
                  if (subprocessSnapshot.total > 0) {
                    drainLog(
                      `[cleanup] stage1 process-file drain timeout retained ${subprocessSnapshot.total} tracked subprocess(es) `
                        + `for ${stage1OwnershipPrefix}`,
                      {
                        kind: 'warning',
                        stage1Drain: {
                          pendingCount: Array.isArray(pendingEntries) ? pendingEntries.length : 0,
                          trackedSubprocesses: subprocessSnapshot
                        }
                      }
                    );
                  }
                  const cleanup = await terminateTrackedSubprocesses({
                    reason: 'stage1_process_file_drain_timeout',
                    force: true,
                    ownershipPrefix: stage1OwnershipPrefix
                  });
                  if (cleanup?.attempted > 0) {
                    drainLog(
                      `[cleanup] forced termination of ${cleanup.attempted} stage1 tracked subprocess(es) `
                        + `after process-file drain timeout.`,
                      {
                        kind: 'warning',
                        cleanup
                      }
                    );
                  }
                }
              });
              if (!drainResult?.timedOut) {
                return drainResult;
              }
              const drainRetry = await runCleanupWithTimeout({
                label: 'stage1.process-file-drain.retry',
                cleanup: () => inFlightProcessFileTasks.drain(),
                timeoutMs: cleanupTimeoutMs,
                log: drainLog,
                logMeta: {
                  mode,
                  stage: 'processing'
                }
              });
              if (drainRetry?.timedOut) {
                const pendingEntries = inFlightProcessFileTasks.snapshot();
                const drainError = createTimeoutError({
                  message: `[cleanup] stage1 process-file drain failed with ${pendingEntries.length} pending task(s).`,
                  code: 'STAGE1_PROCESS_FILE_DRAIN_TIMEOUT',
                  retryable: false,
                  meta: {
                    pendingCount: pendingEntries.length,
                    pendingEntries: pendingEntries.slice(0, 12)
                  }
                });
                throw drainError;
              }
              return {
                skipped: false,
                timedOut: true,
                elapsedMs: (Number(drainResult?.elapsedMs) || 0) + (Number(drainRetry?.elapsedMs) || 0)
              };
            }
          },
          {
            label: 'perf-event-logger.close',
            run: () => runCleanupWithTimeout({
              label: 'perf-event-logger.close',
              cleanup: () => perfEventLogger.close(),
              timeoutMs: cleanupTimeoutMs,
              log: (line, meta) => logLine(line, {
                ...(meta || {}),
                mode,
                stage: 'processing'
              })
            })
          },
          {
            label: 'tree-sitter-scheduler.close',
            run: () => closeTreeSitterScheduler({
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
            })
          }
        ],
        logSummary: ({ outcomes, elapsedMs, fatalErrors }) => {
          const timeoutLabels = outcomes.filter((outcome) => outcome.timedOut).map((outcome) => outcome.label);
          const summaryText = outcomes
            .map((outcome) => (
              `${outcome.label}:${outcome.skipped ? 'skipped' : (outcome.timedOut ? 'timeout' : 'ok')}(${outcome.elapsedMs}ms)`
            ))
            .join(', ');
          const baseMeta = {
            mode,
            stage: 'processing',
            cleanup: {
              elapsedMs,
              timeoutLabels,
              fatalLabels: fatalErrors.map((entry) => entry.label)
            }
          };
          if (timeoutLabels.length > 0 || fatalErrors.length > 0) {
            logLine(
              `[cleanup] stage1 tail cleanup completed with warnings in ${elapsedMs}ms (${summaryText}).`,
              {
                kind: 'warning',
                ...baseMeta
              }
            );
            return;
          }
          if (elapsedMs >= 1000) {
            logLine(
              `[cleanup] stage1 tail cleanup completed in ${elapsedMs}ms (${summaryText}).`,
              baseMeta
            );
          }
        }
      })
    });
  }
};

