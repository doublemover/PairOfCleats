#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  normalizeNonNegativeSamples,
  resolveInterpolatedPercentile,
  resolveNearestRankPercentile
} from '../../../src/shared/perf/percentiles.js';
import { summarizeBoundedHistogram } from '../../../src/shared/perf/histogram.js';
import { createBuildScheduler } from '../../../src/shared/concurrency/scheduler-core.js';

// Expected values are independently authored; never normalize the oracle with
// the same helper that the histogram and live latency consumers use.
assert.deepEqual(normalizeNonNegativeSamples([0.125, 1.875, -1, NaN, 0.375]), [0.125, 0.375, 1.875]);
assert.deepEqual(normalizeNonNegativeSamples([0.125, 1.875], { precision: null, sort: false }), [0.125, 1.875]);
assert.deepEqual(normalizeNonNegativeSamples([0.125, 1.875], { precision: 0 }), [0, 2]);
assert.deepEqual(normalizeNonNegativeSamples([0.125, 1.875], { precision: 2 }), [0.13, 1.88]);
assert.equal(resolveNearestRankPercentile([0.125, 0.375, 1.875], 0.5), 0.375);
assert.equal(resolveNearestRankPercentile([0.125, 0.375, 1.875], 0.95), 1.875);
assert.equal(resolveInterpolatedPercentile([0.125, 0.375], 0.5), 0.25);
assert.equal(resolveNearestRankPercentile([], 0.5), 0);
assert.equal(resolveNearestRankPercentile([], 0.5, { emptyValue: null }), null);
assert.equal(resolveInterpolatedPercentile([], 0.5), null);
assert.equal(summarizeBoundedHistogram([], {}), null);
assert.deepEqual(summarizeBoundedHistogram([0.125, 0.375, 1.875], { buckets: [1, 2] }), {
  unit: 'ms', sampleCount: 3, min: 0.125, max: 1.875,
  buckets: [{ le: 1, count: 2 }, { le: 2, count: 1 }], overflowCount: 0, p50: 0.375, p95: 1.875
});

let now = 0;
const scheduler = createBuildScheduler({ cpuTokens: 1, now: () => now });
try {
  for (const duration of [0.125, 0.375, 1.875]) {
    await scheduler.schedule('fractional', { cpu: 1 }, async () => { now += duration; });
  }
  const latency = scheduler.stats().queues.fractional.runLatencyMs;
  assert.equal(latency.sampleCount, 3);
  assert.equal(latency.min, 0.125);
  assert.equal(latency.max, 1.875);
  assert.equal(latency.p50, 0.375);
  assert.equal(latency.p95, 1.875, 'scheduler telemetry retains fractional timing through its actual histogram consumer');
} finally { await scheduler.shutdown(); }

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
