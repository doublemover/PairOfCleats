const formatWitnessPath = (witnessPath) => {
  if (!witnessPath || !Array.isArray(witnessPath.nodes)) return null;
  const nodes = witnessPath.nodes.map((node) => node?.path || node?.chunkUid || node?.symbolId || 'unknown');
  if (!nodes.length) return null;
  return nodes.join(' -> ');
};

const formatTruncation = (record) => {
  if (!record) return '';
  const pieces = [`${record.cap}`];
  if (record.limit != null) pieces.push(`limit=${JSON.stringify(record.limit)}`);
  if (record.observed != null) pieces.push(`observed=${JSON.stringify(record.observed)}`);
  if (record.omitted != null) pieces.push(`omitted=${JSON.stringify(record.omitted)}`);
  return pieces.join(' ');
};

export const renderSuggestTestsReport = (report) => {
  const lines = [];
  lines.push('Suggested Tests');
  const suggestions = Array.isArray(report?.suggestions) ? report.suggestions.slice() : [];
  suggestions.sort((a, b) => {
    const scoreCompare = (Number.isFinite(b?.score) ? b.score : -Infinity)
      - (Number.isFinite(a?.score) ? a.score : -Infinity);
    if (scoreCompare !== 0) return scoreCompare;
    return String(a?.testPath || '').localeCompare(String(b?.testPath || ''));
  });
  if (!suggestions.length) {
    lines.push('- (none)');
  } else {
    for (const suggestion of suggestions) {
      const score = Number.isFinite(suggestion.score) ? suggestion.score.toFixed(3) : 'n/a';
      lines.push(`- ${suggestion.testPath} (score: ${score})`);
      lines.push(`  reason: ${suggestion.reason}`);
      const witness = formatWitnessPath(suggestion.witnessPath);
      if (witness) {
        lines.push(`  witness: ${witness}`);
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
