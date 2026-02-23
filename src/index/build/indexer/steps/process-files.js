import path from 'node:path';
import {
  runWithQueue,
  createOrderedCompletionTracker as createSharedOrderedCompletionTracker
} from '../../../../shared/concurrency.js';
import { getEnvConfig } from '../../../../shared/env.js';
import { toPosix } from '../../../../shared/files.js';
import { countLinesForEntries } from '../../../../shared/file-stats.js';
import { log, logLine, showProgress } from '../../../../shared/progress.js';
import { createTimeoutError, runWithTimeout } from '../../../../shared/promise-timeout.js';
import { coercePositiveInt } from '../../../../shared/number-coerce.js';
import { throwIfAborted } from '../../../../shared/abort.js';
import {
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
import { createTokenRetentionState } from './postings.js';
import { createPostingsQueue, estimatePostingsPayload } from './process-files/postings-queue.js';
import { createStage1PostingsQueueTelemetry } from './process-files/postings-telemetry.js';
import { buildOrderedAppender } from './process-files/ordered.js';
import { createShardRuntime, resolveCheckpointBatchSize } from './process-files/runtime.js';
import { createStage1FileResultApplier } from './process-files/result-application.js';
import {
  buildDeterministicShardMergePlan,
  normalizeOwnershipSegment,
  resolveClusterSubsetRetryConfig,
  resolveEntryOrderIndex,
  resolveShardSubsetId,
  resolveShardSubsetMinOrderIndex,
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
import {
  assignFileIndexes,
  createStage1ProgressTracker,
  resolveOrderedEntryProgressPlan,
  resolveStage1ShardExecutionQueuePlan
} from './process-files/stage1-execution-plan.js';
import { createStage1TimingAggregator } from './process-files/stage-timing.js';
import {
  buildWatchdogNearThresholdSummary as buildWatchdogNearThresholdSummaryShared,
  createDurationHistogram as createDurationHistogramShared,
  isNearThresholdSlowFileDuration as isNearThresholdSlowFileDurationShared,
  resolveFileLifecycleDurations as resolveFileLifecycleDurationsShared,
  resolveStageTimingSizeBin as resolveStageTimingSizeBinShared,
  shouldTriggerSlowFileWarning as shouldTriggerSlowFileWarningShared
} from './process-files/watchdog.js';
import {
  createStage1ProcessingWatchdog
} from './process-files/stage1-watchdog-controller.js';
import { SCHEDULER_QUEUE_NAMES } from '../../runtime/scheduler.js';
import { INDEX_PROFILE_VECTOR_ONLY } from '../../../../contracts/index-profile.js';
import { prepareScmFileMetaSnapshot } from '../../../scm/file-meta-snapshot.js';

import {
  buildStage1FileSubprocessOwnershipId,
  clampDurationMs,
  resolveFileHardTimeoutMs,
  resolveFileWatchdogConfig,
  resolveFileWatchdogMs,
  resolveProcessCleanupTimeoutMs,
  resolveStage1HangPolicy,
  runCleanupWithTimeout
} from './process-files/watchdog-policy.js';

export {
  FILE_QUEUE_DELAY_HISTOGRAM_BUCKETS_MS,
  STAGE_TIMING_SCHEMA_VERSION,
  buildFileProgressHeartbeatText,
  buildStage1FileSubprocessOwnershipId,
  clampDurationMs,
  resolveFileHardTimeoutMs,
  resolveFileWatchdogConfig,
  resolveFileWatchdogMs,
  resolveProcessCleanupTimeoutMs,
  resolveStage1FileSubprocessOwnershipPrefix,
  resolveStage1HangPolicy,
  resolveStage1StallAction,
  resolveStage1StallAbortTimeoutMs,
  resolveStage1StallSoftKickTimeoutMs,
  runCleanupWithTimeout,
  toIsoTimestamp
} from './process-files/watchdog-policy.js';

export const resolveStageTimingSizeBin = resolveStageTimingSizeBinShared;
export const createDurationHistogram = createDurationHistogramShared;
export const resolveFileLifecycleDurations = resolveFileLifecycleDurationsShared;
export const shouldTriggerSlowFileWarning = shouldTriggerSlowFileWarningShared;
export const isNearThresholdSlowFileDuration = isNearThresholdSlowFileDurationShared;
export const buildWatchdogNearThresholdSummary = buildWatchdogNearThresholdSummaryShared;

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
  const stageFileWatchdogConfig = resolveFileWatchdogConfig(runtime, { repoFileCount: stageFileCount });
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
  const {
    queueDelaySummary,
    queueDelayTelemetryChannel,
    recordStageTimingSample,
    observeQueueDelay,
    observeWatchdogNearThreshold,
    buildStageTimingBreakdownPayload
  } = createStage1TimingAggregator({
    runtime,
    stageFileWatchdogConfig,
    extractedProseLowYieldBailout
  });
  const lifecycleByOrderIndex = new Map();
  // onResult records relKey -> orderIndex before ordered flush. The ordered
  // result applier consumes this map so write lifecycle timestamps stay bound
  // to the deterministic order slot, including retry/late result paths.
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

  /**
   * Stop and flush tree-sitter scheduler resources when used by this stage.
   *
   * @returns {Promise<void>}
   */
  const closeTreeSitterScheduler = async () => {
    if (!treeSitterScheduler || typeof treeSitterScheduler.close !== 'function') return;
    await treeSitterScheduler.close();
  };
  const postingsQueueTelemetry = createStage1PostingsQueueTelemetry({ runtime });
  let stage1Watchdog = null;
  const cleanupTimeoutMs = resolveProcessCleanupTimeoutMs(runtime);

  try {
    assignFileIndexes(entries);
    const repoFileCount = Array.isArray(entries) ? entries.length : 0;
    const scmSnapshotConfig = runtime?.scmConfig?.snapshot || {};
    const scmSnapshotEnabled = scmSnapshotConfig.enabled !== false;
    let scmFileMetaByPath = null;
    if (scmSnapshotEnabled) {
      const scmFilesPosix = entries.map((entry) => (
        entry?.rel
          ? toPosix(entry.rel)
          : toPosix(path.relative(runtime.root, entry?.abs || ''))
      ));
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
    const postingsQueue = postingsQueueConfig
      ? createPostingsQueue({
        ...postingsQueueConfig,
        onChange: postingsQueueTelemetry.emitSnapshot,
        log
      })
      : null;
    postingsQueueTelemetry.syncQueueState(Boolean(postingsQueue));
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
    const applyFileResult = createStage1FileResultApplier({
      appendChunkWithRetention,
      ensureLifecycleRecord,
      incrementalState,
      lifecycleByOrderIndex,
      lifecycleByRelKey,
      log,
      perfProfile,
      runtime,
      sharedState: state
    });
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
    let activeOrderedCompletionTracker = null;
    const stage1HangPolicy = resolveStage1HangPolicy(runtime, stageFileWatchdogConfig);
    stage1Watchdog = createStage1ProcessingWatchdog({
      mode,
      runtime,
      processStart,
      orderedAppender,
      postingsQueue,
      queueDelaySummary,
      inFlightFiles,
      stage1HangPolicy,
      getProgress: () => progress,
      getOrderedCompletionTracker: () => activeOrderedCompletionTracker,
      abortProcessing,
      logLine: (message, meta = {}) => logLine(message, {
        ...meta,
        mode,
        stage: 'processing'
      })
    });
    const stage1WatchdogPolicy = stage1Watchdog.getPolicy();
    stage1Watchdog.logHangPolicy();
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
      stage1Watchdog?.ensureStallAbortTimer?.();
      stage1Watchdog?.logAdaptiveSlowThreshold?.({
        fileWatchdogConfig,
        repoFileCount,
        log
      });
      /**
       * Execute one bounded entry batch and update queue telemetry around it.
       *
       * @param {object[]} batchEntries
       * @returns {Promise<void>}
       */
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
        /**
         * Publish the active batch tracker so watchdog snapshots can report
         * ordered pending depth against the currently running queue slice.
         */
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
                      bypassWindow: dispatchBypassWindow
                    });
                  }
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
        stage1Watchdog?.onProgressTick?.();
      }
    });
    progress = stage1ProgressTracker.progress;
    markOrderedEntryComplete = stage1ProgressTracker.markOrderedEntryComplete;
    stage1Watchdog?.startTimers?.();
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
      /**
       * Execute one shard worker and normalize worker-level failures.
       *
       * @param {object} workerContext
       * @returns {Promise<object>}
       */
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
      const stallRecovery = stage1Watchdog?.getStallRecoverySummary?.() || {
        softKickAttempts: 0,
        softKickSuccessfulAttempts: 0,
        softKickResetCount: 0,
        softKickThresholdMs: stage1WatchdogPolicy.stallSoftKickMs,
        softKickCooldownMs: stage1WatchdogPolicy.stallSoftKickCooldownMs,
        softKickMaxAttempts: stage1WatchdogPolicy.stallSoftKickMaxAttempts,
        stallAbortMs: stage1WatchdogPolicy.stallAbortMs
      };
      timing.stageTimingBreakdown = stageTimingBreakdownPayload;
      timing.extractedProseLowYieldBailout = extractedProseLowYieldSummary;
      timing.extractedProseYieldProfile = extractedProseYieldProfileSummary;
      timing.shards = shardExecutionMeta;
      timing.watchdog = {
        ...(timing.watchdog && typeof timing.watchdog === 'object' ? timing.watchdog : {}),
        queueDelayMs: stageTimingBreakdownPayload?.watchdog?.queueDelayMs || null,
        nearThreshold: stageTimingBreakdownPayload?.watchdog?.nearThreshold || null,
        stallRecovery
      };
    }
    if (state && typeof state === 'object') {
      state.extractedProseLowYieldBailout = extractedProseLowYieldSummary;
      state.extractedProseYieldProfile = extractedProseYieldProfileSummary;
      state.shardExecution = shardExecutionMeta;
    }
    let parseSkipCount = 0;
    let relationSkipCount = 0;
    const skippedFiles = Array.isArray(state?.skippedFiles) ? state.skippedFiles : [];
    for (const skippedFile of skippedFiles) {
      if (skippedFile?.reason === 'parse-error') {
        parseSkipCount += 1;
      } else if (skippedFile?.reason === 'relation-error') {
        relationSkipCount += 1;
      }
    }
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
    stage1Watchdog?.stopTimers?.();
    if (typeof detachExternalAbort === 'function') {
      detachExternalAbort();
    }
    postingsQueueTelemetry.clear();
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



