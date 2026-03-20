import { resolveNearestRankPercentile } from '../../../../../shared/perf/percentiles.js';

const summarizeLatencies = (values) => {
  if (!Array.isArray(values) || values.length === 0) {
    return { count: 0, p50Ms: null, p95Ms: null };
  }
  return {
    count: values.length,
    p50Ms: resolveNearestRankPercentile(values, 0.5, { emptyValue: null }),
    p95Ms: resolveNearestRankPercentile(values, 0.95, { emptyValue: null })
  };
};

export const createHoverFileStats = () => ({
  requested: 0,
  succeeded: 0,
  sourceBootstrapUsed: 0,
  hoverTimedOut: 0,
  semanticTokensRequested: 0,
  semanticTokensSucceeded: 0,
  semanticTokensTimedOut: 0,
  signatureHelpRequested: 0,
  signatureHelpSucceeded: 0,
  signatureHelpTimedOut: 0,
  inlayHintsRequested: 0,
  inlayHintsSucceeded: 0,
  inlayHintsTimedOut: 0,
  definitionRequested: 0,
  definitionSucceeded: 0,
  definitionTimedOut: 0,
  typeDefinitionRequested: 0,
  typeDefinitionSucceeded: 0,
  typeDefinitionTimedOut: 0,
  referencesRequested: 0,
  referencesSucceeded: 0,
  referencesTimedOut: 0,
  timedOut: 0,
  skippedByBudget: 0,
  skippedBySoftDeadline: 0,
  skippedByKind: 0,
  skippedByReturnSufficient: 0,
  skippedByAdaptiveDisable: 0,
  skippedByGlobalDisable: 0,
  latencyMs: [],
  disabledAdaptive: false
});

export const summarizeHoverMetrics = ({ hoverMetrics, hoverLatencyMs, hoverFileStats }) => {
  const hoverSummary = summarizeLatencies(hoverLatencyMs);
  const hoverFiles = Array.from(hoverFileStats.entries())
    .map(([virtualPath, stats]) => ({
      virtualPath,
      requested: stats.requested,
      succeeded: stats.succeeded,
      sourceBootstrapUsed: stats.sourceBootstrapUsed,
      hoverTimedOut: stats.hoverTimedOut,
      semanticTokensRequested: stats.semanticTokensRequested,
      semanticTokensSucceeded: stats.semanticTokensSucceeded,
      semanticTokensTimedOut: stats.semanticTokensTimedOut,
      signatureHelpRequested: stats.signatureHelpRequested,
      signatureHelpSucceeded: stats.signatureHelpSucceeded,
      signatureHelpTimedOut: stats.signatureHelpTimedOut,
      inlayHintsRequested: stats.inlayHintsRequested,
      inlayHintsSucceeded: stats.inlayHintsSucceeded,
      inlayHintsTimedOut: stats.inlayHintsTimedOut,
      definitionRequested: stats.definitionRequested,
      definitionSucceeded: stats.definitionSucceeded,
      definitionTimedOut: stats.definitionTimedOut,
      typeDefinitionRequested: stats.typeDefinitionRequested,
      typeDefinitionSucceeded: stats.typeDefinitionSucceeded,
      typeDefinitionTimedOut: stats.typeDefinitionTimedOut,
      referencesRequested: stats.referencesRequested,
      referencesSucceeded: stats.referencesSucceeded,
      referencesTimedOut: stats.referencesTimedOut,
      timedOut: stats.timedOut,
      skippedByBudget: stats.skippedByBudget,
      skippedBySoftDeadline: stats.skippedBySoftDeadline,
      skippedByKind: stats.skippedByKind,
      skippedByReturnSufficient: stats.skippedByReturnSufficient,
      skippedByAdaptiveDisable: stats.skippedByAdaptiveDisable,
      skippedByGlobalDisable: stats.skippedByGlobalDisable,
      disabledAdaptive: stats.disabledAdaptive === true,
      ...summarizeLatencies(stats.latencyMs)
    }))
    .sort((a, b) => {
      const timeoutCmp = (b.timedOut || 0) - (a.timedOut || 0);
      if (timeoutCmp) return timeoutCmp;
      const p95A = Number.isFinite(a.p95Ms) ? a.p95Ms : -1;
      const p95B = Number.isFinite(b.p95Ms) ? b.p95Ms : -1;
      if (p95B !== p95A) return p95B - p95A;
      return String(a.virtualPath || '').localeCompare(String(b.virtualPath || ''));
    });

  return {
    requested: hoverMetrics.requested,
    succeeded: hoverMetrics.succeeded,
    sourceBootstrapUsed: hoverMetrics.sourceBootstrapUsed,
    hoverTimedOut: hoverMetrics.hoverTimedOut,
    semanticTokensRequested: hoverMetrics.semanticTokensRequested,
    semanticTokensSucceeded: hoverMetrics.semanticTokensSucceeded,
    semanticTokensTimedOut: hoverMetrics.semanticTokensTimedOut,
    signatureHelpRequested: hoverMetrics.signatureHelpRequested,
    signatureHelpSucceeded: hoverMetrics.signatureHelpSucceeded,
    signatureHelpTimedOut: hoverMetrics.signatureHelpTimedOut,
    inlayHintsRequested: hoverMetrics.inlayHintsRequested,
    inlayHintsSucceeded: hoverMetrics.inlayHintsSucceeded,
    inlayHintsTimedOut: hoverMetrics.inlayHintsTimedOut,
    definitionRequested: hoverMetrics.definitionRequested,
    definitionSucceeded: hoverMetrics.definitionSucceeded,
    definitionTimedOut: hoverMetrics.definitionTimedOut,
    typeDefinitionRequested: hoverMetrics.typeDefinitionRequested,
    typeDefinitionSucceeded: hoverMetrics.typeDefinitionSucceeded,
    typeDefinitionTimedOut: hoverMetrics.typeDefinitionTimedOut,
    referencesRequested: hoverMetrics.referencesRequested,
    referencesSucceeded: hoverMetrics.referencesSucceeded,
    referencesTimedOut: hoverMetrics.referencesTimedOut,
    timedOut: hoverMetrics.timedOut,
    incompleteSymbols: hoverMetrics.incompleteSymbols,
    hoverTriggeredByIncomplete: hoverMetrics.hoverTriggeredByIncomplete,
    fallbackUsed: hoverMetrics.fallbackUsed,
    fallbackReasonCounts: { ...(hoverMetrics.fallbackReasonCounts || {}) },
    skippedByBudget: hoverMetrics.skippedByBudget,
    skippedBySoftDeadline: hoverMetrics.skippedBySoftDeadline,
    skippedByKind: hoverMetrics.skippedByKind,
    skippedByReturnSufficient: hoverMetrics.skippedByReturnSufficient,
    skippedByAdaptiveDisable: hoverMetrics.skippedByAdaptiveDisable,
    skippedByGlobalDisable: hoverMetrics.skippedByGlobalDisable,
    p50Ms: hoverSummary.p50Ms,
    p95Ms: hoverSummary.p95Ms,
    files: hoverFiles
  };
};
