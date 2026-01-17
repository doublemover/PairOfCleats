import { log } from '../../../../shared/progress.js';
import { applyCrossFileInference } from '../../../type-inference-crossfile.js';
import { buildRelationGraphs } from '../../graphs.js';
import { buildImportLinksFromRelations, scanImports } from '../../imports.js';

export const resolveImportScanPlan = ({ runtime, mode, relationsEnabled }) => {
  const importScanRaw = runtime.indexingConfig?.importScan;
  const importScanMode = typeof importScanRaw === 'string'
    ? importScanRaw.trim().toLowerCase()
    : (importScanRaw === false ? 'off' : 'post');
  const enableImportLinks = importScanMode !== 'off';
  const usePreScan = importScanMode === 'pre' || importScanMode === 'prescan';
  const shouldScan = mode === 'code' && relationsEnabled && enableImportLinks;
  return { importScanMode, enableImportLinks, usePreScan, shouldScan };
};

export const preScanImports = async ({
  runtime,
  mode,
  relationsEnabled,
  entries,
  crashLogger,
  timing,
  incrementalState
}) => {
  const scanPlan = resolveImportScanPlan({ runtime, mode, relationsEnabled });
  let importResult = { allImports: {}, durationMs: 0, stats: null };
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
      incrementalState
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

export const postScanImports = ({ mode, relationsEnabled, scanPlan, state, timing }) => {
  if (!scanPlan?.shouldScan) return null;
  if (mode === 'code' && relationsEnabled && scanPlan.enableImportLinks && !scanPlan.usePreScan) {
    const importStart = Date.now();
    const importLinks = buildImportLinksFromRelations(state.fileRelations);
    const importResult = {
      allImports: importLinks.allImports || {},
      stats: importLinks.stats || null,
      durationMs: Date.now() - importStart
    };
    timing.importsMs = importResult.durationMs;
    if (importResult?.stats) {
      const { modules, edges, files } = importResult.stats;
      log(`→ Imports: modules=${modules}, edges=${edges}, files=${files}`);
    }
    return importResult;
  }
  return null;
};

export const runCrossFileInference = async ({
  runtime,
  mode,
  state,
  crashLogger,
  featureMetrics,
  relationsEnabled
}) => {
  const crossFileEnabled = runtime.typeInferenceCrossFileEnabled || runtime.riskAnalysisCrossFileEnabled;
  if (mode === 'code' && crossFileEnabled) {
    crashLogger.updatePhase('cross-file');
    const crossFileStart = Date.now();
    const crossFileStats = await applyCrossFileInference({
      rootDir: runtime.root,
      chunks: state.chunks,
      enabled: true,
      log,
      useTooling: runtime.typeInferenceEnabled && runtime.typeInferenceCrossFileEnabled && runtime.toolingEnabled,
      enableTypeInference: runtime.typeInferenceEnabled,
      enableRiskCorrelation: runtime.riskAnalysisEnabled && runtime.riskAnalysisCrossFileEnabled,
      fileRelations: state.fileRelations
    });
    const crossFileDurationMs = Date.now() - crossFileStart;
    if (featureMetrics?.recordSettingByLanguageShare) {
      const crossFileTargets = [];
      if (runtime.typeInferenceCrossFileEnabled) crossFileTargets.push('typeInferenceCrossFile');
      if (runtime.riskAnalysisCrossFileEnabled) crossFileTargets.push('riskAnalysisCrossFile');
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
      const riskFlows = Number.isFinite(crossFileStats.riskFlows) ? crossFileStats.riskFlows : 0;
      log(`Cross-file inference: callLinks=${crossFileStats.linkedCalls}, usageLinks=${crossFileStats.linkedUsages}, returns=${crossFileStats.inferredReturns}, riskFlows=${riskFlows}`);
    }
  }
  const graphRelations = mode === 'code' && relationsEnabled
    ? buildRelationGraphs({
      chunks: state.chunks,
      fileRelations: state.fileRelations
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
  return { crossFileEnabled, graphRelations };
};
