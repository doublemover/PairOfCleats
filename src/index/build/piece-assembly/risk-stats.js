import { stableStringify } from '../../../shared/stable-json.js';

/** Independent pieces do not establish cross-piece analysis completeness.
 * Preserve their entire evidence and report only composable work/row measures.
 */
export const mergePieceRiskStats = ({ input, dir, state, mergeState }) => {
  const stats = input.riskInterproceduralStats;
  const inputs = mergeState.riskStatsInputs || (mergeState.riskStatsInputs = []);
  inputs.push({ inputDir: dir, stats: stats && typeof stats === 'object' ? structuredClone(stats) : null });
  const first = inputs.find(entry => entry.stats)?.stats;
  if (!first) return;
  if (inputs.length === 1) {
    state.riskInterproceduralStats = structuredClone(stats);
    return;
  }
  const compatibleConfig = inputs.every(entry => entry.stats && stableStringify(entry.stats.effectiveConfig || {})
    === stableStringify(first.effectiveConfig || {}));
  const timingMs = {};
  for (const entry of inputs) for (const [key, value] of Object.entries(entry.stats?.timingMs || {})) {
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) timingMs[key] = (timingMs[key] || 0) + value;
  }
  state.riskInterproceduralStats = {
    schemaVersion: first.schemaVersion || 1,
    generatedAt: new Date().toISOString(),
    mode: first.mode,
    status: inputs.every(entry => entry.stats?.status === 'disabled') ? 'disabled' : 'partial',
    reason: 'Independent piece analyses are not a complete cross-piece risk analysis.',
    effectiveConfig: compatibleConfig ? structuredClone(first.effectiveConfig || {}) : {},
    provenance: null,
    counts: {
      inputPieces: inputs.length,
      summariesEmitted: state.riskSummaries?.length || 0,
      flowsEmitted: state.riskFlows?.length || 0,
      partialFlowsEmitted: state.riskPartialFlows?.length || 0
    },
    callSiteSampling: { strategy: 'per-input' },
    capsHit: [...new Set(inputs.flatMap(entry => Array.isArray(entry.stats?.capsHit) ? entry.stats.capsHit : []))].sort(),
    timingMs,
    droppedRecords: inputs.flatMap(entry => (Array.isArray(entry.stats?.droppedRecords) ? entry.stats.droppedRecords : [])
      .map(record => ({ ...record, inputDir: entry.inputDir }))),
    assembly: {
      composable: false,
      compatibleConfig,
      timingPolicy: 'sum of reported per-input work; not assembled wall time',
      inputs: structuredClone(inputs)
    }
  };
};
