import { materializeRiskFilters } from './risk-filters.js';
import { normalizeRiskSummary, summarizeRiskStats } from './risk-explain-summary.js';

const normalizeExplainStats = (stats) => {
  if (!stats || typeof stats !== 'object') return null;
  if (
    Number.isFinite(stats.flowsEmitted)
    || Number.isFinite(stats.partialFlowsEmitted)
    || Number.isFinite(stats.summariesEmitted)
    || Number.isFinite(stats.uniqueCallSitesReferenced)
  ) {
    return stats;
  }
  return summarizeRiskStats(stats);
};

const normalizeExplainSubject = (subject) => {
  if (!subject || typeof subject !== 'object') return null;
  return {
    chunkUid: subject.chunkUid || null,
    file: subject.file || null,
    name: subject.name || null,
    kind: subject.kind || null
  };
};

const normalizeExplainFilters = (filters) => materializeRiskFilters(filters);

const normalizeExplainPath = (pathValue, evidence = null) => {
  const rawStepIds = Array.isArray(pathValue?.callSiteIdsByStep)
    ? pathValue.callSiteIdsByStep
    : Array.isArray(evidence?.callSitesByStep)
      ? evidence.callSitesByStep.map((step) => step.map((entry) => entry?.callSiteId || null).filter(Boolean))
      : [];
  return {
    nodes: Array.isArray(pathValue?.nodes) ? pathValue.nodes.slice() : [],
    labels: Array.isArray(pathValue?.labels) ? pathValue.labels.slice() : [],
    callSiteIdsByStep: rawStepIds.map((step) => (Array.isArray(step) ? step.filter(Boolean) : [])),
    watchByStep: Array.isArray(pathValue?.watchByStep)
      ? pathValue.watchByStep
        .slice(0, rawStepIds.length || undefined)
        .map((entry) => (entry && typeof entry === 'object' ? { ...entry } : null))
      : []
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

const normalizeExplainPartialFlow = (flow) => {
  if (!flow || typeof flow !== 'object') return null;
  const evidence = flow?.evidence && typeof flow.evidence === 'object' ? flow.evidence : null;
  return {
    partialFlowId: flow.partialFlowId || null,
    confidence: Number.isFinite(flow.confidence) ? flow.confidence : null,
    source: flow.source || null,
    frontier: flow.frontier && typeof flow.frontier === 'object'
      ? {
        chunkUid: flow.frontier.chunkUid || null,
        terminalReason: flow.frontier.terminalReason || null,
        blockedExpansions: Array.isArray(flow.frontier.blockedExpansions)
          ? flow.frontier.blockedExpansions.map((entry) => ({
            targetChunkUid: entry?.targetChunkUid || null,
            reason: entry?.reason || null,
            callSiteIds: Array.isArray(entry?.callSiteIds) ? entry.callSiteIds.filter(Boolean) : []
          }))
          : []
      }
      : null,
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
      : null,
    notes: flow?.notes && typeof flow.notes === 'object'
      ? {
        strictness: flow.notes.strictness || null,
        sanitizerPolicy: flow.notes.sanitizerPolicy || null,
        hopCount: Number.isFinite(flow.notes.hopCount) ? flow.notes.hopCount : null,
        sanitizerBarriersHit: Number.isFinite(flow.notes.sanitizerBarriersHit) ? flow.notes.sanitizerBarriersHit : null,
        capsHit: Array.isArray(flow.notes.capsHit) ? flow.notes.capsHit.slice() : [],
        terminalReason: flow.notes.terminalReason || null
      }
      : null
  };
};

export const buildRiskExplanationModel = ({
  subject = null,
  summary = null,
  support = null,
  stats = null,
  provenance = null,
  analysisStatus = null,
  anchor = null,
  caps = null,
  truncation = null,
  filters = null,
  flows = [],
  partialFlows = []
} = {}) => ({
  subject: normalizeExplainSubject(subject),
  summary: summary && typeof summary === 'object' ? summary : null,
  support: support && typeof support === 'object' ? support : null,
  stats: stats && typeof stats === 'object' ? stats : null,
  provenance: provenance && typeof provenance === 'object' ? provenance : null,
  analysisStatus: analysisStatus && typeof analysisStatus === 'object' ? analysisStatus : null,
  anchor: anchor && typeof anchor === 'object' ? anchor : null,
  caps: caps && typeof caps === 'object' ? caps : null,
  truncation: Array.isArray(truncation) ? truncation.slice() : [],
  filters: normalizeExplainFilters(filters),
  flows: Array.isArray(flows) ? flows.map(normalizeExplainFlow).filter(Boolean) : [],
  partialFlows: Array.isArray(partialFlows) ? partialFlows.map(normalizeExplainPartialFlow).filter(Boolean) : []
});

export const buildRiskExplanationModelFromStandalone = ({
  chunk = null,
  summary = null,
  support = null,
  stats = null,
  provenance = null,
  filters = null,
  flows = [],
  partialFlows = []
} = {}) => buildRiskExplanationModel({
  subject: chunk,
  summary: normalizeRiskSummary(summary, flows),
  support,
  stats: normalizeExplainStats(stats),
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
  flows,
  partialFlows
});

export const buildRiskExplanationModelFromRiskSlice = (risk, { subject = null, filters = null } = {}) => buildRiskExplanationModel({
  subject,
  summary: risk?.summary || null,
  support: risk?.support || null,
  stats: normalizeExplainStats(risk?.stats || null),
  provenance: risk?.provenance || null,
  analysisStatus: risk?.analysisStatus || null,
  anchor: risk?.anchor || null,
  caps: risk?.caps || null,
  truncation: risk?.truncation || [],
  filters: filters || risk?.filters || null,
  flows: risk?.flows || [],
  partialFlows: risk?.partialFlows || []
});
