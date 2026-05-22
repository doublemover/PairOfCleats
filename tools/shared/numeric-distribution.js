export const mean = (values) => {
  const entries = Array.isArray(values) ? values : [];
  if (!entries.length) return null;
  return entries.reduce((sum, value) => sum + value, 0) / entries.length;
};

export const sortNumeric = (values) => (Array.isArray(values) ? values : [])
  .map((value) => Number(value))
  .filter(Number.isFinite)
  .sort((left, right) => left - right);

export const quantileSorted = (sortedValues, percentile) => {
  const values = Array.isArray(sortedValues) ? sortedValues : [];
  if (!values.length) return null;
  const p = Number(percentile);
  if (!Number.isFinite(p)) return null;
  const clamped = Math.max(0, Math.min(1, p));
  if (values.length === 1) return values[0];
  const position = clamped * (values.length - 1);
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const lower = values[lowerIndex];
  const upper = values[upperIndex];
  if (!Number.isFinite(lower) || !Number.isFinite(upper)) return null;
  if (lowerIndex === upperIndex) return lower;
  return lower + ((upper - lower) * (position - lowerIndex));
};

export const summarizeNumericDistribution = (values) => {
  const sorted = sortNumeric(values);
  if (!sorted.length) return null;
  const avg = mean(sorted);
  const variance = avg == null
    ? null
    : (sorted.reduce((sum, value) => sum + ((value - avg) ** 2), 0) / sorted.length);
  const stdDev = Number.isFinite(variance) ? Math.sqrt(variance) : null;
  const coefficientOfVariation = (Number.isFinite(stdDev) && Number.isFinite(avg) && avg !== 0)
    ? (stdDev / Math.abs(avg))
    : null;
  return {
    count: sorted.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    mean: avg,
    median: quantileSorted(sorted, 0.5),
    p90: quantileSorted(sorted, 0.9),
    p95: quantileSorted(sorted, 0.95),
    p99: quantileSorted(sorted, 0.99),
    stdDev,
    coefficientOfVariation
  };
};
