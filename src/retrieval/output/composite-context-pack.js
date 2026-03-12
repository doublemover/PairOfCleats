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
  const analysisStatus = risk?.analysisStatus || null;
  if (analysisStatus?.artifactStatus) {
    const parts = Object.entries(analysisStatus.artifactStatus)
      .filter(([, value]) => typeof value === 'string' && value)
      .map(([key, value]) => `${key}=${value}`);
    if (parts.length) lines.push(`- artifacts: ${parts.join(', ')}`);
  }
  if (Array.isArray(analysisStatus?.degradedReasons) && analysisStatus.degradedReasons.length) {
    lines.push(`- degraded reasons: ${analysisStatus.degradedReasons.join(', ')}`);
  }
  const totals = risk?.summary?.totals || null;
  if (totals) {
    lines.push(`- summary: sources ${totals.sources || 0}, sinks ${totals.sinks || 0}, sanitizers ${totals.sanitizers || 0}, localFlows ${totals.localFlows || 0}`);
  }
  if (Array.isArray(risk?.summary?.topCategories) && risk.summary.topCategories.length) {
    lines.push(`- top categories: ${risk.summary.topCategories.slice(0, 3).map((entry) => `${entry.category} (${entry.count})`).join(', ')}`);
  }
  if (Array.isArray(risk?.summary?.topTags) && risk.summary.topTags.length) {
    lines.push(`- top tags: ${risk.summary.topTags.slice(0, 3).map((entry) => `${entry.tag} (${entry.count})`).join(', ')}`);
  }
  const stats = risk?.stats || null;
  if (stats) {
    const extras = [];
    if (stats.flowsEmitted != null) extras.push(`flows ${stats.flowsEmitted}`);
    if (stats.summariesEmitted != null) extras.push(`summaries ${stats.summariesEmitted}`);
    if (stats.uniqueCallSitesReferenced != null) extras.push(`call sites ${stats.uniqueCallSitesReferenced}`);
    if (Array.isArray(stats.capsHit) && stats.capsHit.length) extras.push(`caps ${stats.capsHit.join(', ')}`);
    if (extras.length) lines.push(`- interprocedural: ${extras.join(', ')}`);
  }
  if (risk?.caps) {
    const capParts = [];
    if (risk.caps.maxFlows != null) capParts.push(`maxFlows ${risk.caps.maxFlows}`);
    if (risk.caps.maxCallSitesPerStep != null) capParts.push(`maxCallSitesPerStep ${risk.caps.maxCallSitesPerStep}`);
    if (capParts.length) lines.push(`- pack caps: ${capParts.join(', ')}`);
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
