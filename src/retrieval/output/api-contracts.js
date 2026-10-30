import { displayApiValue, formatApiCallLocation, projectApiContractDiagnostics } from './api-contract-diagnostics.js';

const formatSymbolLabel = (symbol) => {
  if (!symbol) return 'unknown';
  const name = displayApiValue(symbol.name || symbol.symbolId || 'symbol');
  const file = symbol.file ? ` (${displayApiValue(symbol.file)})` : '';
  return `${name}${file}`;
};

export const renderApiContracts = (report) => {
  const lines = [];
  lines.push('API Contracts');
  lines.push(`Generation: ${displayApiValue(report?.provenance?.indexSignature)}`);
  const evidence = report?.callEvidence;
  if (evidence) {
    lines.push(`Recorded target calls: ${evidence.qualifiedCallCount}; reported: ${evidence.reportedCallCount}; omitted by selection/caps: ${evidence.omittedQualifiedCallCount}`);
    lines.push(`Unresolved calls: ${evidence.unresolvedCallCount}; details: ${evidence.unresolvedDetails}`);
    for (const [reason, count] of Object.entries(evidence.unresolvedByReason || {})) if (count) lines.push(`  ${reason}: ${count}`);
  }
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
  const diagnostics = projectApiContractDiagnostics(report);
  lines.push(`Retained warning identities: ${diagnostics.total}; human details shown: ${diagnostics.details.length}; omitted from human output: ${diagnostics.omitted}`);
  for (const diagnostic of diagnostics.details) {
    lines.push(`- [${diagnostic.code}] ${diagnostic.message}`);
    lines.push(`  symbol ${diagnostic.symbolId}; call ${diagnostic.callSiteId}; ${diagnostic.location}`);
    lines.push(`  target ${diagnostic.target}; join ${diagnostic.qualification}; generation ${diagnostic.generation}`);
  }
  if (!symbols.length) {
    lines.push('- (none)');
    return lines.join('\n');
  }
  if (symbols.length > 100) lines.push(`Symbols shown: 100 of ${symbols.length}; omitted from human output: ${symbols.length - 100}`);
  for (const entry of symbols.slice(0, 100)) {
    lines.push(`- ${formatSymbolLabel(entry.symbol)}`);
    const signature = entry.signature?.declared || null;
    if (signature) {
      lines.push(`  signature: ${displayApiValue(signature)}`);
    }
    const parameters = entry.signature?.parameters;
    if (parameters) lines.push(`  parameters: ${displayApiValue(parameters.source)}; ${displayApiValue(parameters.state)}; `
      + `${displayApiValue(parameters.language)}; ${displayApiValue(parameters.reason)}`);
    const calls = Array.isArray(entry.observedCalls) ? entry.observedCalls : [];
    if (calls.length) {
      lines.push(`  calls: ${calls.length}`);
      for (const call of calls.slice(0, 3)) {
        const bounds = call.arguments?.arity;
        const arity = Number.isFinite(call.arity) ? call.arity : bounds?.state === 'bounded'
          ? `${bounds.min}-${bounds.max ?? 'unbounded'} (bounded)` : 'unavailable';
        const target = call.join ? ` -> ${displayApiValue(call.join.symbolId)} [${displayApiValue(call.targetChunkUid)}; ${displayApiValue(call.join.qualification)}]` : '';
        lines.push(`    - arity ${arity} @ ${formatApiCallLocation(call)}${target}; call ${displayApiValue(call.callSiteId)}; generation ${displayApiValue(call.join?.indexSignature)}`);
      }
      if (calls.length > 3) lines.push(`    ${calls.length - 3} retained call(s) omitted from this preview; warning details use all retained calls.`);
    }
    const warnings = Array.isArray(entry.warnings) ? entry.warnings : [];
    if (warnings.length) {
      lines.push(`  warnings: ${warnings.length}`);
    }
  }
  return lines.join('\n');
};
