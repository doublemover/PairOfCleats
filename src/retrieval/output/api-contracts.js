const formatSymbolLabel = (symbol) => {
  if (!symbol) return 'unknown';
  const name = symbol.name || symbol.symbolId || 'symbol';
  const file = symbol.file ? ` (${symbol.file})` : '';
  return `${name}${file}`;
};

export const renderApiContracts = (report) => {
  const lines = [];
  lines.push('API Contracts');
  const warningCap = Array.isArray(report?.truncation)
    ? report.truncation.find(entry => entry.cap === 'maxWarnings') : null;
  if (warningCap) {
    const retained = Array.isArray(report?.warnings) ? report.warnings.length : 0;
    const { observed, omitted } = warningCap;
    if (Number.isSafeInteger(observed) && Number.isSafeInteger(omitted)
      && omitted >= 0 && observed === retained + omitted) {
      lines.push(`Warnings detected: ${observed}; details retained: ${retained}; omitted: ${omitted}`);
    } else {
      lines.push('Warning details capped; actual omission count is unreported or inconsistent.');
    }
  }
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
