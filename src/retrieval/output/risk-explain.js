import {
  buildRiskExplanationModelFromRiskSlice,
  buildRiskExplanationModelFromStandalone
} from '../../shared/risk-explain.js';

const formatNodeRef = (ref) => {
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

const formatPath = (pathValue) => {
  if (!pathValue || typeof pathValue !== 'object') return '';
  if (Array.isArray(pathValue.nodes) && pathValue.nodes.length) {
    return pathValue.nodes.map(formatNodeRef).join(' -> ');
  }
  if (Array.isArray(pathValue.labels) && pathValue.labels.length) {
    return pathValue.labels.join(' -> ');
  }
  return '';
};

const formatCallSiteDetails = (site) => {
  if (!site || typeof site !== 'object') return '';
  const file = site.file || 'unknown-file';
  const loc = Number.isFinite(site.startLine)
    ? `${site.startLine}:${Number.isFinite(site.startCol) ? site.startCol : 1}`
    : '?:?';
  const callee = site.calleeNormalized || site.calleeRaw || 'call';
  const args = Array.isArray(site.args) && site.args.length ? `(${site.args.join(', ')})` : '';
  return `${file}:${loc} ${callee}${args}`;
};

const collectCallSiteStepEvidence = (flow, maxEvidencePerFlow) => {
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
          if (entry?.details) return formatCallSiteDetails(entry.details);
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

export const renderRiskExplain = (
  flows,
  {
    heading = 'Risk Flows',
    maxFlows = 3,
    maxEvidencePerFlow = 3
  } = {}
) => {
  const lines = [];
  lines.push(heading);
  if (!Array.isArray(flows) || flows.length === 0) {
    lines.push('- (none)');
    return lines.join('\n');
  }
  const limited = flows.slice(0, maxFlows);
  for (const flow of limited) {
    const confidence = Number.isFinite(flow?.confidence) ? flow.confidence.toFixed(2) : 'n/a';
    const flowId = flow?.flowId || 'flow';
    const category = flow?.category ? ` ${flow.category}` : '';
    lines.push(`- [${confidence}] ${flowId}${category}`);
    const sourceRule = flow?.source?.ruleId;
    const sinkRule = flow?.sink?.ruleId;
    if (sourceRule || sinkRule) {
      lines.push(`  rules: ${sourceRule || 'source'} -> ${sinkRule || 'sink'}`);
    }
    const path = formatPath(flow?.path);
    if (path) {
      lines.push(`  path: ${path}`);
    }
    const stepEvidence = collectCallSiteStepEvidence(flow, maxEvidencePerFlow);
    for (const step of stepEvidence) {
      lines.push(`  step ${step.index + 1}: ${step.rendered.join('; ')}`);
    }
  }
  return lines.join('\n');
};

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

const renderStats = (model, lines) => {
  const stats = model?.stats || null;
  if (!stats) return;
  const extras = [];
  if (stats.status) extras.push(`status ${stats.status}`);
  if (stats.flowsEmitted != null) extras.push(`flows ${stats.flowsEmitted}`);
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
  if (filters.sourceRule) parts.push(`sourceRule ${filters.sourceRule}`);
  if (filters.sinkRule) parts.push(`sinkRule ${filters.sinkRule}`);
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
  if (caps.maxStepsPerFlow != null) capParts.push(`maxStepsPerFlow ${caps.maxStepsPerFlow}`);
  if (caps.maxCallSitesPerStep != null) capParts.push(`maxCallSitesPerStep ${caps.maxCallSitesPerStep}`);
  if (caps.maxBytes != null) capParts.push(`maxBytes ${caps.maxBytes}`);
  if (caps.maxTokens != null) capParts.push(`maxTokens ${caps.maxTokens}`);
  if (capParts.length) lines.push(`- pack caps: ${capParts.join(', ')}`);
  if (Array.isArray(caps.hits) && caps.hits.length) {
    lines.push(`- cap hits: ${caps.hits.join(', ')}`);
  }
};

const renderTruncation = (model, lines) => {
  if (!Array.isArray(model?.truncation) || !model.truncation.length) return;
  lines.push(`- truncation: ${model.truncation.map((entry) => entry.cap).join(', ')}`);
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
    maxEvidencePerFlow = 3
  } = {}
) => {
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
    lines.push(`- flows: ${Array.isArray(model?.flows) ? model.flows.length : 0}`);
  }
  if (includeAnchor) renderAnchor(model, lines);
  if (includeAnalysisStatus) renderAnalysisStatus(model, lines);
  if (includeSummary) renderSummary(model, lines);
  if (includeStats) renderStats(model, lines);
  if (includeProvenance) renderProvenance(model, lines);
  if (includeCaps) renderCaps(model, lines);
  if (includeTruncation) renderTruncation(model, lines);
  if (includeFilters) renderFilters(model, lines);
  if (lines.length) lines.push('');
  lines.push(renderRiskExplain(model?.flows || [], { maxFlows, maxEvidencePerFlow }));
  return lines.join('\n');
};

export {
  buildRiskExplanationModelFromRiskSlice,
  buildRiskExplanationModelFromStandalone
};
