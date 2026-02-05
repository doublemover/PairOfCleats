import { log } from '../../../../shared/progress.js';
import { throwIfAborted } from '../../../../shared/abort.js';
import { applyCrossFileInference } from '../../../type-inference-crossfile.js';
import { buildRiskSummaries } from '../../../risk-interprocedural/summaries.js';
import { buildRelationGraphs } from '../../graphs.js';
import { scanImports } from '../../imports.js';
import { resolveImportLinks } from '../../import-resolution.js';
import { loadImportResolutionCache, saveImportResolutionCache } from '../../import-resolution-cache.js';

export const resolveImportScanPlan = ({ runtime, mode, relationsEnabled }) => {
  const importScanRaw = runtime.indexingConfig?.importScan;
  const importScanMode = typeof importScanRaw === 'string'
    ? importScanRaw.trim().toLowerCase()
    : (importScanRaw === false ? 'off' : 'pre');
  const enableImportLinks = importScanMode !== 'off';
  const usePreScan = importScanMode === 'pre' || importScanMode === 'prescan';
  const shouldScan = mode === 'code' && relationsEnabled && enableImportLinks;
  const importGraphEnabled = runtime.importGraphEnabled !== false;
  return { importScanMode, enableImportLinks, usePreScan, shouldScan, importGraphEnabled };
};

export const preScanImports = async ({
  runtime,
  mode,
  relationsEnabled,
  entries,
  crashLogger,
  timing,
  incrementalState,
  fileTextByFile,
  abortSignal = null
}) => {
  throwIfAborted(abortSignal);
  const scanPlan = resolveImportScanPlan({ runtime, mode, relationsEnabled });
  let importResult = { importsByFile: {}, durationMs: 0, stats: null };
  if (scanPlan.shouldScan && scanPlan.usePreScan) {
    log('Scanning for imports...');
    crashLogger.updatePhase('imports');
    importResult = await scanImports({
      files: entries,
      root: runtime.root,
      mode,
      languageOptions: runtime.languageOptions,
      importConcurrency: runtime.importConcurrency,
      queue: runtime.queues.io,
      incrementalState,
      fileTextByFile,
      abortSignal
    });
    timing.importsMs = importResult.durationMs;
    if (importResult?.stats) {
      const { modules, edges, files } = importResult.stats;
      log(`→ Imports: modules=${modules}, edges=${edges}, files=${files}`);
    }
  } else if (scanPlan.shouldScan) {
    log('Skipping import pre-scan; will enrich import links from relations.');
  } else if (mode === 'code' && relationsEnabled) {
    log('Import link enrichment disabled via indexing.importScan.');
  } else if (mode === 'code') {
    log('Skipping import scan for sparse stage.');
  }
  return { importResult, scanPlan };
};

export const postScanImports = async ({
  mode,
  relationsEnabled,
  scanPlan,
  state,
  timing,
  runtime,
  entries,
  importResult,
  incrementalState,
  fileTextByFile
}) => {
  if (!scanPlan?.shouldScan) return null;
  if (!mode || mode !== 'code' || !relationsEnabled || !scanPlan.enableImportLinks) return null;
  const importStart = Date.now();
  let importsByFile = importResult?.importsByFile;
  if (!importsByFile || Object.keys(importsByFile).length === 0) {
    importsByFile = Object.create(null);
    for (const [file, relations] of state.fileRelations.entries()) {
      const imports = Array.isArray(relations?.imports) ? relations.imports : null;
      if (imports && imports.length) importsByFile[file] = imports;
    }
  }
  const cacheEnabled = incrementalState?.enabled === true;
  let cache = null;
  let cachePath = null;
  let fileHashes = null;
  let cacheStats = null;
  if (cacheEnabled) {
    ({ cache, cachePath } = await loadImportResolutionCache({ incrementalState, log }));
    fileHashes = new Map();
    const manifestFiles = incrementalState?.manifest?.files || {};
    for (const [file, entry] of Object.entries(manifestFiles)) {
      if (entry?.hash) fileHashes.set(file, entry.hash);
    }
    if (fileTextByFile?.get) {
      for (const file of Object.keys(importsByFile)) {
        if (fileHashes.has(file)) continue;
        const cached = fileTextByFile.get(file);
        if (cached && typeof cached === 'object' && cached.hash) {
          fileHashes.set(file, cached.hash);
        }
      }
    }
  }
  const resolution = resolveImportLinks({
    root: runtime.root,
    entries,
    importsByFile,
    fileRelations: state.fileRelations,
    log,
    mode,
    enableGraph: scanPlan.importGraphEnabled,
    graphMeta: {
      toolVersion: runtime.toolInfo?.version || null,
      importScanMode: scanPlan.importScanMode || null
    },
    cache,
    fileHashes,
    cacheStats
  });
  if (resolution?.graph) {
    state.importResolutionGraph = resolution.graph;
  }
  if (cacheEnabled && cache && cachePath) {
    await saveImportResolutionCache({ cache, cachePath });
  }
  const resolvedResult = {
    importsByFile,
    stats: resolution?.stats || null,
    cacheStats: resolution?.cacheStats || cacheStats || null,
    durationMs: Date.now() - importStart
  };
  timing.importsMs = resolvedResult.durationMs;
  if (resolvedResult?.stats) {
    const { resolved, external, unresolved } = resolvedResult.stats;
    log(`→ Imports: resolved=${resolved}, external=${external}, unresolved=${unresolved}`);
  }
  return resolvedResult;
};

export const runCrossFileInference = async ({
  runtime,
  mode,
  state,
  crashLogger,
  featureMetrics,
  relationsEnabled,
  abortSignal = null
}) => {
  throwIfAborted(abortSignal);
  const policy = runtime.analysisPolicy || {};
  const typeInferenceEnabled = typeof policy?.typeInference?.local?.enabled === 'boolean'
    ? policy.typeInference.local.enabled
    : runtime.typeInferenceEnabled;
  const typeInferenceCrossFileEnabled = typeof policy?.typeInference?.crossFile?.enabled === 'boolean'
    ? policy.typeInference.crossFile.enabled
    : runtime.typeInferenceCrossFileEnabled;
  const riskAnalysisEnabled = typeof policy?.risk?.enabled === 'boolean'
    ? policy.risk.enabled
    : runtime.riskAnalysisEnabled;
  const riskAnalysisCrossFileEnabled = typeof policy?.risk?.crossFile === 'boolean'
    ? policy.risk.crossFile
    : runtime.riskAnalysisCrossFileEnabled;
  const riskInterproceduralEnabled = typeof policy?.risk?.interprocedural === 'boolean'
    ? policy.risk.interprocedural
    : runtime.riskInterproceduralEnabled;
  const riskInterproceduralEmitArtifacts = runtime.riskInterproceduralConfig?.emitArtifacts || null;
  const shouldBuildRiskSummaries = mode === 'code'
    && (riskInterproceduralEnabled || riskInterproceduralEmitArtifacts === 'jsonl');
  const useTooling = typeof policy?.typeInference?.tooling?.enabled === 'boolean'
    ? policy.typeInference.tooling.enabled
    : (typeInferenceEnabled && typeInferenceCrossFileEnabled && runtime.toolingEnabled);
  const enableCrossFileTypeInference = typeInferenceEnabled && typeInferenceCrossFileEnabled;
  const crossFileEnabled = typeInferenceCrossFileEnabled
    || riskAnalysisCrossFileEnabled
    || riskInterproceduralEnabled;
  if (mode === 'code' && crossFileEnabled) {
    crashLogger.updatePhase('cross-file');
    const crossFileStart = Date.now();
    const crossFileStats = await applyCrossFileInference({
      rootDir: runtime.root,
      buildRoot: runtime.buildRoot,
      chunks: state.chunks,
      enabled: true,
      log,
      useTooling,
      enableTypeInference: enableCrossFileTypeInference,
      enableRiskCorrelation: riskAnalysisEnabled && riskAnalysisCrossFileEnabled,
      fileRelations: state.fileRelations
    });
    const crossFileDurationMs = Date.now() - crossFileStart;
    if (featureMetrics?.recordSettingByLanguageShare) {
      const crossFileTargets = [];
      if (typeInferenceCrossFileEnabled) crossFileTargets.push('typeInferenceCrossFile');
      if (riskAnalysisCrossFileEnabled) crossFileTargets.push('riskAnalysisCrossFile');
      const shareMs = crossFileTargets.length ? crossFileDurationMs / crossFileTargets.length : 0;
      for (const target of crossFileTargets) {
        featureMetrics.recordSettingByLanguageShare({
          mode,
          setting: target,
          enabled: true,
          durationMs: shareMs
        });
      }
    }
    if (crossFileStats) {
      const formatCount = (value) => Number.isFinite(value) ? value.toLocaleString() : '0';
      const callLinks = Number.isFinite(crossFileStats.linkedCalls) ? crossFileStats.linkedCalls : 0;
      const usageLinks = Number.isFinite(crossFileStats.linkedUsages) ? crossFileStats.linkedUsages : 0;
      const returns = Number.isFinite(crossFileStats.inferredReturns) ? crossFileStats.inferredReturns : 0;
      const riskFlows = Number.isFinite(crossFileStats.riskFlows) ? crossFileStats.riskFlows : 0;
      log(
        `Cross-File Inference: ${formatCount(callLinks)} Call Links, ` +
        `${formatCount(usageLinks)} Usage Links, ${formatCount(returns)} Returns, ` +
        `${formatCount(riskFlows)} Risk Flows`
      );
    }
  }
  const graphRelations = mode === 'code' && relationsEnabled
    ? buildRelationGraphs({
      chunks: state.chunks,
      fileRelations: state.fileRelations,
      caps: runtime.indexingConfig?.graph?.caps,
      emitNodes: false
    })
    : null;
  if (graphRelations?.caps) {
    const formatSamples = (samples) => (samples || [])
      .map((sample) => {
        const file = sample?.file || 'unknown';
        const chunkId = sample?.chunkId ? `#${sample.chunkId}` : '';
        return `${file}${chunkId}`;
      })
      .filter(Boolean)
      .join(', ');
    for (const [label, cap] of Object.entries(graphRelations.caps)) {
      if (!cap?.reason) continue;
      const sampleText = formatSamples(cap.samples);
      const suffix = sampleText ? ` Examples: ${sampleText}` : '';
      log(`[relations] ${label} capped (${cap.reason}).${suffix}`);
    }
  }
  if (shouldBuildRiskSummaries) {
    crashLogger.updatePhase('risk-summaries');
    const summaryStart = Date.now();
    const { rows, stats } = buildRiskSummaries({
      chunks: state.chunks,
      runtime,
      mode,
      log
    });
    state.riskSummaryTimingMs = Date.now() - summaryStart;
    state.riskSummaries = rows;
    state.riskSummaryStats = stats;
    if (stats?.emitted && Number.isFinite(stats.emitted)) {
      log(`Risk summaries: ${stats.emitted.toLocaleString()} rows`);
    }
  }
  return { crossFileEnabled, graphRelations };
};
