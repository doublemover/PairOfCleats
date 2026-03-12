import { buildRiskExplanationModelFromRiskSlice, renderRiskExplanation, renderRiskExplanationJson } from './risk-explain.js';
import { renderGraphContextPack } from './graph-context-pack.js';
import { renderCompositeContextPackSarif } from './risk-sarif.js';

const CONTEXT_PACK_MAX_RISK_FLOWS = 5;
const CONTEXT_PACK_MAX_RISK_PARTIAL_FLOWS = 5;
const CONTEXT_PACK_MAX_RISK_EVIDENCE = 3;

const renderPrimary = (primary) => {
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
  const provenance = primary?.provenance && typeof primary.provenance === 'object' ? primary.provenance : null;
  if (provenance) {
    const parts = [];
    if (provenance.excerptSource) parts.push(`source=${provenance.excerptSource}`);
    if (provenance.excerptHash) parts.push(`hash=${provenance.excerptHash}`);
    if (provenance.excerptBytes != null) parts.push(`bytes=${provenance.excerptBytes}`);
    if (parts.length) {
      lines.push('');
      lines.push(`Provenance: ${parts.join(', ')}`);
    }
  }
  return lines;
};

const renderTypes = (types) => {
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
};

const renderRisk = (risk) => {
  if (!risk) {
    return 'Risk\n- (none)';
  }
  const model = buildRiskExplanationModelFromRiskSlice(risk);
  return renderRiskExplanation(model, {
    title: 'Risk',
    includeSubject: false,
    includeAnchor: false,
    includeFilters: true,
    maxFlows: CONTEXT_PACK_MAX_RISK_FLOWS,
    maxPartialFlows: CONTEXT_PACK_MAX_RISK_PARTIAL_FLOWS,
    maxEvidencePerFlow: CONTEXT_PACK_MAX_RISK_EVIDENCE
  });
};

const renderListSection = (title, items, renderItem) => {
  const lines = [title];
  const list = Array.isArray(items) ? items : [];
  if (!list.length) {
    lines.push('- (none)');
    return lines.join('\n');
  }
  for (const item of list) {
    lines.push(renderItem(item));
  }
  return lines.join('\n');
};

const renderTruncation = (payload) => renderListSection(
  'Truncation',
  payload?.truncation,
  (entry) => {
    const pieces = [`- ${entry?.cap || 'unknown'}`];
    if (entry?.limit != null) pieces.push(`limit=${entry.limit}`);
    if (entry?.observed != null) pieces.push(`observed=${entry.observed}`);
    if (entry?.omitted != null) pieces.push(`omitted=${entry.omitted}`);
    return pieces.join(' ');
  }
);

const renderWarnings = (payload) => renderListSection(
  'Warnings',
  payload?.warnings,
  (entry) => `- ${entry?.code || 'warning'}: ${entry?.message || 'warning emitted'}`
);

export const renderCompositeContextPackJson = (payload) => ({
  ...payload,
  rendered: {
    risk: payload?.risk
      ? renderRiskExplanationJson(buildRiskExplanationModelFromRiskSlice(payload.risk), {
        title: 'Risk',
        maxFlows: CONTEXT_PACK_MAX_RISK_FLOWS,
        maxPartialFlows: CONTEXT_PACK_MAX_RISK_PARTIAL_FLOWS,
        maxEvidencePerFlow: CONTEXT_PACK_MAX_RISK_EVIDENCE
      })
      : null,
    sarif: renderCompositeContextPackSarif(payload, {
      maxFlows: CONTEXT_PACK_MAX_RISK_FLOWS,
      maxPartialFlows: CONTEXT_PACK_MAX_RISK_PARTIAL_FLOWS,
      maxEvidencePerFlow: CONTEXT_PACK_MAX_RISK_EVIDENCE
    }),
    truncation: Array.isArray(payload?.truncation) ? payload.truncation.slice() : [],
    warnings: Array.isArray(payload?.warnings) ? payload.warnings.slice() : []
  }
});

export const renderCompositeContextPack = (payload) => {
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
  sections.push(renderTruncation(payload));
  sections.push(renderWarnings(payload));
  return sections.filter(Boolean).join('\n\n');
};
