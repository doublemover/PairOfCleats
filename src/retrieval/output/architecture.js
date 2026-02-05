import { compareStrings } from '../../shared/sort.js';

const formatNodeRef = (ref) => {
  if (!ref || typeof ref !== 'object') return 'unknown';
  if (ref.type === 'file' && ref.path) return ref.path;
  if (ref.type === 'chunk' && ref.chunkUid) return `chunk:${ref.chunkUid}`;
  if (ref.type === 'symbol' && ref.symbolId) return `symbol:${ref.symbolId}`;
  return 'unknown';
};

const formatTruncation = (record) => {
  if (!record) return '';
  const pieces = [`${record.cap}`];
  if (record.limit != null) pieces.push(`limit=${JSON.stringify(record.limit)}`);
  if (record.observed != null) pieces.push(`observed=${JSON.stringify(record.observed)}`);
  if (record.omitted != null) pieces.push(`omitted=${JSON.stringify(record.omitted)}`);
  return pieces.join(' ');
};

export const renderArchitectureReport = (report) => {
  const lines = [];
  lines.push('Architecture Report');
  const rules = Array.isArray(report?.rules) ? report.rules.slice() : [];
  rules.sort((a, b) => compareStrings(a?.id, b?.id) || compareStrings(a?.type, b?.type));
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
  const violations = Array.isArray(report?.violations) ? report.violations.slice() : [];
  violations.sort((a, b) => {
    const ruleCompare = compareStrings(a?.ruleId, b?.ruleId);
    if (ruleCompare !== 0) return ruleCompare;
    const edgeTypeCompare = compareStrings(a?.edge?.edgeType, b?.edge?.edgeType);
    if (edgeTypeCompare !== 0) return edgeTypeCompare;
    const fromCompare = compareStrings(formatNodeRef(a?.edge?.from), formatNodeRef(b?.edge?.from));
    if (fromCompare !== 0) return fromCompare;
    return compareStrings(formatNodeRef(a?.edge?.to), formatNodeRef(b?.edge?.to));
  });
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

  const truncation = Array.isArray(report?.truncation) ? report.truncation : [];
  if (truncation.length) {
    lines.push('Truncation:');
    for (const record of truncation) {
      lines.push(`- ${formatTruncation(record)}`);
    }
  }

  const warnings = Array.isArray(report?.warnings) ? report.warnings : [];
  if (warnings.length) {
    lines.push('Warnings:');
    for (const warning of warnings) {
      const prefix = warning?.code ? `${warning.code}: ` : '';
      lines.push(`- ${prefix}${warning?.message || ''}`.trim());
    }
  }
  return lines.join('\n');
};
