export const riskSummaryCoverage = (risk, row, { dropped = false } = {}) => {
  const rawLocal = risk?.analysisStatus;
  const local = rawLocal ? { status: String(rawLocal.status || 'unknown').slice(0, 64),
    reason: rawLocal.reason == null ? null : String(rawLocal.reason).slice(0, 512),
    caps: Object.fromEntries(['maxBytes', 'maxLines', 'maxNodes', 'maxEdges', 'maxMs', 'maxFlows'].map(key =>
      [key, Number.isFinite(rawLocal.caps?.[key]) ? rawLocal.caps[key] : null])),
    bytes: Number.isFinite(rawLocal.bytes) ? rawLocal.bytes : null,
    lines: Number.isFinite(rawLocal.lines) ? rawLocal.lines : null } : null;
  const losses = {};
  const groups = { sources: risk?.sources, sinks: risk?.sinks, sanitizers: risk?.sanitizers, localFlows: risk?.flows };
  for (const [kind, entries] of Object.entries(groups)) {
    const original = Array.isArray(entries) ? entries : [];
    const retained = dropped ? [] : row.signals[kind];
    const count = original.length - retained.length;
    if (count > 0) losses[kind] = count;
    for (const field of ['evidence', 'tags']) {
      const before = original.reduce((sum, entry) => sum + (Array.isArray(entry?.[field]) ? entry[field].length : entry?.[field] ? 1 : 0), 0);
      const after = retained.reduce((sum, entry) => sum + (Array.isArray(entry?.[field]) ? entry[field].length : 0), 0);
      if (before > after) losses[field] = (losses[field] || 0) + before - after;
    }
  }
  const beforeTaint = new Set((risk?.taintHints?.taintedIdentifiers || []).map(String)).size;
  const afterTaint = dropped ? 0 : row.taintHints?.taintedIdentifiers?.length || 0;
  if (beforeTaint > afterTaint) losses.taintIdentifiers = beforeTaint - afterTaint;
  if (dropped) losses.rows = 1;
  const reasons = [...new Set([...(local?.status === 'ok' ? [] : String(local?.reason || 'unknown-local-analysis').split('|')),
    ...Object.keys(losses).map(key => `summary:${key}`)])].sort();
  return { version: 1, status: !local || local.status === 'unknown' ? 'unknown' : reasons.length ? 'partial' : 'complete',
    localAnalysis: local || { status: 'unknown', reason: 'No local admission/completion evidence.' },
    losses, reasons };
};

export const aggregateRiskInputCoverage = (rows, summaryStats = null) => {
  const observations = rows.map(row => row.inputCoverage || { status: 'unknown', reasons: ['unknown-local-analysis'], losses: {} });
  const reasons = new Set(observations.flatMap(row => row.reasons || []));
  const droppedRows = Number.isSafeInteger(summaryStats?.summariesDroppedBySize) ? summaryStats.summariesDroppedBySize : 0;
  if (droppedRows) reasons.add('summary:rows');
  const losses = {};
  for (const row of observations) for (const [key, count] of Object.entries(row.losses || {})) losses[key] = (losses[key] || 0) + count;
  if (droppedRows) losses.rows = droppedRows;
  const unknownChunks = observations.filter(row => row.status === 'unknown').length + (summaryStats?.missingLocalAnalysis || 0);
  if (unknownChunks) reasons.add('unknown-local-analysis');
  return { version: 1, scope: 'all-admitted-chunks; requested-slice completeness is not established',
    status: unknownChunks ? 'unknown' : reasons.size ? 'partial' : 'complete',
    chunksObserved: observations.length, unknownChunks, droppedRows, losses,
    reasons: [...reasons].sort(), droppedChunks: summaryStats?.droppedChunks || [],
    droppedChunkWitnessesOmitted: Math.max(0, droppedRows - (summaryStats?.droppedChunks?.length || 0)) };
};
