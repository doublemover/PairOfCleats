export const sumDiagnosticCounts = (entry, key = 'countsByType') => {
  const sources = [
    entry?.diagnostics?.process?.[key],
    entry?.diagnostics?.[key]
  ];
  const out = {};
  for (const source of sources) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) continue;
    for (const [diagnosticKey, value] of Object.entries(source)) {
      const count = Number(value);
      if (!Number.isFinite(count) || count <= 0) continue;
      out[diagnosticKey] = (out[diagnosticKey] || 0) + count;
    }
  }
  return out;
};
