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
  if (!pathValue || !Array.isArray(pathValue.nodes)) return '';
  return pathValue.nodes.map(formatRef).join(' -> ');
}

function renderRiskExplain(flows, { maxFlows = 3, maxEvidencePerFlow = 3 } = {}) {
  const lines = [];
  lines.push('Risk Flows');
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
    const callSiteSteps = Array.isArray(flow?.path?.callSiteIdsByStep)
      ? flow.path.callSiteIdsByStep
      : [];
    if (callSiteSteps.length) {
      const limitedSteps = callSiteSteps.slice(0, maxEvidencePerFlow);
      for (let i = 0; i < limitedSteps.length; i += 1) {
        const ids = limitedSteps[i] || [];
        if (!ids.length) continue;
        lines.push(`  step ${i + 1}: ${ids.join(', ')}`);
      }
    }
  }
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
  if (risk.status) {
    lines.push(`- status: ${risk.status}${risk.reason ? ` (${risk.reason})` : ''}`);
  }
  if (risk?.anchor?.kind) {
    const anchorParts = [risk.anchor.kind];
    if (risk.anchor.chunkUid) anchorParts.push(risk.anchor.chunkUid);
    if (risk.anchor.flowId) anchorParts.push(`flow ${risk.anchor.flowId}`);
    lines.push(`- anchor: ${anchorParts.join(' | ')}`);
  }
  const totals = risk?.summary?.totals || null;
  if (totals) {
    lines.push(`- summary: sources ${totals.sources || 0}, sinks ${totals.sinks || 0}, sanitizers ${totals.sanitizers || 0}, localFlows ${totals.localFlows || 0}`);
  }
  lines.push('');
  lines.push(renderRiskExplain(risk.flows || [], { maxFlows: 5 }));
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
  renderCompositeContextPack,
  renderRiskExplain
};
