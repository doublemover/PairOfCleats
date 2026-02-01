const formatSymbolLabel = (symbol) => {
  if (!symbol) return 'unknown';
  const name = symbol.name || symbol.symbolId || 'symbol';
  const file = symbol.file ? ` (${symbol.file})` : '';
  return `${name}${file}`;
};

export const renderApiContracts = (report) => {
  const lines = [];
  lines.push('API Contracts');
  const symbols = Array.isArray(report?.symbols) ? report.symbols : [];
  if (!symbols.length) {
    lines.push('- (none)');
    return lines.join('\n');
  }
  for (const entry of symbols) {
    lines.push(`- ${formatSymbolLabel(entry.symbol)}`);
    const signature = entry.signature?.declared || null;
    if (signature) {
      lines.push(`  signature: ${signature}`);
    }
    const calls = Array.isArray(entry.observedCalls) ? entry.observedCalls : [];
    if (calls.length) {
      lines.push(`  calls: ${calls.length}`);
      for (const call of calls.slice(0, 3)) {
        const arity = Number.isFinite(call.arity) ? call.arity : 'n/a';
        lines.push(`    - arity ${arity} @ ${call.file || 'unknown'}`);
      }
    }
    const warnings = Array.isArray(entry.warnings) ? entry.warnings : [];
    if (warnings.length) {
      lines.push(`  warnings: ${warnings.length}`);
    }
  }
  return lines.join('\n');
};
