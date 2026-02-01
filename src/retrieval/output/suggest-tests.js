const formatWitnessPath = (witnessPath) => {
  if (!witnessPath || !Array.isArray(witnessPath.nodes)) return null;
  const nodes = witnessPath.nodes.map((node) => node?.path || node?.chunkUid || node?.symbolId || 'unknown');
  if (!nodes.length) return null;
  return nodes.join(' -> ');
};

export const renderSuggestTestsReport = (report) => {
  const lines = [];
  lines.push('Suggested Tests');
  const suggestions = Array.isArray(report?.suggestions) ? report.suggestions : [];
  if (!suggestions.length) {
    lines.push('- (none)');
    return lines.join('\n');
  }
  for (const suggestion of suggestions) {
    const score = Number.isFinite(suggestion.score) ? suggestion.score.toFixed(3) : 'n/a';
    lines.push(`- ${suggestion.testPath} (score: ${score})`);
    lines.push(`  reason: ${suggestion.reason}`);
    const witness = formatWitnessPath(suggestion.witnessPath);
    if (witness) {
      lines.push(`  witness: ${witness}`);
    }
  }
  return lines.join('\n');
};
