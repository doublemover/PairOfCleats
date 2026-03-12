'use strict';

function formatRef(ref) {
  if (!ref || typeof ref !== 'object') return 'unknown';
  if (ref.type === 'chunk') return `chunk:${ref.chunkUid}`;
  if (ref.type === 'symbol') return `symbol:${ref.symbolId}`;
  if (ref.type === 'file') return `file:${ref.path}`;
  if (ref.status) {
    const target = ref.targetName ? ` ${ref.targetName}` : '';
    return `ref:${ref.status}${target}`;
  }
  return 'unknown';
}

function formatPath(pathValue) {
  if (!pathValue || typeof pathValue !== 'object') return '';
  if (Array.isArray(pathValue.nodes) && pathValue.nodes.length) {
    return pathValue.nodes.map(formatRef).join(' -> ');
  }
  if (Array.isArray(pathValue.labels) && pathValue.labels.length) {
    return pathValue.labels.join(' -> ');
  }
  return '';
}

function normalizeExplainSubject(subject) {
  if (!subject || typeof subject !== 'object') return null;
  return {
    chunkUid: subject.chunkUid || null,
    file: subject.file || null,
    name: subject.name || null,
    kind: subject.kind || null
  };
}

function normalizeExplainFilters(filters) {
  if (!filters || typeof filters !== 'object') return null;
  const sourceRule = filters.sourceRule || filters.source_rule || null;
  const sinkRule = filters.sinkRule || filters.sink_rule || null;
  if (!sourceRule && !sinkRule) return null;
  return { sourceRule, sinkRule };
}

function normalizeExplainPath(pathValue, evidence = null) {
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
}

function normalizeExplainFlow(flow) {
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
}

function buildRiskExplanationModel({
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
} = {}) {
  return {
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
  };
}

function buildRiskExplanationModelFromStandalone(payload) {
  return buildRiskExplanationModel({
    subject: payload?.chunk || null,
    summary: payload?.summary || null,
    stats: payload?.stats || null,
    provenance: payload?.stats?.provenance || payload?.provenance || null,
    analysisStatus: payload?.stats && typeof payload.stats === 'object'
      ? {
        status: payload.stats.status || null,
        reason: payload.stats.reason || null,
        summaryOnly: payload?.stats?.effectiveConfig?.summaryOnly === true,
        code: payload.stats.status || null,
        capsHit: Array.isArray(payload?.stats?.capsHit) ? payload.stats.capsHit.slice() : []
      }
      : null,
    filters: payload?.filters || null,
    flows: payload?.flows || []
  });
}

function buildRiskExplanationModelFromRiskSlice(risk) {
  return buildRiskExplanationModel({
    summary: risk?.summary || null,
    stats: risk?.stats || null,
    provenance: risk?.provenance || null,
    analysisStatus: risk?.analysisStatus || null,
    anchor: risk?.anchor || null,
    caps: risk?.caps || null,
    truncation: risk?.truncation || [],
    flows: risk?.flows || []
  });
}

function formatCallSiteDetails(site) {
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
}

function collectCallSiteStepEvidence(flow, maxEvidencePerFlow) {
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
}

function renderRiskExplain(flows, { heading = 'Risk Flows', maxFlows = 3, maxEvidencePerFlow = 3 } = {}) {
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
    const flowPath = formatPath(flow?.path);
    if (flowPath) {
      lines.push(`  path: ${flowPath}`);
    }
    const stepEvidence = collectCallSiteStepEvidence(flow, maxEvidencePerFlow);
    for (const step of stepEvidence) {
      lines.push(`  step ${step.index + 1}: ${step.rendered.join('; ')}`);
    }
  }
  return lines.join('\n');
}

function renderAnalysisStatus(model, lines) {
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
    if (parts.length) lines.push(`- artifacts: ${parts.join(', ')}`);
  }
}

function renderSummary(model, lines) {
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
}

function renderStats(model, lines) {
  const stats = model?.stats || null;
  if (!stats) return;
  const extras = [];
  if (stats.status) extras.push(`status ${stats.status}`);
  if (stats.flowsEmitted != null) extras.push(`flows ${stats.flowsEmitted}`);
  if (stats.summariesEmitted != null) extras.push(`summaries ${stats.summariesEmitted}`);
  if (stats.uniqueCallSitesReferenced != null) extras.push(`call sites ${stats.uniqueCallSitesReferenced}`);
  if (Array.isArray(stats.capsHit) && stats.capsHit.length) extras.push(`caps ${stats.capsHit.join(', ')}`);
  if (extras.length) lines.push(`- interprocedural: ${extras.join(', ')}`);
}

function renderProvenance(model, lines) {
  const provenance = model?.provenance || null;
  if (!provenance) return;
  const parts = [];
  if (provenance.generatedAt) parts.push(`generated ${provenance.generatedAt}`);
  if (provenance.ruleBundle?.version || provenance.ruleBundle?.fingerprint) {
    const ruleBits = [provenance.ruleBundle.version || null, provenance.ruleBundle.fingerprint || null].filter(Boolean);
    parts.push(`rules ${ruleBits.join(' ')}`);
  }
  if (provenance.effectiveConfigFingerprint) parts.push(`config ${provenance.effectiveConfigFingerprint}`);
  if (parts.length) lines.push(`- provenance: ${parts.join(', ')}`);
  if (provenance.artifactRefs) {
    const refs = Object.entries(provenance.artifactRefs)
      .filter(([, value]) => value && typeof value === 'object')
      .map(([key, value]) => `${key}=${value.entrypoint || value.name || 'present'}`);
    if (refs.length) lines.push(`- artifact refs: ${refs.join(', ')}`);
  }
}

function renderFilters(model, lines) {
  const filters = model?.filters || null;
  if (!filters) return;
  const parts = [];
  if (filters.sourceRule) parts.push(`sourceRule ${filters.sourceRule}`);
  if (filters.sinkRule) parts.push(`sinkRule ${filters.sinkRule}`);
  if (parts.length) lines.push(`- filters: ${parts.join(', ')}`);
}

function renderAnchor(model, lines) {
  const anchor = model?.anchor || null;
  if (!anchor?.kind) return;
  const parts = [anchor.kind];
  if (anchor.chunkUid) parts.push(anchor.chunkUid);
  if (anchor.flowId) parts.push(`flow ${anchor.flowId}`);
  lines.push(`- anchor: ${parts.join(' | ')}`);
  if (Array.isArray(anchor.alternates) && anchor.alternates.length) {
    lines.push(`- alternate anchors: ${anchor.alternates.map((entry) => `${entry.kind}:${entry.chunkUid || 'unknown'}`).join(', ')}`);
  }
}

function renderCaps(model, lines) {
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
}

function renderTruncation(model, lines) {
  if (!Array.isArray(model?.truncation) || !model.truncation.length) return;
  lines.push(`- truncation: ${model.truncation.map((entry) => entry.cap).join(', ')}`);
}

function renderRiskExplanation(model, {
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
} = {}) {
  const lines = [];
  if (title) lines.push(title);
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
  lines.push(renderRiskExplain(model?.flows || [], { heading: 'Risk Flows', maxFlows, maxEvidencePerFlow }));
  return lines.join('\n');
}

function renderPrimary(primary) {
  const lines = [];
  lines.push('Primary');
  if (!primary) {
    lines.push('- (missing)');
    return lines;
  }
  const file = primary.file || 'unknown';
  const range = primary.range && primary.range.startLine != null && primary.range.endLine != null
    ? `[${primary.range.startLine}-${primary.range.endLine}]`
    : '';
  lines.push(`File: ${file}${range ? `:${range}` : ''}`);
  const excerpt = primary.excerpt || '';
  if (excerpt) {
    lines.push('');
    lines.push('Excerpt:');
    lines.push(excerpt);
  }
  return lines;
}

function renderTypes(types) {
  const lines = [];
  lines.push('Types');
  if (!types || !Array.isArray(types.facts) || !types.facts.length) {
    lines.push('- (none)');
    return lines;
  }
  for (const fact of types.facts) {
    lines.push(`- ${fact.role}: ${fact.type}`);
  }
  return lines;
}

function renderGraphContextPack(pack) {
  if (!pack || typeof pack !== 'object') return '';
  const lines = [];
  lines.push('# Graph Context Pack');
  lines.push('');
  lines.push('## Seed');
  lines.push(`- ${formatRef(pack.seed)}`);
  lines.push('');
  lines.push('## Nodes');
  const nodes = Array.isArray(pack.nodes) ? pack.nodes : [];
  if (!nodes.length) {
    lines.push('- (none)');
  } else {
    for (const node of nodes) {
      const parts = [];
      if (node?.name) parts.push(node.name);
      if (node?.kind) parts.push(node.kind);
      if (node?.file) parts.push(node.file);
      const suffix = parts.length ? ` (${parts.join(', ')})` : '';
      const distance = Number.isFinite(node?.distance) ? node.distance : 0;
      lines.push(`- [${distance}] ${formatRef(node?.ref)}${suffix}`);
    }
  }
  const edges = Array.isArray(pack.edges) ? pack.edges : [];
  lines.push('');
  lines.push('## Edges');
  if (!edges.length) {
    lines.push('- (none)');
  } else {
    for (const edge of edges) {
      const graph = edge?.graph ? `, ${edge.graph}` : '';
      lines.push(`- ${formatRef(edge?.from)} -> ${formatRef(edge?.to)} (${edge?.edgeType || 'edge'}${graph})`);
    }
  }
  const paths = Array.isArray(pack.paths) ? pack.paths : [];
  if (paths.length) {
    lines.push('');
    lines.push('## Witness Paths');
    for (const pathValue of paths) {
      const nodesText = Array.isArray(pathValue?.nodes)
        ? pathValue.nodes.map(formatRef).join(' -> ')
        : '';
      lines.push(`- ${formatRef(pathValue?.to)} (${pathValue?.distance ?? 0}): ${nodesText}`);
    }
  }
  if (Array.isArray(pack.warnings) && pack.warnings.length) {
    lines.push('');
    lines.push('## Warnings');
    for (const warning of pack.warnings) {
      lines.push(`- ${warning.code}: ${warning.message}`);
    }
  }
  lines.push('');
  return lines.join('\n');
}

function renderRisk(risk) {
  const lines = [];
  lines.push('Risk');
  if (!risk) {
    lines.push('- (none)');
    return lines.join('\n');
  }
  if (risk?.anchor?.kind) {
    const anchorParts = [risk.anchor.kind];
    if (risk.anchor.chunkUid) anchorParts.push(risk.anchor.chunkUid);
    if (risk.anchor.flowId) anchorParts.push(`flow ${risk.anchor.flowId}`);
    lines.push(`- anchor: ${anchorParts.join(' | ')}`);
  }
  lines.push('');
  lines.push(renderRiskExplanation(buildRiskExplanationModelFromRiskSlice(risk), {
    title: null,
    includeSubject: false,
    includeFilters: false,
    maxFlows: 5
  }));
  return lines.join('\n');
}

function renderCompositeContextPack(payload) {
  const sections = [];
  sections.push(renderPrimary(payload?.primary).join('\n'));
  if (payload?.graph) {
    sections.push(renderGraphContextPack(payload.graph));
  }
  if (payload?.types) {
    sections.push(renderTypes(payload.types).join('\n'));
  }
  if (payload?.risk) {
    sections.push(renderRisk(payload.risk));
  }
  return sections.filter(Boolean).join('\n\n');
}

module.exports = {
  buildRiskExplanationModelFromRiskSlice,
  buildRiskExplanationModelFromStandalone,
  renderCompositeContextPack,
  renderRiskExplain,
  renderRiskExplanation
};
