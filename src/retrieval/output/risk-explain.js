import {
  buildPartialRiskFlowNarrativeList,
  buildPartialRiskFlowSelection,
  buildRiskFlowNarrativeList,
  buildRiskFlowSelection,
  buildRiskExplanationModelFromRiskSlice,
  buildRiskExplanationModelFromStandalone
} from '../../shared/risk-explain-model.js';
import { renderRiskExplanationSarif } from './risk-sarif.js';

export const RISK_EXPLANATION_SURFACE_OPTIONS = Object.freeze({
  standalone: Object.freeze({
    title: 'Risk Explain',
    includeSubject: true,
    includeAnalysisStatus: true,
    includeSummary: true,
    includeStats: true,
    includeProvenance: true,
    includeAnchor: true,
    includeCaps: true,
    includeTruncation: true,
    includeFilters: true,
    maxFlows: 20,
    maxEvidencePerFlow: 20,
    maxPartialFlows: 20
  }),
  contextPack: Object.freeze({
    title: 'Risk',
    includeSubject: false,
    includeAnalysisStatus: true,
    includeSummary: true,
    includeStats: true,
    includeProvenance: true,
    includeAnchor: false,
    includeCaps: true,
    includeTruncation: true,
    includeFilters: true,
    maxFlows: 5,
    maxEvidencePerFlow: 3,
    maxPartialFlows: 5
  })
});

export const getRiskExplanationSurfaceOptions = (surface = 'standalone', overrides = {}) => {
  const defaults = RISK_EXPLANATION_SURFACE_OPTIONS[surface];
  if (!defaults) {
    throw new Error(`Unknown risk explanation surface: ${surface}`);
  }
  return {
    ...defaults,
    ...overrides
  };
};

const formatWatchWindowMarkdown = (watchWindow) => {
  if (!watchWindow) return '';
  const parts = [];
  if (watchWindow.taintIn.length || watchWindow.taintOut.length) {
    const inLabel = watchWindow.taintIn.length ? watchWindow.taintIn.join(', ') : 'none';
    const outLabel = watchWindow.taintOut.length ? watchWindow.taintOut.join(', ') : 'none';
    parts.push(`taint ${inLabel} -> ${outLabel}`);
  }
  if (watchWindow.boundParams.length) {
    parts.push(`params ${watchWindow.boundParams.join(', ')}`);
  } else if (watchWindow.propagatedArgIndices.length) {
    parts.push(`arg# ${watchWindow.propagatedArgIndices.join(', ')}`);
  }
  if (watchWindow.calleeNormalized) {
    parts.push(`callee ${watchWindow.calleeNormalized}`);
  }
  if (watchWindow.semanticIds.length || watchWindow.semanticKinds.length) {
    const labels = watchWindow.semanticIds.length
      ? watchWindow.semanticIds
      : watchWindow.semanticKinds;
    parts.push(`semantics ${labels.join(', ')}`);
  }
  if (watchWindow.sanitizerBarrierApplied) {
    parts.push(`sanitizer ${watchWindow.sanitizerBarriersBefore} -> ${watchWindow.sanitizerBarriersAfter}`);
  }
  if (Number.isFinite(watchWindow.confidenceBefore) && Number.isFinite(watchWindow.confidenceAfter)) {
    parts.push(`confidence ${watchWindow.confidenceBefore.toFixed(4)} -> ${watchWindow.confidenceAfter.toFixed(4)}`);
  }
  return parts.join('; ');
};

const appendRiskNarrativeSteps = (lines, steps) => {
  for (const step of Array.isArray(steps) ? steps : []) {
    lines.push(`  step ${step.step}: ${Array.isArray(step.evidence) ? step.evidence.join('; ') : ''}`);
    if (step?.watchWindow) {
      lines.push(`    watch: ${formatWatchWindowMarkdown(step.watchWindow)}`);
    }
  }
};

export const renderRiskExplain = (
  flows,
  {
    heading = 'Risk Flows',
    maxFlows = 3,
    maxEvidencePerFlow = 3
  } = {}
) => {
  const narrative = buildRiskFlowNarrativeList(flows, { maxFlows, maxEvidencePerFlow, heading });
  return renderRiskFlowNarrativeMarkdown(narrative);
};

const renderRiskFlowNarrativeMarkdown = (narrative) => {
  const lines = [];
  lines.push(narrative.heading || 'Risk Flows');
  if (!Array.isArray(narrative?.flows) || narrative.flows.length === 0) {
    lines.push('- (none)');
    return lines.join('\n');
  }
  for (const flow of narrative.flows) {
    const category = flow?.category ? ` ${flow.category}` : '';
    lines.push(`- [${flow.confidenceLabel || 'n/a'}] ${flow.flowId || 'flow'}${category}`);
    const sourceRule = flow?.sourceRule || null;
    const sinkRule = flow?.sinkRule || null;
    if (sourceRule || sinkRule) {
      lines.push(`  rules: ${sourceRule || 'source'} -> ${sinkRule || 'sink'}`);
    }
    const path = flow?.path || null;
    if (path) {
      lines.push(`  path: ${path}`);
    }
    appendRiskNarrativeSteps(lines, flow?.steps);
  }
  if (narrative.omittedFlows > 0) {
    lines.push(`- truncation: omitted ${narrative.omittedFlows} additional flow(s) after maxFlows=${narrative.maxFlows}`);
  }
  return lines.join('\n');
};

export const renderRiskExplanationJson = (
  model,
  {
    title = 'Risk Explain',
    maxFlows = 3,
    maxEvidencePerFlow = 3,
    maxPartialFlows = 3
  } = {}
) => ({
  title,
  subject: model?.subject || { chunkUid: null, file: null, name: null, kind: null },
  anchor: model?.anchor || null,
  analysisStatus: model?.analysisStatus || null,
  summary: model?.summary || null,
  support: model?.support || null,
  stats: model?.stats || null,
  provenance: model?.provenance || null,
  caps: model?.caps || null,
  truncation: Array.isArray(model?.truncation) ? model.truncation.slice() : [],
  filters: model?.filters || null,
  flowSelection: buildRiskFlowSelection(model?.flows, { maxFlows, maxEvidencePerFlow }),
  partialFlowSelection: buildPartialRiskFlowSelection(model?.partialFlows, { maxPartialFlows, maxEvidencePerFlow }),
  flows: buildRiskFlowNarrativeList(model?.flows || [], { maxFlows, maxEvidencePerFlow }).flows,
  partialFlows: buildPartialRiskFlowNarrativeList(model?.partialFlows || [], { maxPartialFlows, maxEvidencePerFlow }).partialFlows,
  sarif: renderRiskExplanationSarif(model, { maxFlows, maxPartialFlows, maxEvidencePerFlow })
});

const renderAnalysisStatus = (model, lines) => {
  const analysisStatus = model?.analysisStatus || null;
  if (!analysisStatus) return;
  if (analysisStatus.status) {
    lines.push(`- status: ${analysisStatus.status}${analysisStatus.reason ? ` (${analysisStatus.reason})` : ''}`);
  }
  if (analysisStatus.code) {
    lines.push(`- analysis code: ${analysisStatus.code}${analysisStatus.strictFailure ? ' [strict-failure]' : ''}`);
  }
  if (Array.isArray(analysisStatus.degradedReasons) && analysisStatus.degradedReasons.length) {
    lines.push(`- degraded reasons: ${analysisStatus.degradedReasons.join(', ')}`);
  }
  if (analysisStatus.artifactStatus) {
    const parts = Object.entries(analysisStatus.artifactStatus)
      .filter(([, value]) => typeof value === 'string' && value)
      .map(([key, value]) => `${key}=${value}`);
    if (parts.length) {
      lines.push(`- artifacts: ${parts.join(', ')}`);
    }
  }
};

const renderSummary = (model, lines) => {
  const summary = model?.summary || null;
  const totals = summary?.totals || null;
  if (!summary && !totals) return;
  if (totals) {
    lines.push(`- summary: sources ${totals.sources || 0}, sinks ${totals.sinks || 0}, sanitizers ${totals.sanitizers || 0}, localFlows ${totals.localFlows || 0}`);
  }
  if (Array.isArray(summary?.topCategories) && summary.topCategories.length) {
    lines.push(`- top categories: ${summary.topCategories.slice(0, 3).map((entry) => `${entry.category} (${entry.count})`).join(', ')}`);
  }
  if (Array.isArray(summary?.topTags) && summary.topTags.length) {
    lines.push(`- top tags: ${summary.topTags.slice(0, 3).map((entry) => `${entry.tag} (${entry.count})`).join(', ')}`);
  }
};

const renderSupport = (model, lines) => {
  const support = model?.support || null;
  if (!support || typeof support !== 'object') return;
  const language = support.language || null;
  const framework = support.framework || null;
  const downgradePaths = Array.isArray(support.downgradedReasoningPaths)
    ? support.downgradedReasoningPaths
    : [];
  const languageState = language?.state || null;
  const frameworkState = framework?.state || null;
  const shouldRender = languageState === 'partial'
    || languageState === 'unsupported'
    || frameworkState === 'partial'
    || frameworkState === 'unsupported'
    || downgradePaths.length > 0;
  if (!shouldRender) return;

  const parts = [];
  if (language?.languageId) {
    const capabilityParts = [];
    if (language?.capabilities?.riskLocal) capabilityParts.push(`local=${language.capabilities.riskLocal}`);
    if (language?.capabilities?.riskInterprocedural) capabilityParts.push(`interprocedural=${language.capabilities.riskInterprocedural}`);
    const suffix = capabilityParts.length ? ` (${capabilityParts.join(', ')})` : '';
    parts.push(`language ${language.languageId} ${languageState || 'unknown'}${suffix}`);
  }
  if (framework?.frameworkId) {
    parts.push(`framework ${framework.frameworkId} ${frameworkState || 'unknown'}`);
  }
  if (parts.length) {
    lines.push(`- support: ${parts.join('; ')}`);
  }

  const unsupported = language?.unsupportedConstructs || null;
  if (unsupported) {
    const unsupportedParts = [];
    if (Array.isArray(unsupported.sources) && unsupported.sources.length) {
      unsupportedParts.push(`sources ${unsupported.sources.join(', ')}`);
    }
    if (Array.isArray(unsupported.sinks) && unsupported.sinks.length) {
      unsupportedParts.push(`sinks ${unsupported.sinks.join(', ')}`);
    }
    if (Array.isArray(unsupported.sanitizers) && unsupported.sanitizers.length) {
      unsupportedParts.push(`sanitizers ${unsupported.sanitizers.join(', ')}`);
    }
    if (unsupportedParts.length) {
      lines.push(`- unsupported constructs: ${unsupportedParts.join('; ')}`);
    }
  }

  if (downgradePaths.length) {
    lines.push(`- downgraded reasoning: ${downgradePaths.slice(0, 4).map((entry) => entry.message || entry.code).join('; ')}`);
  }
};

const renderStats = (model, lines) => {
  const stats = model?.stats || null;
  if (!stats) return;
  const extras = [];
  if (stats.status) extras.push(`status ${stats.status}`);
  if (stats.flowsEmitted != null) extras.push(`flows ${stats.flowsEmitted}`);
  if (stats.partialFlowsEmitted != null) extras.push(`partial flows ${stats.partialFlowsEmitted}`);
  if (stats.summariesEmitted != null) extras.push(`summaries ${stats.summariesEmitted}`);
  if (stats.uniqueCallSitesReferenced != null) extras.push(`call sites ${stats.uniqueCallSitesReferenced}`);
  if (Array.isArray(stats.capsHit) && stats.capsHit.length) extras.push(`caps ${stats.capsHit.join(', ')}`);
  if (extras.length) lines.push(`- interprocedural: ${extras.join(', ')}`);
};

const renderProvenance = (model, lines) => {
  const provenance = model?.provenance || null;
  if (!provenance) return;
  const parts = [];
  if (provenance.generatedAt) parts.push(`generated ${provenance.generatedAt}`);
  if (provenance.ruleBundle?.version || provenance.ruleBundle?.fingerprint) {
    const ruleBits = [
      provenance.ruleBundle.version || null,
      provenance.ruleBundle.fingerprint || null
    ].filter(Boolean);
    parts.push(`rules ${ruleBits.join(' ')}`);
  }
  if (provenance.effectiveConfigFingerprint) {
    parts.push(`config ${provenance.effectiveConfigFingerprint}`);
  }
  if (parts.length) {
    lines.push(`- provenance: ${parts.join(', ')}`);
  }
  if (provenance.artifactRefs) {
    const refs = Object.entries(provenance.artifactRefs)
      .filter(([, value]) => value && typeof value === 'object')
      .map(([key, value]) => `${key}=${value.entrypoint || value.name || 'present'}`);
    if (refs.length) {
      lines.push(`- artifact refs: ${refs.join(', ')}`);
    }
  }
};

const renderFilters = (model, lines) => {
  const filters = model?.filters || null;
  if (!filters) return;
  const parts = [];
  if (Array.isArray(filters.rule) && filters.rule.length) parts.push(`rule ${filters.rule.join(', ')}`);
  if (Array.isArray(filters.category) && filters.category.length) parts.push(`category ${filters.category.join(', ')}`);
  if (Array.isArray(filters.severity) && filters.severity.length) parts.push(`severity ${filters.severity.join(', ')}`);
  if (Array.isArray(filters.tag) && filters.tag.length) parts.push(`tag ${filters.tag.join(', ')}`);
  if (Array.isArray(filters.source) && filters.source.length) parts.push(`source ${filters.source.join(', ')}`);
  if (Array.isArray(filters.sink) && filters.sink.length) parts.push(`sink ${filters.sink.join(', ')}`);
  if (Array.isArray(filters.sourceRule) && filters.sourceRule.length) parts.push(`sourceRule ${filters.sourceRule.join(', ')}`);
  if (Array.isArray(filters.sinkRule) && filters.sinkRule.length) parts.push(`sinkRule ${filters.sinkRule.join(', ')}`);
  if (Array.isArray(filters.flowId) && filters.flowId.length) parts.push(`flowId ${filters.flowId.join(', ')}`);
  if (parts.length) {
    lines.push(`- filters: ${parts.join(', ')}`);
  }
};

const renderAnchor = (model, lines) => {
  const anchor = model?.anchor || null;
  if (!anchor?.kind) return;
  const parts = [anchor.kind];
  if (anchor.chunkUid) parts.push(anchor.chunkUid);
  if (anchor.flowId) parts.push(`flow ${anchor.flowId}`);
  lines.push(`- anchor: ${parts.join(' | ')}`);
  if (Array.isArray(anchor.alternates) && anchor.alternates.length) {
    lines.push(`- alternate anchors: ${anchor.alternates.map((entry) => `${entry.kind}:${entry.chunkUid || 'unknown'}`).join(', ')}`);
  }
};

const renderCaps = (model, lines) => {
  const caps = model?.caps || null;
  if (!caps || typeof caps !== 'object') return;
  const capParts = [];
  if (caps.maxFlows != null) capParts.push(`maxFlows ${caps.maxFlows}`);
  if (caps.maxPartialFlows != null) capParts.push(`maxPartialFlows ${caps.maxPartialFlows}`);
  if (caps.maxStepsPerFlow != null) capParts.push(`maxStepsPerFlow ${caps.maxStepsPerFlow}`);
  if (caps.maxCallSitesPerStep != null) capParts.push(`maxCallSitesPerStep ${caps.maxCallSitesPerStep}`);
  if (caps.maxBytes != null) capParts.push(`maxBytes ${caps.maxBytes}`);
  if (caps.maxTokens != null) capParts.push(`maxTokens ${caps.maxTokens}`);
  if (caps.maxPartialBytes != null) capParts.push(`maxPartialBytes ${caps.maxPartialBytes}`);
  if (caps.maxPartialTokens != null) capParts.push(`maxPartialTokens ${caps.maxPartialTokens}`);
  if (capParts.length) lines.push(`- pack caps: ${capParts.join(', ')}`);
  if (Array.isArray(caps.hits) && caps.hits.length) {
    lines.push(`- cap hits: ${caps.hits.join(', ')}`);
  }
};

const renderTruncation = (model, lines) => {
  if (!Array.isArray(model?.truncation) || !model.truncation.length) return;
  lines.push(`- truncation: ${model.truncation.map((entry) => entry.cap).join(', ')}`);
};

const renderPartialNarrativeMarkdown = (narrative) => {
  const lines = [];
  lines.push(narrative.heading || 'Partial Risk Flows');
  if (!Array.isArray(narrative?.partialFlows) || narrative.partialFlows.length === 0) {
    lines.push('- (none)');
    return lines.join('\n');
  }
  for (const flow of narrative.partialFlows) {
    const suffix = flow?.terminalReason ? ` ${flow.terminalReason}` : '';
    lines.push(`- [${flow.confidenceLabel || 'n/a'}] ${flow.partialFlowId || 'partial-flow'}${suffix}`);
    if (flow?.frontierChunkUid) {
      lines.push(`  frontier: ${flow.frontierChunkUid}`);
    }
    if (flow?.path) {
      lines.push(`  path: ${flow.path}`);
    }
    for (const blocked of Array.isArray(flow?.blockedExpansions) ? flow.blockedExpansions : []) {
      const target = blocked?.targetChunkUid ? ` -> ${blocked.targetChunkUid}` : '';
      const ids = Array.isArray(blocked?.callSiteIds) && blocked.callSiteIds.length ? ` [${blocked.callSiteIds.join(', ')}]` : '';
      lines.push(`  blocked: ${blocked?.reason || 'blocked'}${target}${ids}`);
    }
    appendRiskNarrativeSteps(lines, flow?.steps);
  }
  if (narrative.omittedPartialFlows > 0) {
    lines.push(`- truncation: omitted ${narrative.omittedPartialFlows} additional partial flow(s) after maxPartialFlows=${narrative.maxPartialFlows}`);
  }
  return lines.join('\n');
};

export const renderRiskExplanation = (
  model,
  {
    title = 'Risk Explain',
    includeSubject = true,
    includeAnalysisStatus = true,
    includeSummary = true,
    includeStats = true,
    includeProvenance = true,
    includeAnchor = true,
    includeCaps = true,
    includeTruncation = true,
    includeFilters = true,
    maxFlows = 3,
    maxEvidencePerFlow = 3,
    maxPartialFlows = 3
  } = {}
) => {
  const narrative = renderRiskExplanationJson(model, {
    title,
    maxFlows,
    maxEvidencePerFlow,
    maxPartialFlows
  });
  const lines = [];
  if (title) {
    lines.push(title);
  }
  const subject = model?.subject || null;
  if (includeSubject && subject) {
    if (subject.chunkUid) lines.push(`- chunkUid: ${subject.chunkUid}`);
    if (subject.file) lines.push(`- file: ${subject.file}`);
    if (subject.name) lines.push(`- symbol: ${subject.name}`);
    if (subject.kind) lines.push(`- kind: ${subject.kind}`);
    lines.push(`- flows: ${narrative.flowSelection.totalFlows}`);
  }
  if (includeAnchor) renderAnchor(model, lines);
  if (includeAnalysisStatus) renderAnalysisStatus(model, lines);
  if (includeSummary) renderSummary(model, lines);
  renderSupport(model, lines);
  if (includeStats) renderStats(model, lines);
  if (includeProvenance) renderProvenance(model, lines);
  if (includeCaps) renderCaps(model, lines);
  if (includeTruncation) renderTruncation(model, lines);
  if (includeFilters) renderFilters(model, lines);
  if (lines.length) lines.push('');
  lines.push(renderRiskFlowNarrativeMarkdown({
    heading: 'Risk Flows',
    ...narrative.flowSelection,
    flows: narrative.flows
  }));
  if (Array.isArray(narrative.partialFlows) && narrative.partialFlows.length) {
    lines.push('');
    lines.push(renderPartialNarrativeMarkdown({
      heading: 'Partial Risk Flows',
      ...narrative.partialFlowSelection,
      partialFlows: narrative.partialFlows
    }));
  }
  return lines.join('\n');
};

export const buildRiskExplanationPresentation = (
  model,
  {
    surface = 'standalone',
    ...overrides
  } = {}
) => {
  const options = getRiskExplanationSurfaceOptions(surface, overrides);
  return {
    model,
    options,
    markdown: renderRiskExplanation(model, options),
    json: renderRiskExplanationJson(model, options)
  };
};

export const buildRiskExplanationPresentationFromStandalone = (
  payload,
  {
    surface = 'standalone',
    ...overrides
  } = {}
) => buildRiskExplanationPresentation(
  buildRiskExplanationModelFromStandalone(payload),
  {
    surface,
    ...overrides
  }
);

export const buildRiskExplanationPresentationFromRiskSlice = (
  risk,
  {
    surface = 'contextPack',
    subject = null,
    filters = null,
    ...overrides
  } = {}
) => buildRiskExplanationPresentation(
  buildRiskExplanationModelFromRiskSlice(risk, { subject, filters }),
  {
    surface,
    ...overrides
  }
);

export {
  buildRiskExplanationModelFromRiskSlice,
  buildRiskExplanationModelFromStandalone
};
