import assert from 'node:assert/strict';
import { createBenchRunnerFixture } from './bench-runner-fixture.js';
import { resolveUtilizationSample } from '../../../../tools/bench/runner-utilization.js';

for (const value of [0, 0.5, 1, 1.01, 50, 100]) {
  assert.equal(resolveUtilizationSample({ utilizationPct: value }).utilizationPct, value);
}
assert.equal(resolveUtilizationSample({ utilization: { overall: 0.5 } }).utilizationPct, 50);
for (const invalid of [null, undefined, false, '', '0.5', NaN, Infinity, -1, 101, {}]) {
  const sample = resolveUtilizationSample({ utilizationPct: invalid, cpuUsed: 1, cpuTotal: 4 });
  assert.equal(sample.utilizationPct, 25);
  assert.equal(sample.scope, 'scheduler-token-occupancy');
  assert.equal(sample.sourceUnit, 'token-ratio');
}
assert.equal(resolveUtilizationSample({ utilizationPct: null }), null);
assert.equal(resolveUtilizationSample({ cpuUsed: 1, tokensTotal: { cpu: 4 } }), null,
  'unrelated source counters cannot be combined into one occupancy observation');
assert.equal(resolveUtilizationSample({ utilizationPct: null, overallPct: 0.5 }).utilizationPct, 0.5);

const { runFixture } = await createBenchRunnerFixture('bench-utilization-unit-contract');
const runTrace = async (name, trace) => {
  const report = await runFixture(name, [`console.log(${JSON.stringify(JSON.stringify({ schedulerTrace: trace }))});`]);
  return report.summary.perCoreUtilization;
};
const percent = await runTrace('percent', [0, 0.5, 1, 1.01, 50, 100].map(utilizationPct => ({ utilizationPct })));
assert.deepEqual(percent.timeline.map(row => row.utilizationPct), [0, 0.5, 1, 1.01, 50, 100]);
assert.ok(Math.abs(percent.avgPct - 25.418333333333333) < 1e-12);
assert.equal(percent.minPct, 0);
assert.equal(percent.maxPct, 100);
assert.equal(percent.p50Pct, 1);
assert.equal(percent.p95Pct, 100);
assert.equal(percent.scope, 'producer-declared-utilization');
assert.equal(percent.hardwareCpuMeasurement, false);
const mixed = await runTrace('mixed', [{ utilizationPct: 0.5 }, { utilization: { overall: 0.5 } },
  { utilizationPct: null, cpuUsed: 1, cpuTotal: 4 }, { utilizationPct: null }]);
assert.equal(mixed.sampleCount, 3);
assert.equal(mixed.observedCount, 4);
assert.equal(mixed.unavailableCount, 1);
assert.equal(mixed.scope, 'mixed');
assert.equal(mixed.avgPct, null, 'different measurement scopes cannot mint one utilization mean');
assert.equal(mixed.byScope['producer-declared-utilization'].avgPct, 0.5);
assert.equal(mixed.byScope['scheduler-token-occupancy'].avgPct, 37.5);
const unavailable = await runTrace('unavailable', [{ utilizationPct: null }, { utilizationPct: false }]);
assert.equal(unavailable.sampleCount, 0);
assert.equal(unavailable.avgPct, null);
assert.equal(unavailable.unavailableCount, 2);
assert.equal(unavailable.scope, 'unavailable');
console.log('benchmark utilization field units, missingness and actual runner aggregates test passed');
