const formatNodeRef = (ref) => {
  if (!ref || typeof ref !== 'object') return 'unknown';
  if (ref.type === 'file' && ref.path) return ref.path;
  if (ref.type === 'chunk' && ref.chunkUid) return `chunk:${ref.chunkUid}`;
  if (ref.type === 'symbol' && ref.symbolId) return `symbol:${ref.symbolId}`;
  return 'unknown';
};

export const renderArchitectureReport = (report) => {
  const lines = [];
  lines.push('Architecture Report');
  const rules = Array.isArray(report?.rules) ? report.rules : [];
  lines.push('Rules:');
  if (!rules.length) {
    lines.push('- (none)');
  } else {
    for (const rule of rules) {
      const severity = rule.severity ? ` (${rule.severity})` : '';
      const violations = Number(rule?.summary?.violations || 0);
      lines.push(`- ${rule.id} [${rule.type}]${severity}: ${violations} violation(s)`);
    }
  }
  const violations = Array.isArray(report?.violations) ? report.violations : [];
  lines.push('Violations:');
  if (!violations.length) {
    lines.push('- (none)');
  } else {
    for (const violation of violations) {
      const edge = violation.edge || {};
      const from = formatNodeRef(edge.from);
      const to = formatNodeRef(edge.to);
      lines.push(`- ${violation.ruleId}: ${edge.edgeType} ${from} -> ${to}`);
      if (violation.evidence?.note) {
        lines.push(`  note: ${violation.evidence.note}`);
      }
    }
  }
  return lines.join('\n');
};
