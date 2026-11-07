const finite = value => typeof value === 'number' && Number.isFinite(value);
const inRange = (value, maximum) => finite(value) && value >= 0 && value <= maximum;

/** Percent fields never infer scale from magnitude. Scheduler overall is a
 * ratio of occupied token capacity, not a hardware/per-core CPU measurement. */
export const resolveUtilizationSample = sample => {
  for (const [source, rawValue, sourceUnit, scope] of [
    ['utilizationPct', sample?.utilizationPct, 'percent', 'producer-declared-utilization'],
    ['overallPct', sample?.overallPct, 'percent', 'producer-declared-utilization'],
    ['utilization.overallPct', sample?.utilization?.overallPct, 'percent', 'producer-declared-utilization'],
    ['utilization.overall', sample?.utilization?.overall, 'ratio', 'scheduler-token-occupancy']
  ]) {
    if (inRange(rawValue, sourceUnit === 'percent' ? 100 : 1)) return {
      utilizationPct: sourceUnit === 'percent' ? rawValue : rawValue * 100, source, sourceUnit, scope, rawValue
    };
  }
  for (const [source, used, total] of [
    ['cpuUsed/cpuTotal', sample?.cpuUsed, sample?.cpuTotal],
    ['tokensUsed.cpu/tokensTotal.cpu', sample?.tokensUsed?.cpu, sample?.tokensTotal?.cpu],
    ['used.cpu/limits.cpu', sample?.used?.cpu, sample?.limits?.cpu]
  ]) {
    if (finite(used) && finite(total) && total > 0 && used >= 0 && used <= total) return {
      utilizationPct: used / total * 100, rawValue: used / total, source, sourceUnit: 'token-ratio',
      scope: 'scheduler-token-occupancy', used, total
    };
  }
  return null;
};

export const collectUtilizationSamples = ({ trace, script, cap = 2048 }) => {
  if (!Number.isSafeInteger(cap) || cap < 1 || cap > 2048) throw new TypeError('Utilization retention must be between 1 and 2048.');
  const ring = new Array(cap);
  let valid = 0, unavailable = 0;
  const intervalsByScope = {};
  let previous = null;
  for (let index = 0; index < trace.length; index++) {
    const value = resolveUtilizationSample(trace[index]);
    if (!value) { unavailable++; previous = null; continue; }
    const at = trace[index]?.atMs ?? trace[index]?.timeMs ?? trace[index]?.elapsedMs;
    const atMs = finite(at) && at >= 0 ? at : null;
    if (previous && atMs !== null && atMs > previous.atMs && previous.scope === value.scope
      && previous.source === value.source) {
      const interval = intervalsByScope[value.scope] ||= { observedIntervals: 0, coveredMs: 0, weightedPctMs: 0 };
      const duration = atMs - previous.atMs;
      interval.observedIntervals++; interval.coveredMs += duration; interval.weightedPctMs += previous.utilizationPct * duration;
    }
    previous = atMs === null ? null : { ...value, atMs };
    ring[valid++ % cap] = { script, sample: index, atMs: finite(at) ? at : null, ...value };
  }
  const count = Math.min(valid, cap), start = valid >= cap ? valid % cap : 0;
  return { samples: Array.from({ length: count }, (_, index) => ring[(start + index) % cap]),
    observedCount: trace.length, validCount: valid, unavailableCount: unavailable,
    intervalObservation: { script, scope: 'within-script-left-held-observed-intervals', intervalsByScope } };
};

export const summarizeUtilization = ({ samples, observedCount, validCount, unavailableCount, percentile, intervalObservations = [] }) => {
  const stats = rows => {
    const values = rows.map(row => row.utilizationPct);
    return { sampleCount: values.length, avgPct: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null,
      minPct: values.length ? Math.min(...values) : null, maxPct: values.length ? Math.max(...values) : null,
      p50Pct: values.length ? percentile(values, 0.5) : null, p95Pct: values.length ? percentile(values, 0.95) : null };
  };
  const byScope = Object.fromEntries(['producer-declared-utilization', 'scheduler-token-occupancy']
    .map(scope => [scope, stats(samples.filter(sample => sample.scope === scope))]));
  const scopes = Object.keys(byScope).filter(scope => byScope[scope].sampleCount > 0);
  const intervalTotals = {};
  for (const observation of intervalObservations) for (const [scope, input] of Object.entries(observation.intervalsByScope)) {
    const total = intervalTotals[scope] ||= { observedIntervals: 0, coveredMs: 0, weightedPctMs: 0, scripts: 0 };
    total.observedIntervals += input.observedIntervals; total.coveredMs += input.coveredMs;
    total.weightedPctMs += input.weightedPctMs; total.scripts += input.scripts ?? 1;
  }
  const intervalWeighted = Object.fromEntries(Object.entries(intervalTotals).map(([scope, total]) => [scope,
    { ...total, meanPct: total.coveredMs > 0 ? total.weightedPctMs / total.coveredMs : null }]));
  return { ...stats(scopes.length === 1 ? samples : []), sampleCount: samples.length,
    schemaVersion: 2, aggregation: 'retained-sample-arithmetic-statistic', coverage: 'bounded-suffix-of-valid-samples',
    runWallTimeAveragePct: null,
    intervalWeighted: { estimand: 'duration-weighted-within-script-observed-intervals',
      interpolation: 'left-held-until-next-same-source-observation', crossScriptOverlap: 'not-inferred', byScope: intervalWeighted },
    scope: scopes.length > 1 ? 'mixed' : scopes[0] || 'unavailable', hardwareCpuMeasurement: false,
    observedCount, validCount, unavailableCount, omittedCount: validCount - samples.length,
    byScope, timeline: samples.slice(-512) };
};
