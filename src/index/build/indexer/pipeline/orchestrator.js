import { estimateContextWindow } from '../../context-window.js';
import { updateBuildState } from '../../build-state.js';
import { runBuildCleanupWithTimeout } from '../../cleanup-timeout.js';
import { getTreeSitterStats } from '../../../../lang/tree-sitter.js';
import { INDEX_PROFILE_VECTOR_ONLY } from '../../../../contracts/index-profile.js';
import { SCHEDULER_QUEUE_NAMES } from '../../runtime/scheduler.js';
import { runWithOperationalFailurePolicy } from '../../../../shared/ops-failure-injection.js';
import {
  SIGNATURE_VERSION,
  buildIncrementalSignature,
  buildIncrementalSignatureSummary,
  buildTokenizationKey
} from '../signatures.js';
import { hasVectorEmbeddingBuildCapability } from './features.js';
import {
  buildModalitySparsityEntryKey,
  readModalitySparsityProfile,
  shouldElideModalityProcessingStage,
  writeModalitySparsityEntry
} from './modality-sparsity.js';
import {
  countFieldArrayEntries,
  countFieldEntries,
  summarizeDocumentExtractionForMode,
  summarizeGraphRelations,
  summarizeImportGraphCacheStats,
  summarizeImportGraphStats,
  summarizeImportStats,
  summarizePostingsQueue,
  summarizeVfsManifestStats
} from './summaries.js';
import { resolvePipelinePolicyContext } from './policy-context.js';
import { runDiscovery } from '../steps/discover.js';
import {
  loadIncrementalPlan,
  prepareIncrementalBundleVfsRows,
  pruneIncrementalState,
  updateIncrementalBundles
} from '../steps/incremental.js';
import { buildIndexPostings } from '../steps/postings.js';
import { processFiles } from '../steps/process-files.js';
import { postScanImports, preScanImports, runCrossFileInference } from '../steps/relations.js';
import { writeIndexArtifactsForMode } from '../steps/write.js';
import { runWithHangProbe } from '../hang-probe.js';

export const runPipelineStageOrchestrator = async ({
  mode,
  runtime,
  discovery = null,
  state,
  timing,
  outDir,
  perfProfile,
  crashLogger,
  cacheReporter,
  seenFiles,
  stagePlan,
  shardPerfProfile = null,
  fileTextCache = null,
  hangProbeConfig = null,
  featureMetrics = null,
  envConfig = {},
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
} = {}) => {
  advanceStage(stagePlan[0]);
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
      stageNumber: 1,
      abortSignal: effectiveAbortSignal
    })
  });
  const allEntries = discoveryResult.value;
  if (typeof enableQueueDepthSnapshots === 'function' && allEntries.length >= queueDepthSnapshotFileThreshold) {
    enableQueueDepthSnapshots();
  }
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

  const {
    runtimeRef,
    tinyRepoFastPath,
    tinyRepoFastPathActive,
    tinyRepoFastPathSummary,
    vectorOnlyShortcuts,
    vectorOnlyShortcutSummary,
    importGraphEnabled,
    crossFileInferenceEnabled
  } = resolvePipelinePolicyContext({ runtime, entries: allEntries });
  state.vectorOnlyShortcuts = vectorOnlyShortcutSummary;
  state.tinyRepoFastPath = tinyRepoFastPathSummary;
  if (vectorOnlyShortcuts.enabled) {
    log(
      '[vector_only] analysis shortcuts: '
      + `disableImportGraph=${vectorOnlyShortcuts.disableImportGraph}, `
      + `disableCrossFileInference=${vectorOnlyShortcuts.disableCrossFileInference}.`
    );
  }
  if (tinyRepoFastPathActive) {
    log(
      `[tiny_repo] fast path active: files=${tinyRepoFastPath.fileCount}, `
      + `bytes=${tinyRepoFastPath.totalBytes}, estimatedLines=${tinyRepoFastPath.estimatedLines}, `
      + `disableImportGraph=${tinyRepoFastPath.disableImportGraph}, `
      + `disableCrossFileInference=${tinyRepoFastPath.disableCrossFileInference}, `
      + `minimalArtifacts=${tinyRepoFastPath.minimalArtifacts}.`
    );
  }
  await updateBuildState(runtimeRef.buildRoot, {
    analysisShortcuts: {
      [mode]: {
        profileId: vectorOnlyShortcuts.profileId,
        disableImportGraph: vectorOnlyShortcuts.disableImportGraph,
        disableCrossFileInference: vectorOnlyShortcuts.disableCrossFileInference,
        tinyRepoFastPath: tinyRepoFastPathSummary
      }
    }
  });
  const vectorOnlyProfile = runtimeRef?.profile?.id === INDEX_PROFILE_VECTOR_ONLY;
  if (vectorOnlyProfile && !hasVectorEmbeddingBuildCapability(runtimeRef)) {
    throw new Error(
      'indexing.profile=vector_only requires embeddings to be available during index build. '
      + 'Enable inline/stub embeddings or service-mode embedding queueing and rebuild.'
    );
  }
  const tokenizationKey = buildTokenizationKey(runtimeRef, mode);
  const cacheSignature = buildIncrementalSignature(runtimeRef, mode, tokenizationKey);
  const cacheSignatureSummary = buildIncrementalSignatureSummary(runtimeRef, mode, tokenizationKey);
  await updateBuildState(runtimeRef.buildRoot, {
    signatures: {
      [mode]: {
        tokenizationKey,
        cacheSignature,
        signatureVersion: SIGNATURE_VERSION
      }
    }
  });
  const {
    profilePath: modalitySparsityProfilePath,
    profile: modalitySparsityProfile
  } = await readModalitySparsityProfile(runtimeRef);
  const modalitySparsityKey = buildModalitySparsityEntryKey({ mode, cacheSignature });
  const cachedModalitySparsity = modalitySparsityProfile?.entries?.[modalitySparsityKey] || null;
  const cachedZeroModality = shouldElideModalityProcessingStage({
    fileCount: cachedModalitySparsity?.fileCount ?? null,
    chunkCount: cachedModalitySparsity?.chunkCount ?? null
  });
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
    return {
      reused: true,
      runtimeRef
    };
  }

  advanceStage(stagePlan[1]);
  let { importResult, scanPlan } = await preScanImports({
    runtime: runtimeRef,
    mode,
    relationsEnabled: importGraphEnabled,
    entries: allEntries,
    crashLogger,
    timing,
    incrementalState,
    fileTextByFile: {
      get: (key) => fileTextCache?.get?.(key),
      set: (key, value) => fileTextCache?.set?.(key, value),
      captureBuffers: true
    },
    abortSignal: effectiveAbortSignal
  });
  recordStageCheckpoint({
    stage: 'stage1',
    step: 'imports',
    extra: {
      imports: summarizeImportStats(importResult)
    }
  });

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
    advanceStage(stagePlan[2]);
    processResult = {
      ...processResult,
      stageElided: true
    };
    log(`[stage1:${mode}] processing stage elided (zero modality: files=0, chunks=0; source=${elisionSource}).`);
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
    advanceStage(stagePlan[2]);
    processResult = await runWithHangProbe({
      ...hangProbeConfig,
      label: 'pipeline.process-files',
      mode,
      stage: 'processing',
      step: 'stage1',
      log: logLine,
      meta: { fileCount: allEntries.length },
      run: () => processFiles({
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
        relationsEnabled: importGraphEnabled,
        shardPerfProfile,
        fileTextCache,
        abortSignal: effectiveAbortSignal
      })
    });
  }
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
  await runStateWriteBestEffort({
    label: 'pipeline.update-build-state.counts',
    meta: {
      fileCount: allEntries.length,
      chunkCount: state.chunks?.length || 0
    },
    run: () => updateBuildStateBestEffort({
      counts: {
        [mode]: {
          files: allEntries.length,
          chunks: state.chunks?.length || 0,
          skipped: state.skippedFiles?.length || 0
        }
      }
    })
  });
  await runStateWriteBestEffort({
    label: 'pipeline.write-modality-sparsity',
    meta: {
      fileCount: allEntries.length,
      chunkCount: state.chunks?.length || 0,
      stageElided: processResult?.stageElided === true
    },
    run: () => writeModalitySparsityEntry({
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
    })
  });
  if (mode === 'extracted-prose') {
    const extractionSummary = summarizeDocumentExtractionForMode(state);
    if (extractionSummary) {
      await runStateWriteBestEffort({
        label: 'pipeline.update-build-state.document-extraction',
        meta: { mode },
        run: () => updateBuildStateBestEffort({
          documentExtraction: {
            [mode]: extractionSummary
          }
        })
      });
    }
  }

  const postImportResult = await runWithHangProbe({
    ...hangProbeConfig,
    label: 'pipeline.post-scan-imports',
    mode,
    stage: 'imports',
    step: 'post-scan',
    log: logLine,
    meta: { fileCount: allEntries.length },
    run: () => postScanImports({
      mode,
      relationsEnabled: importGraphEnabled,
      scanPlan,
      state,
      timing,
      runtime: runtimeRef,
      entries: allEntries,
      importResult,
      incrementalState,
      fileTextByFile: {
        get: (key) => fileTextCache?.get?.(key),
        set: (key, value) => fileTextCache?.set?.(key, value),
        captureBuffers: true
      },
      hangProbeConfig,
      abortSignal: effectiveAbortSignal
    })
  });
  if (postImportResult) importResult = postImportResult;

  const incrementalBundleVfsRowsPromise = mode === 'code'
  && crossFileInferenceEnabled
  && runtimeRef.incrementalEnabled === true
    ? prepareIncrementalBundleVfsRows({
      runtime: runtimeRef,
      incrementalState,
      enabled: true
    })
    : null;

  const overlapConfig = runtimeRef?.indexingConfig?.pipelineOverlap
  && typeof runtimeRef.indexingConfig.pipelineOverlap === 'object'
    ? runtimeRef.indexingConfig.pipelineOverlap
    : {};
  const overlapInferPostings = mode === 'code'
  && overlapConfig.enabled !== false
  && overlapConfig.inferPostings !== false
  && crossFileInferenceEnabled;
  const runPostingsBuild = () => (runtimeRef.scheduler?.schedule
    ? runtimeRef.scheduler.schedule(
      SCHEDULER_QUEUE_NAMES.stage1Postings,
      {
        cpu: 1,
        signal: effectiveAbortSignal
      },
      () => buildIndexPostings({ runtime: runtimeRef, state, incrementalState })
    )
    : buildIndexPostings({ runtime: runtimeRef, state, incrementalState }));
  const postingsPromise = overlapInferPostings ? runPostingsBuild() : null;
  if (postingsPromise) {
    postingsPromise.catch(() => {});
  }

  advanceStage(stagePlan[3]);
  let crossFileEnabled = false;
  let graphRelations = null;
  if (crossFileInferenceEnabled || importGraphEnabled) {
    const relationsResult = await (runtimeRef.scheduler?.schedule
      ? runtimeRef.scheduler.schedule(
        SCHEDULER_QUEUE_NAMES.stage2Relations,
        {
          cpu: 1,
          mem: 1,
          signal: effectiveAbortSignal
        },
        () => runCrossFileInference({
          runtime: runtimeRef,
          mode,
          state,
          crashLogger,
          featureMetrics,
          relationsEnabled: importGraphEnabled,
          crossFileInferenceEnabled,
          abortSignal: effectiveAbortSignal
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
        abortSignal: effectiveAbortSignal
      }));
    crossFileEnabled = relationsResult?.crossFileEnabled === true;
    graphRelations = relationsResult?.graphRelations || null;
  } else if (tinyRepoFastPathActive) {
    log(`[tiny_repo] skipping relations stage for ${mode} (tiny-repo fast path).`);
  }
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
  if (envConfig.verbose === true && tokenizationStats?.chunks) {
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

  advanceStage(stagePlan[4]);
  const postings = postingsPromise
    ? await postingsPromise
    : await runPostingsBuild();
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

  advanceStage(stagePlan[5]);
  await writeIndexArtifactsForMode({
    runtime: runtimeRef,
    mode,
    abortSignal: effectiveAbortSignal,
    outDir,
    state,
    postings,
    timing,
    entries: allEntries,
    perfProfile,
    graphRelations,
    shardSummary,
    stageCheckpoints
  });
  if (runtimeRef.incrementalEnabled === true) {
    const existingVfsManifestRowsByFile = mode === 'code' && crossFileEnabled && incrementalBundleVfsRowsPromise
      ? await incrementalBundleVfsRowsPromise
      : null;
    await updateIncrementalBundles({
      runtime: runtimeRef,
      incrementalState,
      state,
      existingVfsManifestRowsByFile,
      log
    });
  }
  recordStageCheckpoint({
    stage: 'stage2',
    step: 'write',
    extra: {
      chunks: state.chunks?.length || 0,
      tokens: state.totalTokens || 0,
      tokenVocab: postings.tokenVocab?.length || 0,
      vfsManifest: summarizeVfsManifestStats(state)
    }
  });

  await runBuildCleanupWithTimeout({
    label: `pipeline.${mode}.stage-checkpoints.flush.final`,
    cleanup: () => stageCheckpoints.flush(),
    swallowTimeout: false,
    log
  });

  return {
    reused: false,
    runtimeRef
  };
};
