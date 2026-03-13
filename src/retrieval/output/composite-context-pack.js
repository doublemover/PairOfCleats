import {
  buildRiskExplanationPresentationFromRiskSlice,
  getRiskExplanationSurfaceOptions
} from './risk-explain.js';
import { renderGraphContextPack } from './graph-context-pack.js';
import { renderCompositeContextPackSarif } from './risk-sarif.js';

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

const resolveRiskSubject = (payload) => {
  const risk = payload?.risk && typeof payload.risk === 'object' ? payload.risk : null;
  const primary = payload?.primary && typeof payload.primary === 'object' ? payload.primary : null;
  const ref = primary?.ref && typeof primary.ref === 'object' ? primary.ref : null;
  const summary = risk?.summary && typeof risk.summary === 'object' ? risk.summary : null;
  const symbol = summary?.symbol && typeof summary.symbol === 'object' ? summary.symbol : null;
  const chunkUid = ref?.type === 'chunk'
    ? ref.chunkUid || summary?.chunkUid || null
    : summary?.chunkUid || null;
  const file = primary?.file || summary?.file || null;
  const name = symbol?.name || null;
  const kind = symbol?.kind || null;
  if (!chunkUid && !file && !name && !kind) {
    return null;
  }
  return {
    chunkUid,
    file,
    name,
    kind
  };
};

const buildContextPackRiskPresentation = (payload) => {
  if (!payload?.risk) {
    return null;
  }
  return buildRiskExplanationPresentationFromRiskSlice(
    payload.risk,
    {
      surface: 'contextPack',
      subject: resolveRiskSubject(payload)
    }
  );
};

const renderRisk = (payload) => {
  const presentation = buildContextPackRiskPresentation(payload);
  if (!presentation) {
    return 'Risk\n- (none)';
  }
  return presentation.markdown;
};

const renderRiskJson = (payload) => {
  const presentation = buildContextPackRiskPresentation(payload);
  return presentation?.json || null;
};

const renderRiskSarif = (payload) => {
  const options = getRiskExplanationSurfaceOptions('contextPack');
  return renderCompositeContextPackSarif(payload, options);
};

const renderRiskSection = (payload) => {
  if (!payload?.risk) {
    return 'Risk\n- (none)';
  }
  return renderRisk(payload);
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
    risk: renderRiskJson(payload),
    sarif: renderRiskSarif(payload),
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
    sections.push(renderRiskSection(payload));
  }
  sections.push(renderTruncation(payload));
  sections.push(renderWarnings(payload));
  return sections.filter(Boolean).join('\n\n');
};
