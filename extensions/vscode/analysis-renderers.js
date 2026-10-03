'use strict';

const FILTER_FIELDS = Object.freeze([
  ['rule', 'rule'],
  ['category', 'category'],
  ['severity', 'severity'],
  ['tag', 'tag'],
  ['source', 'source'],
  ['sink', 'sink'],
  ['sourceRule', 'sourceRule', 'source_rule'],
  ['sinkRule', 'sinkRule', 'sink_rule'],
  ['flowId', 'flowId', 'flow_id']
]);

const REF_PREFIX_BY_TYPE = Object.freeze({
  chunk: ['chunk', 'chunkUid'],
  symbol: ['symbol', 'symbolId'],
  file: ['file', 'path']
});

const asArray = (value) => (Array.isArray(value) ? value : []);

const copyArray = (value) => asArray(value).slice();

const objectOrNull = (value) => (value && typeof value === 'object' ? value : null);

function formatRef(ref) {
  if (!ref || typeof ref !== 'object') return 'unknown';
  const typedRef = REF_PREFIX_BY_TYPE[ref.type];
  if (typedRef) return `${typedRef[0]}:${ref[typedRef[1]]}`;
  if (ref.status) {
    return `ref:${ref.status}${ref.targetName ? ` ${ref.targetName}` : ''}`;
  }
  return 'unknown';
}

function formatPath(pathValue) {
  if (!pathValue || typeof pathValue !== 'object') return '';
  if (asArray(pathValue.nodes).length) {
    return pathValue.nodes.map(formatRef).join(' -> ');
  }
  if (asArray(pathValue.labels).length) {
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
  const normalized = {};
  for (const [key, camelKey, snakeKey] of FILTER_FIELDS) {
    normalized[key] = copyArray(filters[camelKey] || filters[snakeKey]);
  }
  return normalized;
}

function collectCallSiteIdsByStep(pathValue, evidence) {
  if (Array.isArray(pathValue?.callSiteIdsByStep)) {
    return pathValue.callSiteIdsByStep;
  }
  if (!Array.isArray(evidence?.callSitesByStep)) {
    return [];
  }
  return evidence.callSitesByStep.map((step) => (
    asArray(step)
      .map((entry) => entry?.callSiteId || null)
      .filter(Boolean)
  ));
}

function normalizeExplainPath(pathValue, evidence = null) {
  return {
    nodes: copyArray(pathValue?.nodes),
    labels: copyArray(pathValue?.labels),
    callSiteIdsByStep: collectCallSiteIdsByStep(pathValue, evidence)
      .map((step) => asArray(step).filter(Boolean))
  };
}

function normalizeCallSiteEvidence(evidence) {
  if (!Array.isArray(evidence?.callSitesByStep)) return null;
  return {
    callSitesByStep: evidence.callSitesByStep.map((step) => (
      asArray(step).map((entry) => ({
        callSiteId: entry?.callSiteId || null,
        details: entry?.details || null
      }))
    ))
  };
}

function normalizeExplainFlow(flow) {
  if (!flow || typeof flow !== 'object') return null;
  const evidence = objectOrNull(flow.evidence);
  return {
    flowId: flow.flowId || null,
    confidence: Number.isFinite(flow.confidence) ? flow.confidence : null,
    category: flow.category || flow?.sink?.category || flow?.source?.category || null,
    source: flow.source || null,
    sink: flow.sink || null,
    path: normalizeExplainPath(flow.path, evidence),
    evidence: normalizeCallSiteEvidence(evidence)
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
    summary: objectOrNull(summary),
    stats: objectOrNull(stats),
    provenance: objectOrNull(provenance),
    analysisStatus: objectOrNull(analysisStatus),
    anchor: objectOrNull(anchor),
    caps: objectOrNull(caps),
    truncation: copyArray(truncation),
    filters: normalizeExplainFilters(filters),
    flows: asArray(flows).map(normalizeExplainFlow).filter(Boolean)
  };
}

function buildRiskExplanationModelFromStandalone(payload) {
  return buildRiskExplanationModel({
    subject: payload?.chunk || null,
    summary: payload?.summary || null,
    stats: payload?.stats || null,
    provenance: payload?.provenance || payload?.stats?.provenance || null,
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

function formatSourceLocation(site) {
  if (!Number.isFinite(site.startLine)) return '?:?';
  return `${site.startLine}:${Number.isFinite(site.startCol) ? site.startCol : 1}`;
}

function formatCallSiteDetails(site) {
  if (!site || typeof site !== 'object') return '';
  const callee = site.calleeNormalized || site.calleeRaw || 'call';
  const args = Array.isArray(site.args) && site.args.length ? `(${site.args.join(', ')})` : '';
  const invocation = `${callee}${args}`;
  const excerptText = typeof site.excerpt === 'string' ? site.excerpt.replace(/\s+/g, ' ').trim() : '';
  const excerpt = excerptText && excerptText !== invocation ? ` | ${excerptText}` : '';
  return `${site.file || 'unknown-file'}:${formatSourceLocation(site)} ${invocation}${excerpt}`;
}

function renderCallSiteEvidence(entry) {
  if (entry?.details) return formatCallSiteDetails(entry.details);
  return entry?.callSiteId || '';
}

function buildStepEvidence(step, index, maxEvidencePerFlow, renderEntry) {
  const rendered = asArray(step)
    .slice(0, maxEvidencePerFlow)
    .map(renderEntry)
    .filter(Boolean);
  return rendered.length ? { index, rendered } : null;
}

function collectCallSiteStepEvidence(flow, maxEvidencePerFlow) {
  const detailedSteps = asArray(flow?.evidence?.callSitesByStep).length
    ? flow.evidence.callSitesByStep
    : asArray(flow?.callSitesByStep);
  if (detailedSteps.length) {
    return detailedSteps
      .map((step, index) => buildStepEvidence(step, index, maxEvidencePerFlow, renderCallSiteEvidence))
      .filter(Boolean);
  }
  return asArray(flow?.path?.callSiteIdsByStep)
    .map((step, index) => buildStepEvidence(step, index, maxEvidencePerFlow, (entry) => entry || ''))
    .filter(Boolean);
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
  const analysisStatus = objectOrNull(model?.analysisStatus);
  if (!analysisStatus) return;
  const simpleLines = [
    analysisStatus.status
      ? `- status: ${analysisStatus.status}${analysisStatus.reason ? ` (${analysisStatus.reason})` : ''}`
      : null,
    analysisStatus.code
      ? `- analysis code: ${analysisStatus.code}${analysisStatus.strictFailure ? ' [strict-failure]' : ''}`
      : null,
    asArray(analysisStatus.degradedReasons).length
      ? `- degraded reasons: ${analysisStatus.degradedReasons.join(', ')}`
      : null
  ].filter(Boolean);
  lines.push(...simpleLines);

  const artifacts = Object.entries(objectOrNull(analysisStatus.artifactStatus) || {})
    .filter(([, value]) => typeof value === 'string' && value)
    .map(([key, value]) => `${key}=${value}`);
  if (artifacts.length) {
    lines.push(`- artifacts: ${artifacts.join(', ')}`);
  }
}

function appendRankedSummary(lines, entries, { label, nameKey }) {
  const ranked = asArray(entries);
  if (!ranked.length) return;
  lines.push(`- ${label}: ${ranked.slice(0, 3).map((entry) => `${entry[nameKey]} (${entry.count})`).join(', ')}`);
}

function renderSummaryTotals(totals) {
  if (!totals) return '';
  return [
    `sources ${totals.sources || 0}`,
    `sinks ${totals.sinks || 0}`,
    `sanitizers ${totals.sanitizers || 0}`,
    `localFlows ${totals.localFlows || 0}`
  ].join(', ');
}

function renderSummary(model, lines) {
  const summary = objectOrNull(model?.summary);
  const totalsText = renderSummaryTotals(summary?.totals);
  if (totalsText) {
    lines.push(`- summary: ${totalsText}`);
  }
  appendRankedSummary(lines, summary?.topCategories, { label: 'top categories', nameKey: 'category' });
  appendRankedSummary(lines, summary?.topTags, { label: 'top tags', nameKey: 'tag' });
}

function renderStats(model, lines) {
  const stats = objectOrNull(model?.stats);
  if (!stats) return;
  const extras = [
    stats.status ? `status ${stats.status}` : null,
    stats.flowsEmitted != null ? `flows ${stats.flowsEmitted}` : null,
    stats.summariesEmitted != null ? `summaries ${stats.summariesEmitted}` : null,
    stats.uniqueCallSitesReferenced != null ? `call sites ${stats.uniqueCallSitesReferenced}` : null,
    asArray(stats.capsHit).length ? `caps ${stats.capsHit.join(', ')}` : null
  ].filter(Boolean);
  if (extras.length) lines.push(`- interprocedural: ${extras.join(', ')}`);
}

function collectProvenanceParts(provenance) {
  const parts = [];
  if (provenance.generatedAt) parts.push(`generated ${provenance.generatedAt}`);
  const ruleBits = [
    provenance.ruleBundle?.version || null,
    provenance.ruleBundle?.fingerprint || null
  ].filter(Boolean);
  if (ruleBits.length) parts.push(`rules ${ruleBits.join(' ')}`);
  if (provenance.effectiveConfigFingerprint) parts.push(`config ${provenance.effectiveConfigFingerprint}`);
  return parts;
}

function collectArtifactRefs(provenance) {
  return Object.entries(objectOrNull(provenance.artifactRefs) || {})
    .filter(([, value]) => value && typeof value === 'object')
    .map(([key, value]) => `${key}=${value.entrypoint || value.name || 'present'}`);
}

function renderProvenance(model, lines) {
  const provenance = objectOrNull(model?.provenance);
  if (!provenance) return;
  const parts = collectProvenanceParts(provenance);
  if (parts.length) lines.push(`- provenance: ${parts.join(', ')}`);
  const refs = collectArtifactRefs(provenance);
  if (refs.length) lines.push(`- artifact refs: ${refs.join(', ')}`);
}

function renderFilters(model, lines) {
  const filters = objectOrNull(model?.filters);
  if (!filters) return;
  const parts = FILTER_FIELDS
    .map(([key]) => (asArray(filters[key]).length ? `${key} ${filters[key].join(', ')}` : null))
    .filter(Boolean);
  if (parts.length) lines.push(`- filters: ${parts.join(', ')}`);
}

function formatAnchorParts(anchor) {
  return [
    anchor.kind,
    anchor.chunkUid || null,
    anchor.flowId ? `flow ${anchor.flowId}` : null
  ].filter(Boolean);
}

function renderAnchor(model, lines) {
  const anchor = objectOrNull(model?.anchor);
  if (!anchor?.kind) return;
  lines.push(`- anchor: ${formatAnchorParts(anchor).join(' | ')}`);
  const alternates = asArray(anchor.alternates);
  if (alternates.length) {
    lines.push(`- alternate anchors: ${alternates.map((entry) => `${entry.kind}:${entry.chunkUid || 'unknown'}`).join(', ')}`);
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
  const lines = ['Primary'];
  if (!primary) {
    lines.push('- (missing)');
    return lines;
  }
  const range = primary.range?.startLine != null && primary.range?.endLine != null
    ? `[${primary.range.startLine}-${primary.range.endLine}]`
    : '';
  lines.push(`File: ${primary.file || 'unknown'}${range ? `:${range}` : ''}`);
  if (primary.excerpt) {
    lines.push('', 'Excerpt:', primary.excerpt);
  }
  appendPrimaryProvenance(lines, primary.provenance);
  return lines;
}

function appendPrimaryProvenance(lines, provenanceValue) {
  const provenance = objectOrNull(provenanceValue);
  if (!provenance) return;
  const parts = [
    provenance.excerptSource ? `source=${provenance.excerptSource}` : null,
    provenance.excerptHash ? `hash=${provenance.excerptHash}` : null,
    provenance.excerptBytes != null ? `bytes=${provenance.excerptBytes}` : null
  ].filter(Boolean);
  if (parts.length) lines.push('', `Provenance: ${parts.join(', ')}`);
}

function renderTypes(types) {
  const facts = asArray(types?.facts);
  const lines = ['Types'];
  if (!facts.length) {
    lines.push('- (none)');
    return lines;
  }
  lines.push(...facts.map((fact) => `- ${fact.role}: ${fact.type}`));
  return lines;
}

function formatGraphNode(node) {
  const parts = [node?.name, node?.kind, node?.file].filter(Boolean);
  return `${formatRef(node?.ref)}${parts.length ? ` (${parts.join(', ')})` : ''}`;
}

function renderGraphContextPack(pack) {
  if (!pack || typeof pack !== 'object') return '';
  const lines = ['# Graph Context Pack', '', '## Seed', `- ${formatRef(pack.seed)}`, '', '## Nodes'];
  const nodes = asArray(pack.nodes);
  if (!nodes.length) {
    lines.push('- (none)');
  } else {
    for (const node of nodes) {
      const distance = Number.isFinite(node?.distance) ? node.distance : 0;
      lines.push(`- [${distance}] ${formatGraphNode(node)}`);
    }
  }
  const edges = asArray(pack.edges);
  lines.push('', '## Edges');
  if (!edges.length) {
    lines.push('- (none)');
  } else {
    for (const edge of edges) {
      const graph = edge?.graph ? `, ${edge.graph}` : '';
      lines.push(`- ${formatRef(edge?.from)} -> ${formatRef(edge?.to)} (${edge?.edgeType || 'edge'}${graph})`);
    }
  }
  const paths = asArray(pack.paths);
  if (paths.length) {
    lines.push('', '## Witness Paths');
    for (const pathValue of paths) {
      const nodesText = asArray(pathValue?.nodes).map(formatRef).join(' -> ');
      lines.push(`- ${formatRef(pathValue?.to)} (${pathValue?.distance ?? 0}): ${nodesText}`);
    }
  }
  appendWarningList(lines, pack.warnings, '## Warnings');
  lines.push('');
  return lines.join('\n');
}

function appendWarningList(lines, warnings, heading) {
  const list = asArray(warnings);
  if (!list.length) return;
  lines.push('', heading);
  for (const warning of list) {
    lines.push(`- ${warning.code}: ${warning.message}`);
  }
}

function renderRisk(risk) {
  const lines = ['Risk'];
  if (!risk) {
    lines.push('- (none)');
    return lines.join('\n');
  }
  if (risk?.anchor?.kind) {
    lines.push(`- anchor: ${formatAnchorParts(risk.anchor).join(' | ')}`);
  }
  lines.push('');
  lines.push(renderRiskExplanation(buildRiskExplanationModelFromRiskSlice(risk), {
    title: null,
    includeSubject: false,
    includeAnchor: false,
    includeFilters: false,
    maxFlows: 5
  }));
  return lines.join('\n');
}

/*
 * The remaining context-pack sections are extension-local because this module is
 * shipped as CommonJS inside the VSIX and cannot synchronously import the ESM
 * core renderer.
 */
function renderListSection(title, items, renderItem) {
  const list = asArray(items);
  if (!list.length) return `${title}\n- (none)`;
  return [title, ...list.map(renderItem)].join('\n');
}

function renderTruncationSection(payload) {
  return renderListSection(
    'Truncation',
    payload?.truncation,
    (entry) => [
      `- ${entry?.cap || 'unknown'}`,
      entry?.limit != null ? `limit=${entry.limit}` : null,
      entry?.observed != null ? `observed=${entry.observed}` : null,
      entry?.omitted != null ? `omitted=${entry.omitted}` : null
    ].filter(Boolean).join(' ')
  );
}

function renderWarningsSection(payload) {
  return renderListSection(
    'Warnings',
    payload?.warnings,
    (entry) => `- ${entry?.code || 'warning'}: ${entry?.message || 'warning emitted'}`
  );
}

const COMPOSITE_SECTION_RENDERERS = Object.freeze([
  (payload) => renderPrimary(payload?.primary).join('\n'),
  (payload) => (payload?.graph ? renderGraphContextPack(payload.graph) : ''),
  (payload) => (payload?.types ? renderTypes(payload.types).join('\n') : ''),
  (payload) => (payload?.risk ? renderRisk(payload.risk) : ''),
  renderTruncationSection,
  renderWarningsSection
]);

function renderCompositeContextPack(payload) {
  return COMPOSITE_SECTION_RENDERERS
    .map((renderSection) => renderSection(payload))
    .filter(Boolean)
    .join('\n\n');
}

module.exports = {
  buildRiskExplanationModelFromRiskSlice,
  buildRiskExplanationModelFromStandalone,
  renderCompositeContextPack,
  renderRiskExplain,
  renderRiskExplanation
};
