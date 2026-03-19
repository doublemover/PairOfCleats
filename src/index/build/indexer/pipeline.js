import fs from 'node:fs/promises';
import { getIndexDir, getMetricsDir } from '../../../shared/dict-utils.js';
import { buildRecordsIndexForRepo } from '../../../integrations/triage/index-records.js';
import { createCacheReporter, createLruCache, estimateFileTextBytes } from '../../../shared/cache.js';
import { getEnvConfig } from '../../../shared/env.js';
import { log, logLine, showProgress } from '../../../shared/progress.js';
import { coerceAbortSignal, throwIfAborted } from '../../../shared/abort.js';
import { createCrashLogger } from '../crash-log.js';
import {
  BUILD_STATE_DURABILITY_CLASS,
  recordOrderingSeedInputs,
  updateBuildStateOutcome
} from '../build-state.js';
import { runBuildCleanupWithTimeout } from '../cleanup-timeout.js';
import { createPerfProfile, loadPerfProfile } from '../perf-profile.js';
import { createStageCheckpointRecorder } from '../stage-checkpoints.js';
import { createIndexState } from '../state.js';
import { enqueueEmbeddingJob } from './embedding-queue.js';
import { resetTreeSitterStats } from '../../../lang/tree-sitter.js';
import { writeSchedulerAutoTuneProfile } from '../runtime/scheduler-autotune-profile.js';
import { formatHealthFailure, runIndexingHealthChecks } from '../../../shared/ops-health.js';
import {
  RESOURCE_GROWTH_THRESHOLDS,
  RESOURCE_WARNING_CODES,
  evaluateResourceGrowth,
  formatResourceGrowthWarning,
  readIndexArtifactBytes
} from '../../../shared/ops-resource-visibility.js';
import {
  buildFeatureSettings,
  resolveAnalysisFlags,
  resolveVectorOnlyShortcutPolicy
} from './pipeline/features.js';
import {
  buildModalitySparsityEntryKey,
  readModalitySparsityProfile,
  resolveModalitySparsityProfilePath,
  shouldElideModalityProcessingStage,
  writeModalitySparsityEntry
} from './pipeline/modality-sparsity.js';
import { resolveTinyRepoFastPath } from './pipeline/tiny-repo-policy.js';
import { resolveHangProbeConfig } from './hang-probe.js';
import {
  createPipelineCheckpointController,
  sanitizeRuntimeSnapshotForCheckpoint
} from './pipeline/checkpoints.js';
import { runPipelineStageOrchestrator } from './pipeline/orchestrator.js';

const INDEX_STAGE_PLAN = Object.freeze([
  Object.freeze({ id: 'discover', label: 'discovery' }),
  Object.freeze({ id: 'imports', label: 'imports' }),
  Object.freeze({ id: 'processing', label: 'processing' }),
  Object.freeze({ id: 'relations', label: 'relations' }),
  Object.freeze({ id: 'postings', label: 'postings' }),
  Object.freeze({ id: 'write', label: 'write' })
]);
const HEAVY_UTILIZATION_STAGES = new Set(['processing', 'relations', 'postings', 'write']);
const PROSE_FILE_TEXT_CACHE_MODES = new Set(['prose', 'extracted-prose']);
const runtimeFileTextCaches = new WeakMap();

/**
 * Resolve a mode-scoped file-text cache, sharing one instance between prose and
 * extracted-prose runs while keeping code isolated.
 *
 * @param {{runtime:object,mode:string,cacheReporter?:object|null}} input
 * @returns {{get:Function,set:Function,delete:Function,clear:Function,size:Function}}
 */
export const resolveFileTextCacheForMode = ({ runtime, mode, cacheReporter = null }) => {
  const group = PROSE_FILE_TEXT_CACHE_MODES.has(mode) ? 'prose' : mode;
  const config = runtime?.cacheConfig?.fileText || {};
  if (!runtime || typeof runtime !== 'object') {
    return createLruCache({
      name: `fileText:${group}`,
      maxMb: config.maxMb,
      ttlMs: config.ttlMs,
      sizeCalculation: estimateFileTextBytes,
      reporter: cacheReporter
    });
  }
  let cacheByGroup = runtimeFileTextCaches.get(runtime);
  if (!cacheByGroup) {
    cacheByGroup = new Map();
    runtimeFileTextCaches.set(runtime, cacheByGroup);
  }
  const existing = cacheByGroup.get(group);
  if (existing) return existing;
  const cache = createLruCache({
    name: `fileText:${group}`,
    maxMb: config.maxMb,
    ttlMs: config.ttlMs,
    sizeCalculation: estimateFileTextBytes,
    reporter: cacheReporter
  });
  cacheByGroup.set(group, cache);
  return cache;
};

/**
 * Build indexes for one mode by running discovery/planning/stage pipeline.
 *
 * @param {{
 *  mode:'code'|'prose'|'records'|'extracted-prose',
 *  runtime:object,
 *  discovery?:{entries:Array,skippedFiles:Array},
 *  abortSignal?:AbortSignal|null
 * }} input
 * @returns {Promise<void>}
 */
export async function buildIndexForMode({ mode, runtime, discovery = null, abortSignal = null }) {
  const effectiveAbortSignal = coerceAbortSignal(abortSignal);
  throwIfAborted(effectiveAbortSignal);
  const envConfig = getEnvConfig();
  const hangProbeConfig = resolveHangProbeConfig(envConfig);
  if (mode === 'records') {
    await buildRecordsIndexForRepo({ runtime, discovery, abortSignal: effectiveAbortSignal });
    if (runtime?.overallProgress?.advance) {
      runtime.overallProgress.advance({ message: 'records' });
    }
    return;
  }
  const crashLogger = await createCrashLogger({
    repoCacheRoot: runtime.repoCacheRoot,
    enabled: runtime.debugCrash === true,
    log
  });
  let crashLoggerClosed = false;
  const closeCrashLogger = async (label) => {
    if (crashLoggerClosed) return;
    crashLoggerClosed = true;
    await runBuildCleanupWithTimeout({
      label: `pipeline.${mode}.crash-logger.close.${label}`,
      cleanup: () => Promise.resolve(crashLogger.close?.()),
      swallowTimeout: true,
      log
    });
  };
  try {
    const outDir = getIndexDir(runtime.root, mode, runtime.userConfig, { indexRoot: runtime.buildRoot });
    const indexSizeBaselineBytes = await readIndexArtifactBytes(outDir);
    await fs.mkdir(outDir, { recursive: true });
    const indexingHealth = runIndexingHealthChecks({ mode, runtime, outDir });
    if (!indexingHealth.ok) {
      const firstFailure = indexingHealth.failures[0] || null;
      const message = formatHealthFailure(firstFailure);
      log(message);
      const error = new Error(message);
      error.code = firstFailure?.code || 'op_health_indexing_failed';
      error.healthReport = indexingHealth;
      throw error;
    }
    log(`[init] ${mode} index dir: ${outDir}`);
    log(`\n📄  Scanning ${mode} ...`);
    const timing = { start: Date.now() };
    const metricsDir = getMetricsDir(runtime.root, runtime.userConfig);
    const analysisFlags = resolveAnalysisFlags(runtime);
    const perfFeatures = {
      stage: runtime.stage || null,
      embeddings: runtime.embeddingEnabled || runtime.embeddingService,
      treeSitter: runtime.languageOptions?.treeSitter?.enabled !== false,
      relations: runtime.stage !== 'stage1',
      tooling: runtime.toolingEnabled,
      typeInference: analysisFlags.typeInference,
      riskAnalysis: analysisFlags.riskAnalysis
    };
    const perfProfile = createPerfProfile({
      configHash: runtime.configHash,
      mode,
      buildId: runtime.buildId,
      features: perfFeatures
    });
    const stageCheckpoints = createStageCheckpointRecorder({
      buildRoot: runtime.buildRoot,
      metricsDir,
      mode,
      buildId: runtime.buildId
    });
    if (runtime.languageOptions?.treeSitter?.enabled !== false) {
      resetTreeSitterStats();
    }
    const featureMetrics = runtime.featureMetrics || null;
    if (featureMetrics?.registerSettings) {
      featureMetrics.registerSettings(mode, buildFeatureSettings(runtime, mode));
    }
    const priorPerfProfile = await loadPerfProfile({
      metricsDir,
      mode,
      configHash: runtime.configHash,
      log
    });
    const shardPerfProfile = priorPerfProfile?.totals?.durationMs
      ? priorPerfProfile
      : null;
    crashLogger.updatePhase(`scan:${mode}`);

    const state = createIndexState({ postingsConfig: runtime.postingsConfig });
    const cacheReporter = createCacheReporter({ enabled: runtime.verboseCache, log });
    const fileTextCache = resolveFileTextCacheForMode({
      runtime,
      mode,
      cacheReporter
    });
    const seenFiles = new Set();

    const stageTotal = INDEX_STAGE_PLAN.length;
    let stageIndex = 0;
    const {
      getSchedulerStats,
      setSchedulerTelemetryStage,
      enableQueueDepthSnapshots,
      queueDepthSnapshotFileThreshold,
      recordStageCheckpoint,
      runStateWriteBestEffort
    } = createPipelineCheckpointController({
      mode,
      runtime,
      stageCheckpoints,
      hangProbeConfig,
      hostCpuCount: Array.isArray(runtime?.cpuList) && runtime.cpuList.length
        ? runtime.cpuList.length
        : null,
      heavyUtilizationStages: Array.from(HEAVY_UTILIZATION_STAGES),
      logFn: log,
      logLineFn: logLine
    });
    const updateBuildStateBestEffort = async (patch) => {
      const outcome = await updateBuildStateOutcome(runtimeRef.buildRoot, patch, {
        durabilityClass: BUILD_STATE_DURABILITY_CLASS.BEST_EFFORT
      });
      if (outcome?.status !== 'timed_out') return outcome?.value ?? null;
      const timeoutMs = Number.isFinite(Number(outcome?.timeoutMs)) ? Math.floor(Number(outcome.timeoutMs)) : null;
      const err = new Error(
        `[build_state] patch wait timed out${timeoutMs != null ? ` after ${timeoutMs}ms` : ''} `
      + `for ${runtimeRef.buildRoot}.`
      );
      err.code = 'ERR_BUILD_STATE_PATCH_TIMEOUT';
      err.buildState = outcome;
      if (timeoutMs != null) err.timeoutMs = timeoutMs;
      if (Number.isFinite(Number(outcome?.elapsedMs))) {
        err.elapsedMs = Math.floor(Number(outcome.elapsedMs));
      }
      throw err;
    };
    /**
   * Advance visible stage progress and retag scheduler telemetry.
   *
   * @param {{id:string,label:string}} stage
   * @returns {void}
   */
    const advanceStage = (stage) => {
      if (runtime?.overallProgress?.advance && stageIndex > 0) {
        const prevStage = INDEX_STAGE_PLAN[stageIndex - 1];
        runtime.overallProgress.advance({ message: `${mode} ${prevStage.label}` });
      }
      stageIndex += 1;
      setSchedulerTelemetryStage(stage.id);
      showProgress('Stage', stageIndex, stageTotal, {
        taskId: `stage:${mode}`,
        stage: stage.id,
        mode,
        message: stage.label,
        scheduler: getSchedulerStats()
      });
    };

    const stageResult = await runPipelineStageOrchestrator({
      mode,
      runtime,
      discovery,
      state,
      timing,
      outDir,
      perfProfile,
      crashLogger,
      cacheReporter,
      seenFiles,
      stagePlan: INDEX_STAGE_PLAN,
      shardPerfProfile,
      fileTextCache,
      hangProbeConfig,
      featureMetrics,
      envConfig,
      stageCheckpoints,
      effectiveAbortSignal,
      advanceStage,
      recordStageCheckpoint,
      runStateWriteBestEffort,
      updateBuildStateBestEffort,
      enableQueueDepthSnapshots,
      queueDepthSnapshotFileThreshold,
      log,
      logLine,
      getSchedulerStats,
      recordOrderingSeedInputs
    });
    const runtimeRef = stageResult?.runtimeRef || runtime;
    if (stageResult?.reused === true) {
      await runBuildCleanupWithTimeout({
        label: `pipeline.${mode}.stage-checkpoints.flush.reused`,
        cleanup: () => stageCheckpoints.flush(),
        swallowTimeout: false,
        log
      });
      cacheReporter.report();
      await closeCrashLogger('reused');
      return;
    }
    const indexSizeCurrentBytes = await readIndexArtifactBytes(outDir);
    const indexGrowth = evaluateResourceGrowth({
      baselineBytes: indexSizeBaselineBytes,
      currentBytes: indexSizeCurrentBytes,
      ratioThreshold: RESOURCE_GROWTH_THRESHOLDS.indexSizeRatio,
      deltaThresholdBytes: RESOURCE_GROWTH_THRESHOLDS.indexSizeDeltaBytes
    });
    if (indexGrowth.abnormal) {
      log(formatResourceGrowthWarning({
        code: RESOURCE_WARNING_CODES.INDEX_SIZE_GROWTH_ABNORMAL,
        component: 'indexing',
        metric: `${mode}.artifact_bytes`,
        growth: indexGrowth,
        nextAction: 'Review indexing inputs or profile artifact bloat before release.'
      }));
    }
    throwIfAborted(effectiveAbortSignal);
    if (runtimeRef?.overallProgress?.advance) {
      const finalStage = INDEX_STAGE_PLAN[INDEX_STAGE_PLAN.length - 1];
      runtimeRef.overallProgress.advance({ message: `${mode} ${finalStage.label}` });
    }
    await writeSchedulerAutoTuneProfile({
      repoCacheRoot: runtimeRef.repoCacheRoot,
      schedulerStats: getSchedulerStats(),
      schedulerConfig: runtimeRef.schedulerConfig,
      buildId: runtimeRef.buildId,
      log
    });
    await enqueueEmbeddingJob({ runtime: runtimeRef, mode, indexDir: outDir, abortSignal: effectiveAbortSignal });
    crashLogger.updatePhase('done');
    cacheReporter.report();
  } finally {
    await closeCrashLogger('finalize');
  }
}

export {
  buildFeatureSettings,
  resolveVectorOnlyShortcutPolicy,
  sanitizeRuntimeSnapshotForCheckpoint,
  resolveModalitySparsityProfilePath,
  buildModalitySparsityEntryKey,
  readModalitySparsityProfile,
  writeModalitySparsityEntry,
  shouldElideModalityProcessingStage,
  resolveTinyRepoFastPath
};

export const indexerPipelineInternals = Object.freeze({
  resolveModalitySparsityProfilePath,
  buildModalitySparsityEntryKey,
  readModalitySparsityProfile,
  writeModalitySparsityEntry,
  shouldElideModalityProcessingStage,
  resolveTinyRepoFastPath,
  sanitizeRuntimeSnapshotForCheckpoint
});
