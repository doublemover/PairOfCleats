import { build as buildHistogram } from 'hdr-histogram-js';

const buildLatencyHistogram = (values) => {
  if (!values.length) return null;
  const scaled = values.map((value) => Math.max(1, Math.round(value * 1000)));
  const maxValue = Math.max(...scaled, 1);
  const histogram = buildHistogram({
    lowestDiscernibleValue: 1,
    highestTrackableValue: maxValue,
    numberOfSignificantValueDigits: 3
  });
  scaled.forEach((value) => histogram.recordValue(value));
  return histogram;
};

export function summarizeDurations(values) {
  if (!values.length) {
    return { count: 0, mean: 0, min: 0, max: 0, p50: 0, p95: 0, p99: 0 };
  }
  const total = values.reduce((sum, value) => sum + value, 0);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const histogram = buildLatencyHistogram(values);
  const pct = (p) => (histogram ? histogram.getValueAtPercentile(p) / 1000 : 0);
  return {
    count: values.length,
    mean: total / values.length,
    min,
    max,
    p50: pct(50),
    p95: pct(95),
    p99: pct(99)
  };
}

export function formatMs(value) {
  if (!Number.isFinite(value)) return 'n/a';
  return `${value.toFixed(1)}ms`;
}

export function formatStats(stats) {
  return `mean ${formatMs(stats.mean)} | p50 ${formatMs(stats.p50)} | p95 ${formatMs(stats.p95)} | p99 ${formatMs(stats.p99)} | min ${formatMs(stats.min)} | max ${formatMs(stats.max)} | n=${stats.count}`;
}

export function hrtimeMs(start) {
  return Number(process.hrtime.bigint() - start) / 1e6;
}
