import { renderGraphContextPack } from './graph-context-pack.js';
import { renderRiskExplain } from './risk-explain.js';

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
  const lines = [];
  lines.push('Risk');
  if (!risk) {
    lines.push('- (none)');
    return lines.join('\n');
  }
  if (risk.status) {
    lines.push(`- status: ${risk.status}${risk.reason ? ` (${risk.reason})` : ''}`);
  }
  const totals = risk?.summary?.totals || null;
  if (totals) {
    lines.push(`- summary: sources ${totals.sources || 0}, sinks ${totals.sinks || 0}, sanitizers ${totals.sanitizers || 0}, localFlows ${totals.localFlows || 0}`);
  }
  const stats = risk?.stats || null;
  if (stats) {
    const extras = [];
    if (stats.flowsEmitted != null) extras.push(`flows ${stats.flowsEmitted}`);
    if (stats.uniqueCallSitesReferenced != null) extras.push(`call sites ${stats.uniqueCallSitesReferenced}`);
    if (Array.isArray(stats.capsHit) && stats.capsHit.length) extras.push(`caps ${stats.capsHit.join(', ')}`);
    if (extras.length) lines.push(`- interprocedural: ${extras.join(', ')}`);
  }
  lines.push('');
  lines.push(renderRiskExplain(risk.flows || [], { maxFlows: 5 }));
  return lines.join('\n');
};

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
  return sections.filter(Boolean).join('\n\n');
};
