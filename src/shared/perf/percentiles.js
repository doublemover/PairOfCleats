const clampUnitRatio = (value, fallback = 0) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(1, parsed));
};

export const normalizeNonNegativeSamples = (
  values,
  { round = false, precision = null, sort = true } = {}
) => {
  const normalized = (Array.isArray(values) ? values : [])
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value >= 0)
    .map((value) => {
      if (round) return Math.round(value);
      if (Number.isFinite(Number(precision)) && precision >= 0) {
        return Number(value.toFixed(Math.floor(precision)));
      }
      return value;
    });
  if (sort !== false) {
    normalized.sort((a, b) => a - b);
  }
  return normalized;
};

export const resolveNearestRankPercentile = (
  values,
  ratio,
  { sorted = false, emptyValue = 0 } = {}
) => {
  const samples = sorted
    ? (Array.isArray(values) ? values : [])
    : normalizeNonNegativeSamples(values, { sort: true });
  if (!samples.length) return emptyValue;
  const target = clampUnitRatio(ratio, 0);
  if (target <= 0) return samples[0];
  if (target >= 1) return samples[samples.length - 1];
  const rank = Math.ceil(target * samples.length);
  const index = Math.max(0, Math.min(samples.length - 1, rank - 1));
  return samples[index];
};

export const resolveInterpolatedPercentile = (
  values,
  ratio,
  { sorted = false, emptyValue = null, precision = 3 } = {}
) => {
  const samples = sorted
    ? (Array.isArray(values) ? values : [])
    : normalizeNonNegativeSamples(values, { sort: true });
  if (!samples.length) return emptyValue;
  if (samples.length === 1) {
    return Number(samples[0].toFixed(Math.max(0, Math.floor(Number(precision) || 0))));
  }
  const target = clampUnitRatio(ratio, 0);
  if (target <= 0) return Number(samples[0].toFixed(Math.max(0, Math.floor(Number(precision) || 0))));
  if (target >= 1) {
    return Number(samples[samples.length - 1].toFixed(Math.max(0, Math.floor(Number(precision) || 0))));
  }
  const index = (samples.length - 1) * target;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) {
    return Number(samples[lower].toFixed(Math.max(0, Math.floor(Number(precision) || 0))));
  }
  const weight = index - lower;
  return Number(((samples[lower] * (1 - weight)) + (samples[upper] * weight)).toFixed(
    Math.max(0, Math.floor(Number(precision) || 0))
  ));
};
