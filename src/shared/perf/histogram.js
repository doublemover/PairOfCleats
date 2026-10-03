import { coerceNonNegativeInt } from '../number-coerce.js';
import {
  normalizeNonNegativeSamples,
  resolveNearestRankPercentile
} from './percentiles.js';

export const summarizeBoundedHistogram = (
  values,
  {
    buckets = [],
    unit = 'ms',
    round = false,
    percentiles = Object.freeze([
      Object.freeze({ ratio: 0.5, key: 'p50' }),
      Object.freeze({ ratio: 0.95, key: 'p95' })
    ])
  } = {}
) => {
  const normalized = normalizeNonNegativeSamples(values, { round, sort: true });
  if (!normalized.length) return null;
  const bucketBounds = Array.from(
    new Set(
      (Array.isArray(buckets) ? buckets : [])
        .map((value) => coerceNonNegativeInt(value))
        .filter((value) => value != null)
    )
  ).sort((a, b) => a - b);
  const counts = new Array(bucketBounds.length).fill(0);
  let overflowCount = 0;
  for (const sample of normalized) {
    let matched = false;
    for (let index = 0; index < bucketBounds.length; index += 1) {
      if (sample <= bucketBounds[index]) {
        counts[index] += 1;
        matched = true;
        break;
      }
    }
    if (!matched) overflowCount += 1;
  }
  const histogram = {
    unit,
    sampleCount: normalized.length,
    min: normalized[0],
    max: normalized[normalized.length - 1],
    buckets: bucketBounds
      .map((le, index) => ({ le, count: counts[index] }))
      .filter((entry) => entry.count > 0),
    overflowCount
  };
  for (const percentile of Array.isArray(percentiles) ? percentiles : []) {
    const key = typeof percentile?.key === 'string' ? percentile.key.trim() : '';
    if (!key) continue;
    histogram[key] = resolveNearestRankPercentile(normalized, percentile.ratio, {
      sorted: true,
      emptyValue: null
    });
  }
  return histogram;
};
