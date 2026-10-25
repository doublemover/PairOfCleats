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
  for (let index = 0; index < trace.length; index++) {
    const value = resolveUtilizationSample(trace[index]);
    if (!value) { unavailable++; continue; }
    const at = trace[index]?.atMs ?? trace[index]?.timeMs ?? trace[index]?.elapsedMs;
    ring[valid++ % cap] = { script, sample: index, atMs: finite(at) ? at : null, ...value };
  }
  const count = Math.min(valid, cap), start = valid >= cap ? valid % cap : 0;
  return { samples: Array.from({ length: count }, (_, index) => ring[(start + index) % cap]),
    observedCount: trace.length, validCount: valid, unavailableCount: unavailable };
};

export const summarizeUtilization = ({ samples, observedCount, validCount, unavailableCount, percentile }) => {
  const stats = rows => {
    const values = rows.map(row => row.utilizationPct);
    return { sampleCount: values.length, avgPct: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null,
      minPct: values.length ? Math.min(...values) : null, maxPct: values.length ? Math.max(...values) : null,
      p50Pct: values.length ? percentile(values, 0.5) : null, p95Pct: values.length ? percentile(values, 0.95) : null };
  };
  const byScope = Object.fromEntries(['producer-declared-utilization', 'scheduler-token-occupancy']
    .map(scope => [scope, stats(samples.filter(sample => sample.scope === scope))]));
  const scopes = Object.keys(byScope).filter(scope => byScope[scope].sampleCount > 0);
  return { ...stats(scopes.length === 1 ? samples : []), sampleCount: samples.length,
    scope: scopes.length > 1 ? 'mixed' : scopes[0] || 'unavailable', hardwareCpuMeasurement: false,
    observedCount, validCount, unavailableCount, omittedCount: validCount - samples.length,
    byScope, timeline: samples.slice(-512) };
};
