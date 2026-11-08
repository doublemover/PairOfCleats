import { ARCHITECTURE_REPORT_VERSION } from '../../contracts/architecture-evidence.js';
import { compareStrings } from '../../shared/sort.js';
import { appendReportFooterSections } from './report-sections.js';
import { stripVTControlCharacters } from 'node:util';

const safe = value => stripVTControlCharacters(String(value ?? ''))
  .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu,
    char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);

const formatNodeRef = (ref) => {
  if (!ref || typeof ref !== 'object') return 'unknown';
  if (ref.type === 'file' && ref.path) return ref.path;
  if (ref.type === 'chunk' && ref.chunkUid) return `chunk:${ref.chunkUid}`;
  if (ref.type === 'symbol' && ref.symbolId) return `symbol:${ref.symbolId}`;
  return 'unknown';
};
const formatEndpoint = (ref, detail) => {
  const identity = formatNodeRef(ref);
  if (!detail?.path) return safe(identity);
  const label = detail.label ? ` (${safe(detail.label)}${detail.labelTruncated ? '…' : ''})` : '';
  return `${safe(detail.path)}${label}${identity === detail.path ? '' : ` [${safe(identity)}]`}`;
};

export const renderArchitectureReport = (report) => {
  if (report?.version !== ARCHITECTURE_REPORT_VERSION) throw Object.assign(new Error(
    'Architecture report version is unsupported; regenerate it with the current evaluator.'), { code: 'ERR_ARCHITECTURE_REPORT_VERSION' });
  const lines = [];
  lines.push('Architecture Report');
  lines.push(`Policy: sha256:${safe(report.policy.digest)}; ${safe(report.policy.normalization)}; layers: ${safe(report.policy.layerSelection)}.`);
  lines.push(`Evaluation: ${report.summary.complete ? 'complete' : 'incomplete'}; `
    + `${report.summary.detectedViolations} detected, ${report.summary.retainedViolations} retained, `
    + `${report.summary.omittedViolations} omitted; ${report.summary.edgesExamined} edges examined.`);
  const rules = report.rules.slice();
  rules.sort((a, b) => compareStrings(a?.id, b?.id) || compareStrings(a?.type, b?.type));
  lines.push('Rules:');
  if (!rules.length) {
    lines.push('- (none)');
  } else {
    for (const rule of rules) {
      const severity = rule.severity ? ` (${safe(rule.severity)})` : '';
      const violations = Number(rule?.summary?.violations || 0);
      lines.push(`- ${safe(rule.id)} [${safe(rule.type)}]${severity}: ${violations} violation(s)`);
    }
  }
  const violations = report.violations.slice();
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
      const details = violation.evidence.details;
      const from = formatEndpoint(edge.from, details.from);
      const to = formatEndpoint(edge.to, details.to);
      lines.push(`- ${safe(violation.ruleId)}: ${safe(edge.edgeType)} ${from} -> ${to}`);
      if (details.layers) lines.push(`  layers: ${safe(details.layers.fromName)} (#${details.layers.fromOrdinal}) -> `
        + `${safe(details.layers.toName)} (#${details.layers.toOrdinal}); first matching layer in policy order.`);
      lines.push(`  evidence: ${safe(details.edgeId)}; policy rule #${details.ruleIndex}; ${safe(details.availability)}.`);
      if (violation.evidence?.note) {
        lines.push(`  note: ${safe(violation.evidence.note)}`);
      }
    }
  }

  appendReportFooterSections(lines, report);
  return lines.join('\n');
};
