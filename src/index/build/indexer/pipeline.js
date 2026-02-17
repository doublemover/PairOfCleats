import fs from 'node:fs/promises';
import { applyAdaptiveDictConfig, getIndexDir, getMetricsDir } from '../../../shared/dict-utils.js';
import { buildRecordsIndexForRepo } from '../../../integrations/triage/index-records.js';
import { createCacheReporter, createLruCache, estimateFileTextBytes } from '../../../shared/cache.js';
import { getEnvConfig } from '../../../shared/env.js';
import { log, showProgress } from '../../../shared/progress.js';
import { throwIfAborted } from '../../../shared/abort.js';
import { createCrashLogger } from '../crash-log.js';
import { recordOrderingSeedInputs, updateBuildState } from '../build-state.js';
import { estimateContextWindow } from '../context-window.js';
import { createPerfProfile, loadPerfProfile } from '../perf-profile.js';
import { createStageCheckpointRecorder } from '../stage-checkpoints.js';
import { createIndexState } from '../state.js';
import { enqueueEmbeddingJob } from './embedding-queue.js';
import { getTreeSitterStats, resetTreeSitterStats } from '../../../lang/tree-sitter.js';
import { INDEX_PROFILE_VECTOR_ONLY } from '../../../contracts/index-profile.js';
import { SCHEDULER_QUEUE_NAMES } from '../runtime/scheduler.js';
import {
  SIGNATURE_VERSION,
  buildIncrementalSignature,
  buildIncrementalSignatureSummary,
  buildTokenizationKey
} from './signatures.js';
import { runDiscovery } from './steps/discover.js';
import { loadIncrementalPlan, pruneIncrementalState, updateIncrementalBundles } from './steps/incremental.js';
import { buildIndexPostings } from './steps/postings.js';
import { processFiles } from './steps/process-files.js';
import { postScanImports, preScanImports, runCrossFileInference } from './steps/relations.js';
import { writeIndexArtifactsForMode } from './steps/write.js';

const resolveAnalysisFlags = (runtime) => {
  const policy = runtime.analysisPolicy || {};
  return {
    gitBlame: typeof policy?.git?.blame === 'boolean' ? policy.git.blame : runtime.gitBlameEnabled,
    typeInference: typeof policy?.typeInference?.local?.enabled === 'boolean'
      ? policy.typeInference.local.enabled
      : runtime.typeInferenceEnabled,
    typeInferenceCrossFile: typeof policy?.typeInference?.crossFile?.enabled === 'boolean'
      ? policy.typeInference.crossFile.enabled
      : runtime.typeInferenceCrossFileEnabled,
    riskAnalysis: typeof policy?.risk?.enabled === 'boolean' ? policy.risk.enabled : runtime.riskAnalysisEnabled,
    riskAnalysisCrossFile: typeof policy?.risk?.crossFile === 'boolean'
      ? policy.risk.crossFile
      : runtime.riskAnalysisCrossFileEnabled
  };
};

/**
 * Vector-only builds can proceed when embeddings are either immediately
 * available (`embeddingEnabled`) or deferred to service queueing
 * (`embeddingService`).
 *
 * @param {object} runtime
 * @returns {boolean}
 */
const hasVectorEmbeddingBuildCapability = (runtime) => (
  runtime?.embeddingEnabled === true || runtime?.embeddingService === true
);

export const resolveVectorOnlyShortcutPolicy = (runtime) => {
  const profileId = runtime?.profile?.id || runtime?.indexingConfig?.profile || 'default';
  const vectorOnly = profileId === INDEX_PROFILE_VECTOR_ONLY;
  const config = runtime?.indexingConfig?.vectorOnly && typeof runtime.indexingConfig.vectorOnly === 'object'
    ? runtime.indexingConfig.vectorOnly
    : {};
  return {
    profileId,
    enabled: vectorOnly,
    disableImportGraph: vectorOnly ? config.disableImportGraph !== false : false,
    disableCrossFileInference: vectorOnly ? config.disableCrossFileInference !== false : false
  };
};

export const buildFeatureSettings = (runtime, mode) => {
  const analysisFlags = resolveAnalysisFlags(runtime);
  const profileId = runtime?.profile?.id || runtime?.indexingConfig?.profile || 'default';
  const vectorOnly = profileId === INDEX_PROFILE_VECTOR_ONLY;
  const vectorOnlyShortcuts = resolveVectorOnlyShortcutPolicy(runtime);
  return {
    profileId,
    // Query-AST filtering depends on per-chunk tokens even for vector_only retrieval.
    // Keep tokenization enabled while still disabling sparse postings artifacts.
    tokenize: true,
    postings: !vectorOnly,
    embeddings: runtime.embeddingEnabled || runtime.embeddingService,
    gitBlame: analysisFlags.gitBlame,
    pythonAst: runtime.languageOptions?.pythonAst?.enabled !== false && mode === 'code',
    treeSitter: runtime.languageOptions?.treeSitter?.enabled !== false,
    typeInference: analysisFlags.typeInference && mode === 'code',
    riskAnalysis: analysisFlags.riskAnalysis && mode === 'code',
    lint: runtime.lintEnabled && mode === 'code',
    complexity: runtime.complexityEnabled && mode === 'code',
    astDataflow: runtime.astDataflowEnabled && mode === 'code',
    controlFlow: runtime.controlFlowEnabled && mode === 'code',
    typeInferenceCrossFile: analysisFlags.typeInferenceCrossFile && mode === 'code',
    riskAnalysisCrossFile: analysisFlags.riskAnalysisCrossFile && mode === 'code',
    vectorOnlyShortcuts: vectorOnlyShortcuts.enabled
      ? {
        disableImportGraph: vectorOnlyShortcuts.disableImportGraph,
        disableCrossFileInference: vectorOnlyShortcuts.disableCrossFileInference
      }
      : null
  };
};

const countFieldEntries = (fieldMaps) => {
  if (!fieldMaps || typeof fieldMaps !== 'object') return 0;
  let total = 0;
  for (const entry of Object.values(fieldMaps)) {
    if (entry && typeof entry.size === 'number') total += entry.size;
  }
  return total;
};

const countFieldArrayEntries = (fieldArrays) => {
  if (!fieldArrays || typeof fieldArrays !== 'object') return 0;
  let total = 0;
  for (const entry of Object.values(fieldArrays)) {
    if (Array.isArray(entry)) total += entry.length;
  }
  return total;
};

const summarizeGraphRelations = (graphRelations) => {
  if (!graphRelations || typeof graphRelations !== 'object') return null;
  const summarize = (graph) => ({
    nodes: Number.isFinite(graph?.nodeCount) ? graph.nodeCount : 0,
    edges: Number.isFinite(graph?.edgeCount) ? graph.edgeCount : 0
  });
  return {
    callGraph: summarize(graphRelations.callGraph),
    usageGraph: summarize(graphRelations.usageGraph),
    importGraph: summarize(graphRelations.importGraph)
  };
};

const summarizeDocumentExtractionForMode = (state) => {
  const fileInfoByPath = state?.fileInfoByPath;
  if (!(fileInfoByPath && typeof fileInfoByPath.entries === 'function')) return null;
  const files = [];
  const extractorMap = new Map();
  const totals = {
    files: 0,
    pages: 0,
    paragraphs: 0,
    units: 0
  };
  for (const [file, info] of fileInfoByPath.entries()) {
    const extraction = info?.extraction;
    if (!extraction || extraction.status !== 'ok') continue;
    const extractorName = extraction?.extractor?.name || null;
    const extractorVersion = extraction?.extractor?.version || null;
    const extractorTarget = extraction?.extractor?.target || null;
    const extractorKey = `${extractorName || 'unknown'}|${extractorVersion || 'unknown'}|${extractorTarget || ''}`;
    if (!extractorMap.has(extractorKey)) {
      extractorMap.set(extractorKey, {
        name: extractorName,
        version: extractorVersion,
        target: extractorTarget
      });
    }
    const unitCounts = {
      pages: Number(extraction?.counts?.pages) || 0,
      paragraphs: Number(extraction?.counts?.paragraphs) || 0,
      totalUnits: Number(extraction?.counts?.totalUnits) || 0
    };
    totals.files += 1;
    totals.pages += unitCounts.pages;
    totals.paragraphs += unitCounts.paragraphs;
    totals.units += unitCounts.totalUnits;
    files.push({
      file,
      sourceType: extraction.sourceType || null,
      extractor: {
        name: extractorName,
        version: extractorVersion,
        target: extractorTarget
      },
      sourceBytesHash: extraction.sourceBytesHash || null,
      sourceBytesHashAlgo: extraction.sourceBytesHashAlgo || 'sha256',
      unitCounts,
      normalizationPolicy: extraction.normalizationPolicy || null
    });
  }
  files.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
  if (!files.length) return null;
  const extractors = Array.from(extractorMap.values()).sort((a, b) => {
    const left = `${a.name || ''}|${a.version || ''}|${a.target || ''}`;
    const right = `${b.name || ''}|${b.version || ''}|${b.target || ''}`;
    if (left < right) return -1;
    if (left > right) return 1;
    return 0;
  });
  return {
    schemaVersion: 1,
    files,
    extractors,
    totals
  };
};

/**
 * Build indexes for a given mode.
 * @param {{mode:'code'|'prose'|'records'|'extracted-prose',runtime:object,discovery?:{entries:Array,skippedFiles:Array}}} input
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
  await fs.mkdir(outDir, { recursive: true });
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
  const fileTextCache = createLruCache({
    name: 'fileText',
    maxMb: runtime.cacheConfig?.fileText?.maxMb,
    ttlMs: runtime.cacheConfig?.fileText?.ttlMs,
    sizeCalculation: estimateFileTextBytes,
    reporter: cacheReporter
  });
  const fileTextByFile = {
    get: (key) => fileTextCache.get(key),
    set: (key, value) => fileTextCache.set(key, value),
    captureBuffers: true
  };
  const seenFiles = new Set();

  const stagePlan = [
    { id: 'discover', label: 'discovery' },
    { id: 'imports', label: 'imports' },
    { id: 'processing', label: 'processing' },
    { id: 'relations', label: 'relations' },
    { id: 'postings', label: 'postings' },
    { id: 'write', label: 'write' }
  ];
  const stageTotal = stagePlan.length;
  let stageIndex = 0;
  const getSchedulerStats = () => (runtime?.scheduler?.stats ? runtime.scheduler.stats() : null);
  const advanceStage = (stage) => {
    if (runtime?.overallProgress?.advance && stageIndex > 0) {
      const prevStage = stagePlan[stageIndex - 1];
      runtime.overallProgress.advance({ message: `${mode} ${prevStage.label}` });
    }
    stageIndex += 1;
    showProgress('Stage', stageIndex, stageTotal, {
      taskId: `stage:${mode}`,
      stage: stage.id,
      mode,
      message: stage.label,
      scheduler: getSchedulerStats()
    });
  };

  advanceStage(stagePlan[0]);
  const allEntries = await runDiscovery({
    runtime,
    mode,
    discovery,
    state,
    timing,
    stageNumber: stageIndex,
    abortSignal
  });
  stageCheckpoints.record({
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
  const dictConfig = applyAdaptiveDictConfig(runtime.dictConfig, allEntries.length);
  const runtimeRef = dictConfig === runtime.dictConfig
    ? runtime
    : { ...runtime, dictConfig };
  const vectorOnlyShortcuts = resolveVectorOnlyShortcutPolicy(runtimeRef);
  state.vectorOnlyShortcuts = vectorOnlyShortcuts.enabled
    ? {
      disableImportGraph: vectorOnlyShortcuts.disableImportGraph,
      disableCrossFileInference: vectorOnlyShortcuts.disableCrossFileInference
    }
    : null;
  if (vectorOnlyShortcuts.enabled) {
    log(
      '[vector_only] analysis shortcuts: '
      + `disableImportGraph=${vectorOnlyShortcuts.disableImportGraph}, `
      + `disableCrossFileInference=${vectorOnlyShortcuts.disableCrossFileInference}.`
    );
  }
  await updateBuildState(runtimeRef.buildRoot, {
    analysisShortcuts: {
      [mode]: {
        profileId: vectorOnlyShortcuts.profileId,
        disableImportGraph: vectorOnlyShortcuts.disableImportGraph,
        disableCrossFileInference: vectorOnlyShortcuts.disableCrossFileInference
      }
    }
  });
  const vectorOnlyProfile = runtimeRef?.profile?.id === INDEX_PROFILE_VECTOR_ONLY;
  if (vectorOnlyProfile && !hasVectorEmbeddingBuildCapability(runtimeRef)) {
    throw new Error(
      'indexing.profile=vector_only requires embeddings to be available during index build. ' +
      'Enable inline/stub embeddings or service-mode embedding queueing and rebuild.'
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
    stageCheckpoints.record({
      stage: 'stage1',
      step: 'incremental',
      label: 'reused',
      extra: { files: allEntries.length }
    });
    await stageCheckpoints.flush();
    cacheReporter.report();
    return;
  }

  const relationsEnabled = runtimeRef.stage !== 'stage1';
  const importGraphEnabled = relationsEnabled && !vectorOnlyShortcuts.disableImportGraph;
  const crossFileInferenceEnabled = relationsEnabled && !vectorOnlyShortcuts.disableCrossFileInference;
  advanceStage(stagePlan[1]);
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
  stageCheckpoints.record({
    stage: 'stage1',
    step: 'imports',
    extra: {
      imports: importResult?.stats
        ? {
          modules: Number(importResult.stats.modules) || 0,
          edges: Number(importResult.stats.edges) || 0,
          files: Number(importResult.stats.files) || 0
        }
        : { modules: 0, edges: 0, files: 0 }
    }
  });
  throwIfAborted(abortSignal);

  const contextWin = await estimateContextWindow({
    files: allEntries.map((entry) => entry.abs),
    root: runtimeRef.root,
    mode,
    languageOptions: runtimeRef.languageOptions
  });
  log(`Auto-selected context window: ${contextWin} lines`);

  advanceStage(stagePlan[2]);
  const processResult = await processFiles({
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
    abortSignal
  });
  throwIfAborted(abortSignal);
  const { tokenizationStats, shardSummary, postingsQueueStats } = processResult;
  const summarizePostingsQueue = (stats) => {
    if (!stats || typeof stats !== 'object') return null;
    return {
      limits: stats.limits || null,
      highWater: stats.highWater || null,
      backpressure: stats.backpressure || null,
      oversize: stats.oversize || null,
      memory: stats.memory || null
    };
  };
  stageCheckpoints.record({
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
      postingsQueue: summarizePostingsQueue(postingsQueueStats)
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
  if (mode === 'extracted-prose') {
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

  advanceStage(stagePlan[3]);
  const { crossFileEnabled, graphRelations } = await (runtimeRef.scheduler?.schedule
    ? runtimeRef.scheduler.schedule(
      SCHEDULER_QUEUE_NAMES.stage2Relations,
      { cpu: 1, mem: 1 },
      () => runCrossFileInference({
        runtime: runtimeRef,
        mode,
        state,
        crashLogger,
        featureMetrics,
        relationsEnabled: crossFileInferenceEnabled,
        abortSignal
      })
    )
    : runCrossFileInference({
      runtime: runtimeRef,
      mode,
      state,
      crashLogger,
      featureMetrics,
      relationsEnabled: crossFileInferenceEnabled,
      abortSignal
    }));
  throwIfAborted(abortSignal);
  stageCheckpoints.record({
    stage: 'stage2',
    step: 'relations',
    extra: {
      fileRelations: state.fileRelations?.size || 0,
      importGraphCache: postImportResult?.cacheStats
        ? {
          files: Number(postImportResult.cacheStats.files) || 0,
          filesHashed: Number(postImportResult.cacheStats.filesHashed) || 0,
          filesReused: Number(postImportResult.cacheStats.filesReused) || 0,
          filesInvalidated: Number(postImportResult.cacheStats.filesInvalidated) || 0,
          specs: Number(postImportResult.cacheStats.specs) || 0,
          specsReused: Number(postImportResult.cacheStats.specsReused) || 0,
          specsComputed: Number(postImportResult.cacheStats.specsComputed) || 0,
          packageInvalidated: postImportResult.cacheStats.packageInvalidated === true,
          reuseRatio: postImportResult.cacheStats.files
            ? Number(postImportResult.cacheStats.filesReused || 0) / Number(postImportResult.cacheStats.files || 1)
            : 0
        }
        : null,
      importGraph: state.importResolutionGraph?.stats
        ? {
          files: Number(state.importResolutionGraph.stats.files) || 0,
          nodes: Number(state.importResolutionGraph.stats.nodes) || 0,
          edges: Number(state.importResolutionGraph.stats.edges) || 0,
          resolved: Number(state.importResolutionGraph.stats.resolved) || 0,
          external: Number(state.importResolutionGraph.stats.external) || 0,
          unresolved: Number(state.importResolutionGraph.stats.unresolved) || 0,
          truncatedEdges: Number(state.importResolutionGraph.stats.truncatedEdges) || 0,
          truncatedNodes: Number(state.importResolutionGraph.stats.truncatedNodes) || 0,
          warningSuppressed: Number(state.importResolutionGraph.stats.warningSuppressed) || 0
        }
        : null,
      graphs: summarizeGraphRelations(graphRelations),
      shortcuts: {
        importGraphEnabled,
        crossFileInferenceEnabled
      }
    }
  });
  if (mode === 'code' && crossFileEnabled) {
    await updateIncrementalBundles({
      runtime: runtimeRef,
      incrementalState,
      state,
      log
    });
  }

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

  advanceStage(stagePlan[4]);
  throwIfAborted(abortSignal);
  const postings = await (runtimeRef.scheduler?.schedule
    ? runtimeRef.scheduler.schedule(
      SCHEDULER_QUEUE_NAMES.stage1Postings,
      { cpu: 1 },
      () => buildIndexPostings({ runtime: runtimeRef, state })
    )
    : buildIndexPostings({ runtime: runtimeRef, state }));
  stageCheckpoints.record({
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
      codeVectors: postings.quantizedCodeVectors?.length || 0
    }
  });

  advanceStage(stagePlan[5]);
  throwIfAborted(abortSignal);
  await writeIndexArtifactsForMode({
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
  });
  const vfsStats = state.vfsManifestStats || state.vfsManifestCollector?.stats || null;
  const vfsExtra = vfsStats
    ? {
      rows: vfsStats.totalRecords || 0,
      bytes: vfsStats.totalBytes || 0,
      maxLineBytes: vfsStats.maxLineBytes || 0,
      trimmedRows: vfsStats.trimmedRows || 0,
      droppedRows: vfsStats.droppedRows || 0,
      runsSpilled: vfsStats.runsSpilled || 0
    }
    : null;
  stageCheckpoints.record({
    stage: 'stage2',
    step: 'write',
    extra: {
      chunks: state.chunks?.length || 0,
      tokens: state.totalTokens || 0,
      tokenVocab: postings.tokenVocab?.length || 0,
      vfsManifest: vfsExtra
    }
  });
  throwIfAborted(abortSignal);
  if (runtimeRef?.overallProgress?.advance) {
    const finalStage = stagePlan[stagePlan.length - 1];
    runtimeRef.overallProgress.advance({ message: `${mode} ${finalStage.label}` });
  }
  await enqueueEmbeddingJob({ runtime: runtimeRef, mode, indexDir: outDir, abortSignal });
  crashLogger.updatePhase('done');
  cacheReporter.report();
  await stageCheckpoints.flush();
}
