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

const normalizeExplainEvidence = (evidence) => (
  evidence && Array.isArray(evidence.callSitesByStep)
    ? {
      callSitesByStep: evidence.callSitesByStep.map((step) => Array.isArray(step)
        ? step.map((entry) => ({
          callSiteId: entry?.callSiteId || null,
          details: entry?.details || null
        }))
        : [])
    }
    : null
);

const normalizeBlockedExpansion = (entry) => ({
  targetChunkUid: entry?.targetChunkUid || null,
  reason: entry?.reason || null,
  callSiteIds: Array.isArray(entry?.callSiteIds) ? entry.callSiteIds.filter(Boolean) : []
});

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
    evidence: normalizeExplainEvidence(evidence)
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
          ? flow.frontier.blockedExpansions.map(normalizeBlockedExpansion)
          : []
      }
      : null,
    path: normalizeExplainPath(flow.path, evidence),
    evidence: normalizeExplainEvidence(evidence),
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

export const formatRiskNodeRef = (ref) => {
  if (!ref || typeof ref !== 'object') return 'unknown';
  if (ref.type === 'chunk') return `chunk:${ref.chunkUid}`;
  if (ref.type === 'symbol') return `symbol:${ref.symbolId}`;
  if (ref.type === 'file') return `file:${ref.path}`;
  if (ref.status) {
    const target = ref.targetName ? ` ${ref.targetName}` : '';
    return `ref:${ref.status}${target}`;
  }
  return 'unknown';
};

export const formatRiskPath = (pathValue) => {
  if (!pathValue || typeof pathValue !== 'object') return '';
  if (Array.isArray(pathValue.nodes) && pathValue.nodes.length) {
    return pathValue.nodes.map(formatRiskNodeRef).join(' -> ');
  }
  if (Array.isArray(pathValue.labels) && pathValue.labels.length) {
    return pathValue.labels.join(' -> ');
  }
  return '';
};

export const buildRiskFlowSelection = (flows, { maxFlows = 3, maxEvidencePerFlow = 3 } = {}) => {
  const list = Array.isArray(flows) ? flows : [];
  const shownFlows = Math.min(list.length, maxFlows);
  return {
    totalFlows: list.length,
    shownFlows,
    omittedFlows: Math.max(0, list.length - shownFlows),
    maxFlows,
    maxEvidencePerFlow
  };
};

export const buildPartialRiskFlowSelection = (
  partialFlows,
  { maxPartialFlows = 3, maxEvidencePerFlow = 3 } = {}
) => {
  const list = Array.isArray(partialFlows) ? partialFlows : [];
  const shownPartialFlows = Math.min(list.length, maxPartialFlows);
  return {
    totalPartialFlows: list.length,
    shownPartialFlows,
    omittedPartialFlows: Math.max(0, list.length - shownPartialFlows),
    maxPartialFlows,
    maxEvidencePerFlow
  };
};

export const formatRiskCallSiteDetails = (site) => {
  if (!site || typeof site !== 'object') return '';
  const file = site.file || 'unknown-file';
  const loc = Number.isFinite(site.startLine)
    ? `${site.startLine}:${Number.isFinite(site.startCol) ? site.startCol : 1}`
    : '?:?';
  const callee = site.calleeNormalized || site.calleeRaw || 'call';
  const args = Array.isArray(site.args) && site.args.length ? `(${site.args.join(', ')})` : '';
  const invocation = `${callee}${args}`;
  const excerptText = typeof site.excerpt === 'string' ? site.excerpt.replace(/\s+/g, ' ').trim() : '';
  const excerpt = excerptText && excerptText !== invocation ? ` | ${excerptText}` : '';
  return `${file}:${loc} ${invocation}${excerpt}`;
};

export const collectRiskCallSiteStepEvidence = (flow, maxEvidencePerFlow) => {
  const detailedSteps = Array.isArray(flow?.evidence?.callSitesByStep)
    ? flow.evidence.callSitesByStep
    : Array.isArray(flow?.callSitesByStep)
      ? flow.callSitesByStep
      : [];
  if (detailedSteps.length) {
    return detailedSteps.map((step, index) => {
      const rendered = (Array.isArray(step) ? step : [])
        .slice(0, maxEvidencePerFlow)
        .map((entry) => {
          if (entry?.details) return formatRiskCallSiteDetails(entry.details);
          if (entry?.callSiteId) return entry.callSiteId;
          return '';
        })
        .filter(Boolean);
      return rendered.length ? { index, rendered } : null;
    }).filter(Boolean);
  }
  const rawSteps = Array.isArray(flow?.path?.callSiteIdsByStep) ? flow.path.callSiteIdsByStep : [];
  return rawSteps.map((step, index) => {
    const rendered = (Array.isArray(step) ? step : [])
      .slice(0, maxEvidencePerFlow)
      .filter(Boolean);
    return rendered.length ? { index, rendered } : null;
  }).filter(Boolean);
};

export const normalizeRiskWatchWindow = (entry) => {
  if (!entry || typeof entry !== 'object') return null;
  return {
    taintIn: Array.isArray(entry.taintIn) ? entry.taintIn.filter(Boolean) : [],
    taintOut: Array.isArray(entry.taintOut) ? entry.taintOut.filter(Boolean) : [],
    propagatedArgIndices: Array.isArray(entry.propagatedArgIndices)
      ? entry.propagatedArgIndices.filter((value) => Number.isFinite(value))
      : [],
    boundParams: Array.isArray(entry.boundParams) ? entry.boundParams.filter(Boolean) : [],
    calleeNormalized: entry.calleeNormalized || null,
    semanticIds: Array.isArray(entry.semanticIds) ? entry.semanticIds.filter(Boolean) : [],
    semanticKinds: Array.isArray(entry.semanticKinds) ? entry.semanticKinds.filter(Boolean) : [],
    sanitizerPolicy: entry.sanitizerPolicy || null,
    sanitizerBarrierApplied: entry.sanitizerBarrierApplied === true,
    sanitizerBarriersBefore: Number.isFinite(entry.sanitizerBarriersBefore) ? entry.sanitizerBarriersBefore : null,
    sanitizerBarriersAfter: Number.isFinite(entry.sanitizerBarriersAfter) ? entry.sanitizerBarriersAfter : null,
    confidenceBefore: Number.isFinite(entry.confidenceBefore) ? entry.confidenceBefore : null,
    confidenceAfter: Number.isFinite(entry.confidenceAfter) ? entry.confidenceAfter : null,
    confidenceDelta: Number.isFinite(entry.confidenceDelta) ? entry.confidenceDelta : null
  };
};

export const buildRiskNarrativeSteps = (flow, maxEvidencePerFlow) => {
  const stepEvidence = collectRiskCallSiteStepEvidence(flow, maxEvidencePerFlow);
  const evidenceByIndex = new Map(stepEvidence.map((step) => [step.index, step]));
  const rawWatchSteps = Array.isArray(flow?.path?.watchByStep) ? flow.path.watchByStep : [];
  const stepCount = Math.max(
    stepEvidence.length ? Math.max(...stepEvidence.map((step) => step.index + 1)) : 0,
    rawWatchSteps.length
  );
  return Array.from({ length: stepCount }, (_, index) => {
    const evidence = evidenceByIndex.get(index);
    const watchWindow = normalizeRiskWatchWindow(rawWatchSteps[index]);
    if (!evidence && !watchWindow) return null;
    return {
      step: index + 1,
      evidence: evidence ? evidence.rendered.slice() : [],
      watchWindow
    };
  }).filter(Boolean);
};

export const normalizeRiskNarrativeConfidence = (flow) => {
  const confidence = Number.isFinite(flow?.confidence) ? flow.confidence : null;
  return {
    confidence,
    confidenceLabel: Number.isFinite(confidence) ? confidence.toFixed(2) : 'n/a'
  };
};

export const normalizeRiskNarrativeRuleRef = (rule) => (
  rule && typeof rule === 'object'
    ? {
      ruleId: rule.ruleId || null,
      ruleName: rule.ruleName || null,
      ruleRole: rule.ruleRole || rule.ruleType || null,
      tags: Array.isArray(rule.tags) ? rule.tags.filter(Boolean) : []
    }
    : null
);

export const buildRiskFlowNarrativeList = (
  flows,
  {
    heading = 'Risk Flows',
    maxFlows = 3,
    maxEvidencePerFlow = 3
  } = {}
) => {
  const list = Array.isArray(flows) ? flows : [];
  const limited = list.slice(0, maxFlows);
  return {
    heading,
    totalFlows: list.length,
    shownFlows: limited.length,
    omittedFlows: Math.max(0, list.length - limited.length),
    maxFlows,
    maxEvidencePerFlow,
    flows: limited.map((flow) => {
      const confidence = normalizeRiskNarrativeConfidence(flow);
      const sourceRule = flow?.source?.ruleId || null;
      const sinkRule = flow?.sink?.ruleId || null;
      const path = formatRiskPath(flow?.path) || null;
      return {
        flowId: flow?.flowId || 'flow',
        ...confidence,
        category: flow?.category || null,
        sourceRule,
        sinkRule,
        source: normalizeRiskNarrativeRuleRef(flow?.source),
        sink: normalizeRiskNarrativeRuleRef(flow?.sink),
        path,
        steps: buildRiskNarrativeSteps(flow, maxEvidencePerFlow)
      };
    })
  };
};

export const buildPartialRiskFlowNarrativeList = (
  partialFlows,
  {
    heading = 'Partial Risk Flows',
    maxPartialFlows = 3,
    maxEvidencePerFlow = 3
  } = {}
) => {
  const list = Array.isArray(partialFlows) ? partialFlows : [];
  const limited = list.slice(0, maxPartialFlows);
  return {
    heading,
    totalPartialFlows: list.length,
    shownPartialFlows: limited.length,
    omittedPartialFlows: Math.max(0, list.length - limited.length),
    maxPartialFlows,
    maxEvidencePerFlow,
    partialFlows: limited.map((flow) => {
      const confidence = normalizeRiskNarrativeConfidence(flow);
      const path = formatRiskPath(flow?.path) || null;
      return {
        partialFlowId: flow?.partialFlowId || 'partial-flow',
        ...confidence,
        source: normalizeRiskNarrativeRuleRef(flow?.source),
        terminalReason: flow?.frontier?.terminalReason || flow?.notes?.terminalReason || null,
        frontierChunkUid: flow?.frontier?.chunkUid || null,
        blockedExpansions: Array.isArray(flow?.frontier?.blockedExpansions)
          ? flow.frontier.blockedExpansions.slice(0, maxEvidencePerFlow).map(normalizeBlockedExpansion)
          : [],
        path,
        steps: buildRiskNarrativeSteps(flow, maxEvidencePerFlow)
      };
    })
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
