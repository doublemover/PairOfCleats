import assert from 'node:assert/strict';
import { runBenchRunner } from '../../../tools/bench/bench-runner.js';
import { collectUtilizationSamples, summarizeUtilization } from '../../../tools/bench/runner-utilization.js';
import { BENCH_RUNNER_REPORT_VERSION } from '../../../tools/bench/runner-contract.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { createBenchRunnerFixture } from '../../perf/tooling/bench/bench-runner-fixture.js';

applyTestEnv();
const percentile = (values, fraction) => [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * fraction) - 1)];
const reduce = (traces, cap = 2048) => {
  const observations = traces.map((trace, i) => collectUtilizationSamples({ trace, script: `script-${i}`, cap }));
  return summarizeUtilization({ samples: observations.flatMap(row => row.samples).slice(-cap),
    observedCount: observations.reduce((sum, row) => sum + row.observedCount, 0), validCount: observations.reduce((sum, row) => sum + row.validCount, 0),
    unavailableCount: observations.reduce((sum, row) => sum + row.unavailableCount, 0), percentile,
    intervalObservations: observations.map(row => row.intervalObservation) });
};
const sparse = [{ atMs: 0, utilizationPct: 0 }, { atMs: 100, utilizationPct: 100 }, { atMs: 400, utilizationPct: 100 }];
const dense = [...Array.from({ length: 10 }, (_, i) => ({ atMs: i * 10, utilizationPct: 0 })), ...sparse.slice(1)];
for (const trace of [sparse, dense]) {
  const report = reduce([trace]);
  assert.equal(report.intervalWeighted.byScope['producer-declared-utilization'].meanPct, 75);
  assert.equal(report.intervalWeighted.byScope['producer-declared-utilization'].coveredMs, 400);
  assert.equal(report.runWallTimeAveragePct, null); assert.equal(report.aggregation, 'retained-sample-arithmetic-statistic');
}
const long = Array.from({ length: 2200 }, (_, i) => ({ atMs: i, utilizationPct: 0.5 }));
for (const traces of [[sparse, long], [long, sparse]]) {
  const report = reduce(traces, 3), expected = (30000 + 2199 * 0.5) / (400 + 2199);
  assert.equal(report.sampleCount, 3); assert.ok(report.omittedCount > 2100);
  assert.equal(report.intervalWeighted.byScope['producer-declared-utilization'].meanPct, expected);
}
assert.equal(reduce([[]]).avgPct, null); assert.equal(reduce([[{ atMs: 0, utilizationPct: 0 }, { atMs: 1, utilizationPct: 0 }]]).avgPct, 0);
const measured = await runBenchRunner({ argv: { scripts: ['tools/bench/micro/regex.js'], quiet: true }, run: ({ script }) => ({
  script, exitCode: 0, timedOut: false, signal: null, ok: true, stdout: '', stderr: '', parsed: {},
  startedAtMs: 1700000000000, endedAtMs: 1700000000005, durationMs: 5,
  json: { timings: { totalMs: 100, stages: { parseMs: 80, inferMs: 80, writeMs: 80 },
    artifacts: [{ path: 'service-only', durationMs: 40 }, { path: 'explicit-zero', durationMs: 50, stallMs: 0, queueDelayMs: 12 },
      { path: 'relative', durationMs: 40, startedAtMs: 5, endedAtMs: 45 },
      { path: 'epoch', durationMs: 1, startedAtMs: 1700000000000, endedAtMs: 1700000000001, clockOrigin: 'unix-epoch-ms' },
      { path: 'null', durationMs: null }, { path: 'negative', durationMs: -1 }] } }
}) });
assert.equal(measured.report.schemaVersion, BENCH_RUNNER_REPORT_VERSION); assert.equal(BENCH_RUNNER_REPORT_VERSION, 3);
assert.deepEqual(measured.report.summary.artifactStallDurationMs, { count: 1, p95: 0, p99: 0, max: 0 });
const timeline = measured.report.summary.criticalPath;
assert.equal(timeline.kind, 'completion-timeline'); assert.equal(timeline.causalCriticalPath, false);
assert.equal(timeline.reconstructedTail.some(row => row.path === 'relative'), false);
assert.equal(timeline.reconstructedTail.some(row => row.path === 'epoch'), true);
assert.equal(timeline.artifacts.find(row => row.path === 'service-only').stallMs, null);
assert.equal(timeline.artifacts.find(row => row.path === 'explicit-zero').queueDelayMs, 12);
const estimate = measured.report.summary.stageOverlap.rows[0];
assert.equal(estimate.excessWorkMs, 140); assert.equal(estimate.observedOverlap, false);
// Independent actual intervals [0,80],[40,120],[150,230] have union200ms
// and overlap40ms. Neither is the arithmetic estimate140ms above.
assert.notEqual(estimate.excessWorkMs, 40); assert.notEqual(estimate.excessWorkMs, 200);
const fixture = await createBenchRunnerFixture('runner-monotonic-consumer');
const script = await fixture.writeFixture('actual-child', ["console.log('[bench] baseline duration=1ms');"]);
const wallClock = Date.now; let ticks = 0, clockRun;
try {
  Date.now = () => {
    const caller = new Error().stack.split('\n')[2] || '';
    return /[\\/]tools[\\/]bench[\\/]bench-runner\.js:/u.test(caller) ? 100000 - ticks++ * 10000 : wallClock();
  };
  clockRun = await runBenchRunner({ argv: { suite: 'fixture', scripts: [], json: null, quiet: true, timeoutMs: 2000 },
    resolveSuite: () => [{ id: 'actual-child', script, args: [], expect: { baseline: true } }] });
} finally { Date.now = wallClock; }
assert.equal(clockRun.exitCode, 0);
const actual = clockRun.report.results[0];
assert.equal(actual.elapsedClock, 'monotonic-hrtime'); assert.equal(actual.clockOrigin, 'unix-epoch-ms');
assert.ok(actual.endedAtMs < actual.startedAtMs, 'the private parent-clock control must actually move backwards');
assert.ok(actual.durationMs > 0 && actual.durationMs < 2000, 'actual child elapsed time remains valid despite wall-clock adjustment');
console.log('Actual benchmark reducer preserves units, capped sample scope, independent interval weighting and service/wait/clock meaning.');
