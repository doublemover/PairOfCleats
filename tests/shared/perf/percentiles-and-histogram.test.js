#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  normalizeNonNegativeSamples,
  resolveInterpolatedPercentile,
  resolveNearestRankPercentile
} from '../../../src/shared/perf/percentiles.js';
import { summarizeBoundedHistogram } from '../../../src/shared/perf/histogram.js';

const normalized = normalizeNonNegativeSamples([5.4, -1, '7', Number.NaN, 2.2], {
  round: true,
  sort: true
});
assert.deepEqual(normalized, [2, 5, 7], 'expected normalization to filter invalid values and round survivors');

assert.equal(
  resolveNearestRankPercentile([10, 20, 30], 0.95),
  30,
  'expected nearest-rank percentile to preserve the tail sample'
);
assert.equal(
  resolveNearestRankPercentile([10, 20, 30], -1),
  10,
  'expected nearest-rank percentile to clamp to the minimum sample'
);
assert.equal(
  resolveInterpolatedPercentile([1, 2, 3, 4], 0.95, { precision: 2 }),
  3.85,
  'expected interpolated percentile to preserve fractional tail placement'
);

const histogram = summarizeBoundedHistogram([1, 2, 7, 12, 20], {
  buckets: [5, 10, 15],
  unit: 'ms',
  round: true,
  percentiles: [
    { ratio: 0.5, key: 'p50Ms' },
    { ratio: 0.95, key: 'p95Ms' }
  ]
});
assert.deepEqual(
  histogram,
  {
    unit: 'ms',
    sampleCount: 5,
    min: 1,
    max: 20,
    buckets: [
      { le: 5, count: 2 },
      { le: 10, count: 1 },
      { le: 15, count: 1 }
    ],
    overflowCount: 1,
    p50Ms: 7,
    p95Ms: 20
  },
  'expected bounded histogram summary to preserve stable buckets and percentiles'
);

console.log('shared percentiles and histogram test passed');
