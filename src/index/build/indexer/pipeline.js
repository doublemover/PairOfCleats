import fs from 'node:fs/promises';
import { getIndexDir, getMetricsDir } from '../../../shared/dict-utils.js';
import { buildRecordsIndexForRepo } from '../../../integrations/triage/index-records.js';
import { createCacheReporter, createLruCache, estimateFileTextBytes } from '../../../shared/cache.js';
import { getEnvConfig } from '../../../shared/env.js';
import { log } from '../../../shared/progress.js';
import { throwIfAborted } from '../../../shared/abort.js';
import { createCrashLogger } from '../crash-log.js';
import { recordOrderingSeedInputs, updateBuildState } from '../build-state.js';
import { estimateContextWindow } from '../context-window.js';
import { createPerfProfile, loadPerfProfile } from '../perf-profile.js';
import { createStageCheckpointRecorder } from '../stage-checkpoints.js';
import { createIndexState } from '../state.js';
import { enqueueEmbeddingJob } from './embedding-queue.js';
import { getTreeSitterStats, resetTreeSitterStats } from '../../../lang/tree-sitter.js';
import { SCHEDULER_QUEUE_NAMES } from '../runtime/scheduler.js';
import { writeSchedulerAutoTuneProfile } from '../runtime/scheduler-autotune-profile.js';
import { formatHealthFailure, runIndexingHealthChecks } from '../../../shared/ops-health.js';
import { runWithOperationalFailurePolicy } from '../../../shared/ops-failure-injection.js';
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
import {
  countFieldArrayEntries,
  countFieldEntries,
  summarizeImportGraphCacheStats,
  summarizeImportGraphStats,
  summarizeImportStats,
  summarizeTinyRepoFastPath,
  summarizeVfsManifestStats,
  summarizeDocumentExtractionForMode,
  summarizeGraphRelations,
  summarizePostingsQueue
} from './pipeline/summaries.js';
import { createStageOrchestration } from './pipeline/stage-orchestration.js';
import { initializePipelinePolicyBootstrap } from './pipeline/policy-context.js';
import {
  createIncrementalBundleVfsRowsPromise,
  resolvePostingsBuildResult,
  resolvePostingsOverlapPolicy,
  runWriteStageWithIncrementalBundles,
  startOverlappedPostingsBuild
} from './pipeline/phase-ordering.js';
import { runDiscovery } from './steps/discover.js';
import {
  loadIncrementalPlan,
  prepareIncrementalBundleVfsRows,
  pruneIncrementalState,
  updateIncrementalBundles
} from './steps/incremental.js';
import { buildIndexPostings } from './steps/postings.js';
import { processFiles } from './steps/process-files.js';
import { postScanImports, preScanImports, runCrossFileInference } from './steps/relations.js';
import { writeIndexArtifactsForMode } from './steps/write.js';

const INDEX_STAGE_PLAN = Object.freeze([
  Object.freeze({ id: 'discover', label: 'discovery' }),
  Object.freeze({ id: 'imports', label: 'imports' }),
  Object.freeze({ id: 'processing', label: 'processing' }),
  Object.freeze({ id: 'relations', label: 'relations' }),
  Object.freeze({ id: 'postings', label: 'postings' }),
  Object.freeze({ id: 'write', label: 'write' })
]);

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
  throwIfAborted(abortSignal);
  if (mode === 'records') {
    await buildRecordsIndexForRepo({ runtime, discovery, abortSignal });
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
  const fileTextByFile = {
    get: (key) => fileTextCache.get(key),
    set: (key, value) => fileTextCache.set(key, value),
    captureBuffers: true
  };
  const seenFiles = new Set();

  const {
    advanceStage,
    getSchedulerStats,
    getStageNumber,
    maybeEnableQueueDepthSnapshotsForFileCount,
    recordStageCheckpoint
  } = createStageOrchestration({
    runtime,
    mode,
    stagePlan: INDEX_STAGE_PLAN,
    stageCheckpoints,
    log
  });

  advanceStage(INDEX_STAGE_PLAN[0]);
  const discoveryResult = await runWithOperationalFailurePolicy({
    target: 'indexing.hotpath',
    operation: 'discovery',
    log,
    execute: async () => runDiscovery({
      runtime,
      mode,
      discovery,
      state,
      timing,
      stageNumber: getStageNumber(),
      abortSignal
    })
  });
  const allEntries = discoveryResult.value;
  maybeEnableQueueDepthSnapshotsForFileCount(allEntries.length);
  recordStageCheckpoint({
    stage: 'stage1',
    step: 'discovery',
    extra: {
      files: allEntries.length,
      skipped: state.skippedFiles?.length || 0
    }
  });
  await recordOrderingSeedInputs(runtime.buildRoot, {
    discoveryHash: state.discoveryHash,
    fileListHash: state.fileListHash,
    fileCount: allEntries.length
  }, { stage: 'stage1', mode });
  throwIfAborted(abortSignal);
  const {
    runtimeRef,
    tinyRepoFastPathActive,
    tinyRepoFastPathSummary,
    vectorOnlyShortcutSummary,
    relationsEnabled,
    importGraphEnabled,
    crossFileInferenceEnabled,
    tokenizationKey,
    cacheSignature,
    cacheSignatureSummary,
    modalitySparsityProfilePath,
    modalitySparsityProfile,
    cachedZeroModality
  } = await initializePipelinePolicyBootstrap({
    runtime,
    mode,
    entries: allEntries,
    log
  });
  state.vectorOnlyShortcuts = vectorOnlyShortcutSummary;
  state.tinyRepoFastPath = tinyRepoFastPathSummary;
  const { incrementalState, reused } = await loadIncrementalPlan({
    runtime: runtimeRef,
    mode,
    outDir,
    entries: allEntries,
    tokenizationKey,
    cacheSignature,
    cacheSignatureSummary,
    cacheReporter
  });
  if (reused) {
    recordStageCheckpoint({
      stage: 'stage1',
      step: 'incremental',
      label: 'reused',
      extra: { files: allEntries.length }
    });
    await stageCheckpoints.flush();
    cacheReporter.report();
    return;
  }

  advanceStage(INDEX_STAGE_PLAN[1]);
  let { importResult, scanPlan } = await preScanImports({
    runtime: runtimeRef,
    mode,
    relationsEnabled: importGraphEnabled,
    entries: allEntries,
    crashLogger,
    timing,
    incrementalState,
    fileTextByFile,
    abortSignal
  });
  recordStageCheckpoint({
    stage: 'stage1',
    step: 'imports',
    extra: {
      imports: summarizeImportStats(importResult)
    }
  });
  throwIfAborted(abortSignal);

  const shouldElideProcessingStage = shouldElideModalityProcessingStage({
    fileCount: allEntries.length,
    chunkCount: state?.chunks?.length || 0
  });

  let processResult = {
    tokenizationStats: null,
    shardSummary: null,
    postingsQueueStats: null,
    stageElided: false
  };
  if (shouldElideProcessingStage) {
    const elisionSource = cachedZeroModality ? 'sparsity-cache-hit' : 'discovery';
    advanceStage(INDEX_STAGE_PLAN[2]);
    processResult = {
      ...processResult,
      stageElided: true
    };
    log(
      `[stage1:${mode}] processing stage elided (zero modality: files=0, chunks=0; source=${elisionSource}).`
    );
    state.modalityStageElisions = {
      ...(state.modalityStageElisions || {}),
      [mode]: {
        source: elisionSource,
        cacheSignature,
        fileCount: 0,
        chunkCount: 0
      }
    };
  } else {
    const contextWin = await estimateContextWindow({
      files: allEntries.map((entry) => entry.abs),
      root: runtimeRef.root,
      mode,
      languageOptions: runtimeRef.languageOptions
    });
    log(`Auto-selected context window: ${contextWin} lines`);

    advanceStage(INDEX_STAGE_PLAN[2]);
    processResult = await processFiles({
      mode,
      runtime: runtimeRef,
      discovery,
      outDir,
      entries: allEntries,
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
      extractedProseYieldProfile: extractedProseYieldProfileSelection?.entry || null,
      documentExtractionCache: documentExtractionCacheRuntime,
      abortSignal
    });
  }
  throwIfAborted(abortSignal);
  const { tokenizationStats, shardSummary, postingsQueueStats } = processResult;
  recordStageCheckpoint({
    stage: 'stage1',
    step: 'processing',
    extra: {
      files: allEntries.length,
      chunks: state.chunks?.length || 0,
      tokens: state.totalTokens || 0,
      tokenPostings: state.tokenPostings?.size || 0,
      phrasePostings: state.phrasePost?.size || 0,
      chargramPostings: state.triPost?.size || 0,
      fieldPostings: countFieldEntries(state.fieldPostings),
      fieldDocLengths: countFieldArrayEntries(state.fieldDocLengths),
      treeSitter: getTreeSitterStats(),
      postingsQueue: summarizePostingsQueue(postingsQueueStats),
      stageElided: processResult?.stageElided === true,
      sparsityCacheHit: processResult?.stageElided === true && cachedZeroModality === true
    }
  });
  await updateBuildState(runtimeRef.buildRoot, {
    counts: {
      [mode]: {
        files: allEntries.length,
        chunks: state.chunks?.length || 0,
        skipped: state.skippedFiles?.length || 0
      }
    }
  });
  await writeModalitySparsityEntry({
    runtime: runtimeRef,
    profilePath: modalitySparsityProfilePath,
    profile: modalitySparsityProfile,
    mode,
    cacheSignature,
    fileCount: allEntries.length,
    chunkCount: state.chunks?.length || 0,
    elided: processResult?.stageElided === true,
    source: processResult?.stageElided === true
      ? (cachedZeroModality ? 'sparsity-cache-hit' : 'discovery')
      : 'observed'
  });
  if (mode === 'extracted-prose') {
    await writeExtractedProseYieldProfileEntry({
      runtime: runtimeRef,
      profilePath: extractedProseYieldProfilePath,
      profile: extractedProseYieldProfile,
      mode,
      cacheSignature,
      observation: extractedProseYieldProfileObservation
    });
    await writeDocumentExtractionCacheRuntime(documentExtractionCacheRuntime);
    const extractionSummary = summarizeDocumentExtractionForMode(state);
    if (extractionSummary) {
      await updateBuildState(runtimeRef.buildRoot, {
        documentExtraction: {
          [mode]: extractionSummary
        }
      });
    }
  }

  const postImportResult = await postScanImports({
    mode,
    relationsEnabled: importGraphEnabled,
    scanPlan,
    state,
    timing,
    runtime: runtimeRef,
    entries: allEntries,
    importResult,
    incrementalState,
    fileTextByFile
  });
  if (postImportResult) importResult = postImportResult;

  const incrementalBundleVfsRowsPromise = createIncrementalBundleVfsRowsPromise({
    mode,
    crossFileInferenceEnabled,
    runtime: runtimeRef,
    incrementalState,
    prepareIncrementalBundleVfsRows
  });

  const overlapInferPostings = resolvePostingsOverlapPolicy({
    mode,
    runtime: runtimeRef,
    crossFileInferenceEnabled
  });
  const runPostingsBuild = () => (runtimeRef.scheduler?.schedule
    ? runtimeRef.scheduler.schedule(
      SCHEDULER_QUEUE_NAMES.stage1Postings,
      { cpu: 1 },
      () => buildIndexPostings({ runtime: runtimeRef, state, incrementalState })
    )
    : buildIndexPostings({ runtime: runtimeRef, state, incrementalState }));
  const postingsPromise = startOverlappedPostingsBuild({
    overlapInferPostings,
    runPostingsBuild
  });

  advanceStage(INDEX_STAGE_PLAN[3]);
  let crossFileEnabled = false;
  let graphRelations = null;
  if (crossFileInferenceEnabled || importGraphEnabled) {
    const relationsResult = await (runtimeRef.scheduler?.schedule
      ? runtimeRef.scheduler.schedule(
        SCHEDULER_QUEUE_NAMES.stage2Relations,
        { cpu: 1, mem: 1 },
        () => runCrossFileInference({
          runtime: runtimeRef,
          mode,
          state,
          crashLogger,
          featureMetrics,
          relationsEnabled: importGraphEnabled,
          crossFileInferenceEnabled,
          abortSignal
        })
      )
      : runCrossFileInference({
        runtime: runtimeRef,
        mode,
        state,
        crashLogger,
        featureMetrics,
        relationsEnabled: importGraphEnabled,
        crossFileInferenceEnabled,
        abortSignal
      }));
    crossFileEnabled = relationsResult?.crossFileEnabled === true;
    graphRelations = relationsResult?.graphRelations || null;
  } else if (tinyRepoFastPathActive) {
    log(`[tiny_repo] skipping relations stage for ${mode} (tiny-repo fast path).`);
  }
  throwIfAborted(abortSignal);
  recordStageCheckpoint({
    stage: 'stage2',
    step: 'relations',
    extra: {
      fileRelations: state.fileRelations?.size || 0,
      importGraphCache: summarizeImportGraphCacheStats(postImportResult),
      importGraph: summarizeImportGraphStats(state),
      graphs: summarizeGraphRelations(graphRelations),
      shortcuts: {
        importGraphEnabled,
        crossFileInferenceEnabled,
        tinyRepoFastPathActive
      }
    }
  });
  const envConfig = getEnvConfig();
  if (envConfig.verbose === true && tokenizationStats.chunks) {
    const avgTokens = (tokenizationStats.tokens / tokenizationStats.chunks).toFixed(1);
    const avgChargrams = (tokenizationStats.chargrams / tokenizationStats.chunks).toFixed(1);
    log(`[tokenization] ${mode}: chunks=${tokenizationStats.chunks}, tokens=${tokenizationStats.tokens}, avgTokens=${avgTokens}, avgChargrams=${avgChargrams}`);
  }

  await pruneIncrementalState({
    runtime: runtimeRef,
    incrementalState,
    seenFiles
  });

  log(`   → Indexed ${state.chunks.length} chunks, total tokens: ${state.totalTokens.toLocaleString()}`);

  advanceStage(INDEX_STAGE_PLAN[4]);
  throwIfAborted(abortSignal);
  const postings = await resolvePostingsBuildResult({
    postingsPromise,
    runPostingsBuild
  });
  recordStageCheckpoint({
    stage: 'stage1',
    step: 'postings',
    extra: {
      tokenVocab: postings.tokenVocab?.length || 0,
      phraseVocab: postings.phraseVocab?.length || 0,
      chargramVocab: postings.chargramVocab?.length || 0,
      chargramStats: postings.chargramStats || null,
      postingsMerge: postings.postingsMergeStats || null,
      denseVectors: postings.quantizedVectors?.length || 0,
      docVectors: postings.quantizedDocVectors?.length || 0,
      codeVectors: postings.quantizedCodeVectors?.length || 0,
      overlapInferPostings
    }
  });

  advanceStage(INDEX_STAGE_PLAN[5]);
  throwIfAborted(abortSignal);
  await runWriteStageWithIncrementalBundles({
    writeArtifacts: () => writeIndexArtifactsForMode({
      runtime: runtimeRef,
      mode,
      outDir,
      state,
      postings,
      timing,
      entries: allEntries,
      perfProfile,
      graphRelations,
      shardSummary,
      stageCheckpoints
    }),
    runtime: runtimeRef,
    mode,
    crossFileEnabled,
    incrementalBundleVfsRowsPromise,
    updateIncrementalBundles,
    incrementalState,
    state,
    log
  });
  const vfsExtra = summarizeVfsManifestStats(state);
  recordStageCheckpoint({
    stage: 'stage2',
    step: 'write',
    extra: {
      chunks: state.chunks?.length || 0,
      tokens: state.totalTokens || 0,
      tokenVocab: postings.tokenVocab?.length || 0,
      vfsManifest: vfsExtra
    }
  });
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
  throwIfAborted(abortSignal);
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
  await enqueueEmbeddingJob({ runtime: runtimeRef, mode, indexDir: outDir, abortSignal });
  crashLogger.updatePhase('done');
  cacheReporter.report();
  await stageCheckpoints.flush();
}

export {
  buildFeatureSettings,
  resolveVectorOnlyShortcutPolicy,
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
