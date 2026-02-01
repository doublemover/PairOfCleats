const formatNodeRef = (ref) => {
  if (!ref || typeof ref !== 'object') return 'unknown';
  if (ref.type === 'chunk') return `chunk:${ref.chunkUid}`;
  if (ref.type === 'symbol') return `symbol:${ref.symbolId}`;
  if (ref.type === 'file') return `file:${ref.path}`;
  return 'unknown';
};

const formatPath = (path) => {
  if (!path || !Array.isArray(path.nodes)) return '';
  return path.nodes.map(formatNodeRef).join(' -> ');
};

export const renderRiskExplain = (flows, { maxFlows = 3, maxEvidencePerFlow = 3 } = {}) => {
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
    const path = formatPath(flow?.path);
    if (path) {
      lines.push(`  path: ${path}`);
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
};
