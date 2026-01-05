export function percentile(sortedValues, pct) {
  if (!sortedValues.length) return 0;
  if (sortedValues.length === 1) return sortedValues[0];
  const idx = (pct / 100) * (sortedValues.length - 1);
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  if (lower === upper) return sortedValues[lower];
  const weight = idx - lower;
  return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
}

export function summarizeDurations(values) {
  if (!values.length) {
    return { count: 0, mean: 0, min: 0, max: 0, p50: 0, p95: 0 };
  }
  const sorted = values.slice().sort((a, b) => a - b);
  const total = sorted.reduce((sum, value) => sum + value, 0);
  return {
    count: sorted.length,
    mean: total / sorted.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95)
  };
}

export function formatMs(value) {
  if (!Number.isFinite(value)) return 'n/a';
  return `${value.toFixed(1)}ms`;
}

export function formatStats(stats) {
  return `mean ${formatMs(stats.mean)} | p50 ${formatMs(stats.p50)} | p95 ${formatMs(stats.p95)} | min ${formatMs(stats.min)} | max ${formatMs(stats.max)} | n=${stats.count}`;
}

export function hrtimeMs(start) {
  return Number(process.hrtime.bigint() - start) / 1e6;
}
