import { compareStrings } from './sort.js';
import { materializeRiskFilters, normalizeRiskFilters } from './risk-filters.js';

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
  summariesEmitted: Number.isFinite(stats?.counts?.summariesEmitted) ? stats.counts.summariesEmitted : null,
  uniqueCallSitesReferenced: Number.isFinite(stats?.counts?.uniqueCallSitesReferenced)
    ? stats.counts.uniqueCallSitesReferenced
    : null,
  capsHit: Array.isArray(stats?.capsHit) ? stats.capsHit.slice() : [],
  callSiteSampling: stats?.callSiteSampling || null,
  effectiveConfig: stats?.effectiveConfig || null
});

const normalizeExplainSubject = (subject) => {
  if (!subject || typeof subject !== 'object') return null;
  return {
    chunkUid: subject.chunkUid || null,
    file: subject.file || null,
    name: subject.name || null,
    kind: subject.kind || null
  };
};

const normalizeExplainFilters = (filters) => {
  return materializeRiskFilters(filters);
};

const normalizeExplainPath = (pathValue, evidence = null) => {
  const rawStepIds = Array.isArray(pathValue?.callSiteIdsByStep)
    ? pathValue.callSiteIdsByStep
    : Array.isArray(evidence?.callSitesByStep)
      ? evidence.callSitesByStep.map((step) => step.map((entry) => entry?.callSiteId || null).filter(Boolean))
      : [];
  return {
    nodes: Array.isArray(pathValue?.nodes) ? pathValue.nodes.slice() : [],
    labels: Array.isArray(pathValue?.labels) ? pathValue.labels.slice() : [],
    callSiteIdsByStep: rawStepIds.map((step) => (Array.isArray(step) ? step.filter(Boolean) : []))
  };
};

const normalizeExplainFlow = (flow) => {
  if (!flow || typeof flow !== 'object') return null;
  const evidence = flow?.evidence && typeof flow.evidence === 'object' ? flow.evidence : null;
  return {
    flowId: flow.flowId || null,
    confidence: Number.isFinite(flow.confidence) ? flow.confidence : null,
    category: flow.category || flow?.sink?.category || flow?.source?.category || null,
    source: flow.source || null,
    sink: flow.sink || null,
    path: normalizeExplainPath(flow.path, evidence),
    evidence: evidence && Array.isArray(evidence.callSitesByStep)
      ? {
        callSitesByStep: evidence.callSitesByStep.map((step) => Array.isArray(step)
          ? step.map((entry) => ({
            callSiteId: entry?.callSiteId || null,
            details: entry?.details || null
          }))
          : [])
      }
      : null
  };
};

export const buildRiskExplanationModel = ({
  subject = null,
  summary = null,
  stats = null,
  provenance = null,
  analysisStatus = null,
  anchor = null,
  caps = null,
  truncation = null,
  filters = null,
  flows = []
} = {}) => ({
  subject: normalizeExplainSubject(subject),
  summary: summary && typeof summary === 'object' ? summary : null,
  stats: stats && typeof stats === 'object' ? stats : null,
  provenance: provenance && typeof provenance === 'object' ? provenance : null,
  analysisStatus: analysisStatus && typeof analysisStatus === 'object' ? analysisStatus : null,
  anchor: anchor && typeof anchor === 'object' ? anchor : null,
  caps: caps && typeof caps === 'object' ? caps : null,
  truncation: Array.isArray(truncation) ? truncation.slice() : [],
  filters: normalizeExplainFilters(filters),
  flows: Array.isArray(flows) ? flows.map(normalizeExplainFlow).filter(Boolean) : []
});

export const buildRiskExplanationModelFromStandalone = ({
  chunk = null,
  summary = null,
  stats = null,
  provenance = null,
  filters = null,
  flows = []
} = {}) => buildRiskExplanationModel({
  subject: chunk,
  summary: normalizeRiskSummary(summary, flows),
  stats: summarizeRiskStats(stats),
  provenance: provenance || stats?.provenance || null,
  analysisStatus: stats && typeof stats === 'object'
    ? {
      status: stats.status || null,
      reason: stats.reason || null,
      summaryOnly: stats?.effectiveConfig?.summaryOnly === true,
      code: stats.status || null,
      capsHit: Array.isArray(stats.capsHit) ? stats.capsHit.slice() : []
    }
    : null,
  filters,
  flows
});

export const buildRiskExplanationModelFromRiskSlice = (risk, { subject = null, filters = null } = {}) => buildRiskExplanationModel({
  subject,
  summary: risk?.summary || null,
  stats: risk?.stats || null,
  provenance: risk?.provenance || null,
  analysisStatus: risk?.analysisStatus || null,
  anchor: risk?.anchor || null,
  caps: risk?.caps || null,
  truncation: risk?.truncation || [],
  filters: filters || risk?.filters || null,
  flows: risk?.flows || []
});
