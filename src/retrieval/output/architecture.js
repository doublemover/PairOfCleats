import { compareStrings } from '../../shared/sort.js';
import { appendReportFooterSections } from './report-sections.js';

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

  appendReportFooterSections(lines, report);
  return lines.join('\n');
};
