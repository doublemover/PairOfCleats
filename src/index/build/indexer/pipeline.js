import fs from 'node:fs/promises';
import { applyAdaptiveDictConfig, getIndexDir, getMetricsDir } from '../../../../tools/dict-utils.js';
import { buildRecordsIndexForRepo } from '../../../integrations/triage/index-records.js';
import { createCacheReporter } from '../../../shared/cache.js';
import { getEnvConfig } from '../../../shared/env.js';
import { log, showProgress } from '../../../shared/progress.js';
import { createCrashLogger } from '../crash-log.js';
import { estimateContextWindow } from '../context-window.js';
import { createPerfProfile, loadPerfProfile } from '../perf-profile.js';
import { createIndexState } from '../state.js';
import { enqueueEmbeddingJob } from './embedding-queue.js';
import { buildIncrementalSignature, buildTokenizationKey } from './signatures.js';
import { runDiscovery } from './steps/discover.js';
import { loadIncrementalPlan, pruneIncrementalState, updateIncrementalBundles } from './steps/incremental.js';
import { buildIndexPostings } from './steps/postings.js';
import { processFiles } from './steps/process-files.js';
import { postScanImports, preScanImports, runCrossFileInference } from './steps/relations.js';
import { writeIndexArtifactsForMode } from './steps/write.js';

const buildFeatureSettings = (runtime, mode) => ({
  tokenize: true,
  embeddings: runtime.embeddingEnabled || runtime.embeddingService,
  gitBlame: runtime.gitBlameEnabled,
  pythonAst: runtime.languageOptions?.pythonAst?.enabled !== false && mode === 'code',
  treeSitter: runtime.languageOptions?.treeSitter?.enabled !== false,
  typeInference: runtime.typeInferenceEnabled && mode === 'code',
  riskAnalysis: runtime.riskAnalysisEnabled && mode === 'code',
  lint: runtime.lintEnabled && mode === 'code',
  complexity: runtime.complexityEnabled && mode === 'code',
  astDataflow: runtime.astDataflowEnabled && mode === 'code',
  controlFlow: runtime.controlFlowEnabled && mode === 'code',
  typeInferenceCrossFile: runtime.typeInferenceCrossFileEnabled && mode === 'code',
  riskAnalysisCrossFile: runtime.riskAnalysisCrossFileEnabled && mode === 'code'
});

/**
 * Build indexes for a given mode.
 * @param {{mode:'code'|'prose'|'records'|'extracted-prose',runtime:object,discovery?:{entries:Array,skippedFiles:Array}}} input
 */
export async function buildIndexForMode({ mode, runtime, discovery = null }) {
  if (mode === 'records') {
    await buildRecordsIndexForRepo({ runtime, discovery });
    if (runtime?.overallProgress?.advance) {
      runtime.overallProgress.advance({ message: 'records' });
    }
    return;
  }
  const crashLogger = await createCrashLogger({
    repoCacheRoot: runtime.repoCacheRoot,
    enabled: runtime.debugCrash,
    log
  });
  const outDir = getIndexDir(runtime.root, mode, runtime.userConfig, { indexRoot: runtime.buildRoot });
  await fs.mkdir(outDir, { recursive: true });
  log(`\n📄  Scanning ${mode} …`);
  const timing = { start: Date.now() };
  const metricsDir = getMetricsDir(runtime.root, runtime.userConfig);
  const perfFeatures = {
    stage: runtime.stage || null,
    embeddings: runtime.embeddingEnabled || runtime.embeddingService,
    treeSitter: runtime.languageOptions?.treeSitter?.enabled !== false,
    relations: runtime.stage !== 'stage1',
    tooling: runtime.toolingEnabled,
    typeInference: runtime.typeInferenceEnabled,
    riskAnalysis: runtime.riskAnalysisEnabled
  };
  const perfProfile = createPerfProfile({
    configHash: runtime.configHash,
    mode,
    buildId: runtime.buildId,
    features: perfFeatures
  });
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

  const state = createIndexState();
  const cacheReporter = createCacheReporter({ enabled: runtime.verboseCache, log });
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
      message: stage.label
    });
  };

  advanceStage(stagePlan[0]);
  const allEntries = await runDiscovery({
    runtime,
    mode,
    discovery,
    state,
    timing,
    stageNumber: stageIndex
  });
  runtime.dictConfig = applyAdaptiveDictConfig(runtime.dictConfig, allEntries.length);
  const tokenizationKey = buildTokenizationKey(runtime, mode);
  const cacheSignature = buildIncrementalSignature(runtime, mode, tokenizationKey);
  const { incrementalState, reused } = await loadIncrementalPlan({
    runtime,
    mode,
    outDir,
    entries: allEntries,
    tokenizationKey,
    cacheSignature,
    cacheReporter
  });
  if (reused) {
    cacheReporter.report();
    return;
  }

  const relationsEnabled = runtime.stage !== 'stage1';
  advanceStage(stagePlan[1]);
  let { importResult, scanPlan } = await preScanImports({
    runtime,
    mode,
    relationsEnabled,
    entries: allEntries,
    crashLogger,
    timing,
    incrementalState
  });

  const contextWin = await estimateContextWindow({
    files: allEntries.map((entry) => entry.abs),
    root: runtime.root,
    mode,
    languageOptions: runtime.languageOptions
  });
  log(`Auto-selected context window: ${contextWin} lines`);

  advanceStage(stagePlan[2]);
  const processResult = await processFiles({
    mode,
    runtime,
    discovery,
    entries: allEntries,
    importResult,
    contextWin,
    timing,
    crashLogger,
    state,
    perfProfile,
    cacheReporter,
    seenFiles,
    incrementalState,
    relationsEnabled,
    shardPerfProfile
  });
  const { tokenizationStats, shardSummary } = processResult;

  const postImportResult = postScanImports({
    mode,
    relationsEnabled,
    scanPlan,
    state,
    timing
  });
  if (postImportResult) importResult = postImportResult;

  advanceStage(stagePlan[3]);
  const { crossFileEnabled, graphRelations } = await runCrossFileInference({
    runtime,
    mode,
    state,
    crashLogger,
    featureMetrics,
    relationsEnabled
  });
  if (mode === 'code' && crossFileEnabled) {
    await updateIncrementalBundles({
      runtime,
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
    runtime,
    incrementalState,
    seenFiles
  });

  log(`   → Indexed ${state.chunks.length} chunks, total tokens: ${state.totalTokens.toLocaleString()}`);

  advanceStage(stagePlan[4]);
  const postings = await buildIndexPostings({ runtime, state });

  advanceStage(stagePlan[5]);
  await writeIndexArtifactsForMode({
    runtime,
    mode,
    outDir,
    state,
    postings,
    timing,
    entries: allEntries,
    perfProfile,
    graphRelations,
    shardSummary
  });
  if (runtime?.overallProgress?.advance) {
    const finalStage = stagePlan[stagePlan.length - 1];
    runtime.overallProgress.advance({ message: `${mode} ${finalStage.label}` });
  }
  await enqueueEmbeddingJob({ runtime, mode });
  crashLogger.updatePhase('done');
  cacheReporter.report();
}
