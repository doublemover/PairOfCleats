import { log } from '../../../../../shared/progress.js';
import { throwIfAborted } from '../../../../../shared/abort.js';
import { applyCrossFileInference } from '../../../../type-inference-crossfile.js';
import {
  applyCrossFileInferenceBudgetPlan,
  buildCrossFileInferenceBudgetPlan,
  buildCrossFileInferenceRoiMetrics
} from './cross-file-budget.js';
import { buildAndStoreRiskSummaries, shouldBuildRiskSummaries } from './risk-summary.js';

const safeDivide = (numerator, denominator) => {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return 0;
  return numerator / denominator;
};

const formatCount = (value) => (Number.isFinite(value) ? value.toLocaleString() : '0');
const formatRatio = (value) => `${(safeDivide(Number(value) || 0, 1) * 100).toFixed(2)}%`;

/**
 * Run cross-file type/risk inference and build optional interprocedural
 * summaries for emitted artifacts.
 *
 * @param {object} input
 * @returns {Promise<object|null>}
 */
export const runCrossFileInference = async ({
  runtime,
  mode,
  state,
  crashLogger,
  featureMetrics,
  relationsEnabled = true,
  crossFileInferenceEnabled = relationsEnabled,
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
  const summarizeRisk = shouldBuildRiskSummaries({
    mode,
    riskInterproceduralEnabled,
    riskInterproceduralEmitArtifacts
  });
  const allowCrossFileInference = crossFileInferenceEnabled !== false;
  const useTooling = typeof policy?.typeInference?.tooling?.enabled === 'boolean'
    ? policy.typeInference.tooling.enabled
    : (typeInferenceEnabled && typeInferenceCrossFileEnabled && runtime.toolingEnabled);
  const hugeRepoInferenceLiteConfig = runtime.indexingConfig?.hugeRepoInferenceLite
    && typeof runtime.indexingConfig.hugeRepoInferenceLite === 'object'
    ? runtime.indexingConfig.hugeRepoInferenceLite
    : {};
  const inferenceLiteEnabled = mode === 'code' && (
    hugeRepoInferenceLiteConfig.enabled === true
    || (
      runtime.hugeRepoProfileEnabled === true
      && hugeRepoInferenceLiteConfig.enabled !== false
    )
  );
  const inferenceLiteHighSignalOnly = hugeRepoInferenceLiteConfig.highSignalOnly !== false;
  const enableCrossFileTypeInference = allowCrossFileInference
    && typeInferenceEnabled
    && typeInferenceCrossFileEnabled;
  const crossFileEnabled = allowCrossFileInference && (
    typeInferenceCrossFileEnabled
    || riskAnalysisCrossFileEnabled
    || riskInterproceduralEnabled
  );

  if (mode === 'code' && crossFileEnabled) {
    crashLogger.updatePhase('cross-file');
    const budgetPlan = buildCrossFileInferenceBudgetPlan({
      chunks: state.chunks,
      fileRelations: state.fileRelations,
      inferenceLiteEnabled
    });
    const {
      fileRelations: inferenceFileRelations,
      budgetStats
    } = applyCrossFileInferenceBudgetPlan({
      chunks: state.chunks,
      fileRelations: state.fileRelations,
      plan: budgetPlan
    });
    state.fileRelations = inferenceFileRelations;
    state.crossFileInferenceBudgetStats = budgetStats;

    if (budgetStats) {
      const earlyStopTriggered = budgetStats.earlyStop?.triggered === true;
      const earlyStopGain = Number.isFinite(budgetStats.earlyStop?.windowGain)
        ? budgetStats.earlyStop.windowGain
        : null;
      log(
        `[perf] cross-file budget tune scale=${budgetStats.scaleProfile?.id || 'unknown'} ` +
        `calls=${formatCount(budgetStats.retained.callSignals)}/${formatCount(budgetStats.input.callSignals)}, ` +
        `usages=${formatCount(budgetStats.retained.chunkUsageSignals + budgetStats.retained.fileUsageSignals)}/` +
        `${formatCount(budgetStats.input.chunkUsageSignals + budgetStats.input.fileUsageSignals)}, ` +
        `earlyStop=${earlyStopTriggered ? 'triggered' : 'not-triggered'}` +
        (earlyStopTriggered && earlyStopGain != null
          ? ` (windowGain=${formatRatio(earlyStopGain)})`
          : '')
      );
    }

    const crossFileStart = Date.now();
    const crossFileStats = await applyCrossFileInference({
      rootDir: runtime.root,
      buildRoot: runtime.buildRoot,
      cacheRoot: runtime.repoCacheRoot,
      chunks: state.chunks,
      enabled: true,
      log,
      useTooling,
      enableTypeInference: enableCrossFileTypeInference,
      enableRiskCorrelation: riskAnalysisEnabled && riskAnalysisCrossFileEnabled,
      fileRelations: inferenceFileRelations,
      inferenceLite: inferenceLiteEnabled,
      inferenceLiteHighSignalOnly,
      abortSignal
    });
    const crossFileDurationMs = Date.now() - crossFileStart;
    const roiMetrics = buildCrossFileInferenceRoiMetrics({
      crossFileStats,
      budgetStats,
      durationMs: crossFileDurationMs
    });
    state.crossFileInferenceRoi = roiMetrics;

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
      const callLinks = Number.isFinite(crossFileStats.linkedCalls) ? crossFileStats.linkedCalls : 0;
      const usageLinks = Number.isFinite(crossFileStats.linkedUsages) ? crossFileStats.linkedUsages : 0;
      const returns = Number.isFinite(crossFileStats.inferredReturns) ? crossFileStats.inferredReturns : 0;
      const riskFlows = Number.isFinite(crossFileStats.riskFlows) ? crossFileStats.riskFlows : 0;
      const toolingDegradedProviders = Number.isFinite(crossFileStats.toolingDegradedProviders)
        ? crossFileStats.toolingDegradedProviders
        : 0;
      const toolingDegradedWarnings = Number.isFinite(crossFileStats.toolingDegradedWarnings)
        ? crossFileStats.toolingDegradedWarnings
        : 0;
      const toolingDegradedErrors = Number.isFinite(crossFileStats.toolingDegradedErrors)
        ? crossFileStats.toolingDegradedErrors
        : 0;
      const toolingProvidersExecuted = Number.isFinite(crossFileStats.toolingProvidersExecuted)
        ? crossFileStats.toolingProvidersExecuted
        : 0;
      const toolingProvidersContributed = Number.isFinite(crossFileStats.toolingProvidersContributed)
        ? crossFileStats.toolingProvidersContributed
        : 0;
      const toolingRequests = Number.isFinite(crossFileStats.toolingRequests)
        ? crossFileStats.toolingRequests
        : 0;
      const toolingRequestFailures = Number.isFinite(crossFileStats.toolingRequestFailures)
        ? crossFileStats.toolingRequestFailures
        : 0;
      const toolingRequestTimeouts = Number.isFinite(crossFileStats.toolingRequestTimeouts)
        ? crossFileStats.toolingRequestTimeouts
        : 0;
      log(
        `Cross-File Inference: ${formatCount(callLinks)} Call Links, ` +
        `${formatCount(usageLinks)} Usage Links, ${formatCount(returns)} Returns, ` +
        `${formatCount(riskFlows)} Risk Flows`
      );
      if (toolingProvidersExecuted > 0 || toolingRequests > 0) {
        log(
          `[tooling] cross-file runtime providers=${formatCount(toolingProvidersExecuted)} ` +
          `(contributed=${formatCount(toolingProvidersContributed)}), ` +
          `requests=${formatCount(toolingRequests)}, ` +
          `failed=${formatCount(toolingRequestFailures)}, ` +
          `timedOut=${formatCount(toolingRequestTimeouts)}.`
        );
      }
      if (toolingDegradedProviders > 0) {
        log(
          `[tooling] cross-file degraded providers=${formatCount(toolingDegradedProviders)} ` +
          `(warnings=${formatCount(toolingDegradedWarnings)}, errors=${formatCount(toolingDegradedErrors)}).`
        );
      }
      if (crossFileStats.cacheHit) {
        log('[perf] cross-file output cache reused.');
      }
      if (crossFileStats.inferenceLiteEnabled === true) {
        log('[perf] cross-file inference lite profile active (high-signal links only).');
      }
    }

    if (roiMetrics) {
      log(
        `[perf] cross-file roi linkAdditions=${formatCount(roiMetrics.linkAdditions)}, ` +
        `retainedAfterFiltering=${formatCount(roiMetrics.retainedLinksAfterFiltering)}, ` +
        `contributionSignal=${formatCount(roiMetrics.contributionSignal)}, ` +
        `retentionRate=${formatRatio(roiMetrics.linkRetentionRate)}, ` +
        `contributionPerLink=${(roiMetrics.contributionPerAddedLink || 0).toFixed(4)}`
      );
      const tooling = roiMetrics.tooling || null;
      if (tooling && (
        Number(tooling.providersExecuted) > 0
        || Number(tooling.requests) > 0
        || Number(tooling.degradedProviders) > 0
      )) {
        log(
          `[perf] cross-file roi tooling providers=${formatCount(tooling.providersExecuted)} ` +
          `(contributed=${formatCount(tooling.providersContributed)}, degraded=${formatCount(tooling.degradedProviders)}), ` +
          `requests=${formatCount(tooling.requests)}, ` +
          `failureRate=${formatRatio(tooling.requestFailureRate)}, ` +
          `timeoutRate=${formatRatio(tooling.requestTimeoutRate)}`
        );
      }
    }
  }

  if (summarizeRisk) {
    buildAndStoreRiskSummaries({ runtime, mode, state, crashLogger });
  }

  // graph_relations is written during the artifact phase from streamed edges to avoid
  // materializing Graphology graphs in memory.
  return { crossFileEnabled, graphRelations: null };
};
