import { compareStrings } from './sort.js';

export const summarizeRiskCategories = (summary) => {
  const counts = new Map();
  const groups = [
    summary?.signals?.sources,
    summary?.signals?.sinks,
    summary?.signals?.sanitizers,
    summary?.signals?.localFlows
  ];
  for (const group of groups) {
    for (const entry of Array.isArray(group) ? group : []) {
      const key = typeof entry?.category === 'string' && entry.category.trim() ? entry.category.trim() : null;
      if (!key) continue;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => (b.count - a.count) || compareStrings(a.category, b.category));
};

export const summarizeRiskTags = (summary) => {
  const counts = new Map();
  const groups = [
    summary?.signals?.sources,
    summary?.signals?.sinks,
    summary?.signals?.sanitizers
  ];
  for (const group of groups) {
    for (const entry of Array.isArray(group) ? group : []) {
      for (const tag of Array.isArray(entry?.tags) ? entry.tags : []) {
        const key = typeof tag === 'string' && tag.trim() ? tag.trim() : null;
        if (!key) continue;
        counts.set(key, (counts.get(key) || 0) + 1);
      }
    }
  }
  return Array.from(counts.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => (b.count - a.count) || compareStrings(a.tag, b.tag));
};

export const summarizeRiskPropagatorLikeRoles = (flows = []) => {
  const counts = new Map();
  for (const flow of Array.isArray(flows) ? flows : []) {
    const watchSteps = Array.isArray(flow?.path?.watchByStep) ? flow.path.watchByStep : [];
    for (const step of watchSteps) {
      for (const role of Array.isArray(step?.semanticKinds) ? step.semanticKinds : []) {
        const key = typeof role === 'string' && role.trim() ? role.trim() : null;
        if (!key) continue;
        counts.set(key, (counts.get(key) || 0) + 1);
      }
    }
  }
  return Array.from(counts.entries())
    .map(([role, count]) => ({ role, count }))
    .sort((a, b) => (b.count - a.count) || compareStrings(a.role, b.role));
};

export const normalizeRiskSummary = (summary, flows = []) => {
  if (!summary || typeof summary !== 'object') return null;
  return {
    chunkUid: summary.chunkUid || null,
    file: summary.file || null,
    languageId: summary.languageId || null,
    symbol: summary.symbol && typeof summary.symbol === 'object'
      ? {
        name: summary.symbol.name || null,
        kind: summary.symbol.kind || null,
        signature: summary.symbol.signature || null
      }
      : null,
    totals: summary.totals && typeof summary.totals === 'object'
      ? {
        sources: Number.isFinite(summary.totals.sources) ? summary.totals.sources : 0,
        sinks: Number.isFinite(summary.totals.sinks) ? summary.totals.sinks : 0,
        sanitizers: Number.isFinite(summary.totals.sanitizers) ? summary.totals.sanitizers : 0,
        localFlows: Number.isFinite(summary.totals.localFlows) ? summary.totals.localFlows : 0
      }
      : null,
    truncated: summary.truncated && typeof summary.truncated === 'object'
      ? {
        sources: summary.truncated.sources === true,
        sinks: summary.truncated.sinks === true,
        sanitizers: summary.truncated.sanitizers === true,
        localFlows: summary.truncated.localFlows === true,
        evidence: summary.truncated.evidence === true
      }
      : null,
    ruleRoles: {
      sources: Number.isFinite(summary?.totals?.sources) ? summary.totals.sources : 0,
      sinks: Number.isFinite(summary?.totals?.sinks) ? summary.totals.sinks : 0,
      sanitizers: Number.isFinite(summary?.totals?.sanitizers) ? summary.totals.sanitizers : 0
    },
    propagatorLikeRoles: summarizeRiskPropagatorLikeRoles(flows),
    topCategories: summarizeRiskCategories(summary),
    topTags: summarizeRiskTags(summary),
    previewFlowIds: Array.isArray(flows) ? flows.map((flow) => flow?.flowId).filter(Boolean) : []
  };
};

export const summarizeRiskStats = (stats) => ({
  status: stats?.status || null,
  reason: stats?.reason || null,
  summaryOnly: stats?.effectiveConfig?.summaryOnly === true,
  flowsEmitted: Number.isFinite(stats?.counts?.flowsEmitted) ? stats.counts.flowsEmitted : null,
  partialFlowsEmitted: Number.isFinite(stats?.counts?.partialFlowsEmitted) ? stats.counts.partialFlowsEmitted : null,
  summariesEmitted: Number.isFinite(stats?.counts?.summariesEmitted) ? stats.counts.summariesEmitted : null,
  uniqueCallSitesReferenced: Number.isFinite(stats?.counts?.uniqueCallSitesReferenced)
    ? stats.counts.uniqueCallSitesReferenced
    : null,
  capsHit: Array.isArray(stats?.capsHit) ? stats.capsHit.slice() : [],
  callSiteSampling: stats?.callSiteSampling || null,
  effectiveConfig: stats?.effectiveConfig || null
});
