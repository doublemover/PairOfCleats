#!/usr/bin/env node
import assert from 'node:assert/strict';

import {
  consoleLogFixtureSource,
  createBenchRunnerFixture
} from './bench-runner-fixture.js';

const benchFixture = await createBenchRunnerFixture('bench-runner-contract');
const runFixture = async (name, lines) => {
  const report = await benchFixture.runFixture(name, consoleLogFixtureSource(lines));
  assert.equal(report.schemaVersion, 1);
  assert.equal(typeof report?.runner?.configHash, 'string', 'expected configHash reproducibility metadata');
  assert.ok(report?.runner?.storagePath, 'expected storagePath reproducibility metadata');
  assert.ok(report?.runner?.storageTier, 'expected storageTier reproducibility metadata');
  assert.ok(report?.runner?.antivirusState, 'expected antivirusState reproducibility metadata');
  assert.ok(report?.runner?.cpuGovernor, 'expected cpuGovernor reproducibility metadata');
  assert.ok(report?.summary?.stageOverlap, 'expected stage overlap summary');
  assert.ok(report?.summary?.perCoreUtilization, 'expected per-core utilization summary');
  assert.ok(report?.summary?.criticalPath, 'expected critical path summary');
  assert.ok(Array.isArray(report?.summary?.triageHints), 'expected triage hints array');
  assert.ok(Array.isArray(report?.summary?.regressionSignals), 'expected structured regression signals');
  assert.ok(Array.isArray(report.results) && report.results.length === 1, 'expected single result');
  return report;
};

const baseExpect = {
  baselineDuration: 10,
  currentDuration: 8,
  deltaDuration: -2,
  baselineThroughput: 100,
  currentThroughput: 125,
  deltaThroughput: 25
};

const cases = [
  {
    name: 'canonical',
    lines: [
      '[bench] baseline duration=10.0ms throughput=100.0/s amount=1000',
      '[bench] current duration=8.0ms throughput=125.0/s amount=1000',
      '[bench] delta duration=-2.0ms (-20.0%) throughput=25.0/s (25.0%) amount=1000'
    ]
  },
  {
    name: 'classified-prefix',
    lines: [
      '[bench] run-a baseline duration=10.0ms throughput=100.0/s amount=1000',
      '[bench] run-a current duration=8.0ms throughput=125.0/s amount=1000',
      '[bench] run-a delta duration=-2.0ms (-20.0%) throughput=25.0/s (25.0%) amount=1000'
    ]
  },
  {
    name: 'reordered',
    lines: [
      '[bench] delta duration=-2.0ms (-20.0%) throughput=25.0/s (25.0%) amount=1000',
      '[bench] baseline duration=10.0ms throughput=100.0/s amount=1000',
      '[bench] current duration=8.0ms throughput=125.0/s amount=1000'
    ]
  }
];

for (const testCase of cases) {
  const canonicalReport = await runFixture(`${testCase.name}-canonical`, testCase.lines);
  const canonicalEntry = canonicalReport.results[0];
  assert.ok(canonicalEntry.id?.endsWith('.fixture.js'), 'expected runner result id');
  assert.deepEqual(canonicalEntry.args, [], 'expected script runner args to be recorded');
  assert.equal(canonicalEntry.expect, null, 'expected no suite expectation for direct script runs');
  assert.equal(canonicalEntry.ok, true);
  assert.equal(canonicalEntry.skipped, false);
  assert.equal(canonicalEntry.skipReason, null);
  assert.equal(canonicalEntry.parsedOk, true);
  assert.deepEqual(canonicalEntry.errors, []);
  assert.equal(canonicalEntry.parsed?.baseline?.metrics?.duration, baseExpect.baselineDuration);
  assert.equal(canonicalEntry.parsed?.current?.metrics?.duration, baseExpect.currentDuration);
  assert.equal(canonicalEntry.parsed?.delta?.metrics?.duration, baseExpect.deltaDuration);
  assert.equal(canonicalEntry.parsed?.baseline?.metrics?.throughput, baseExpect.baselineThroughput);
  assert.equal(canonicalEntry.parsed?.current?.metrics?.throughput, baseExpect.currentThroughput);
  assert.equal(canonicalEntry.parsed?.delta?.metrics?.throughput, baseExpect.deltaThroughput);

  // Metamorphic relation: non-bench noise and whitespace should not change parsed bench metrics.
  const noisyLines = [
    'unrelated preface line',
    ...testCase.lines.map((line) => `  ${line}  `),
    'unrelated trailer line'
  ];
  const noisyReport = await runFixture(`${testCase.name}-noisy`, noisyLines);
  const noisyEntry = noisyReport.results[0];
  assert.deepEqual(noisyEntry.parsed, canonicalEntry.parsed);
  assert.equal(typeof canonicalReport.summary.perCoreUtilization.avgPct, 'number');
  assert.equal(typeof canonicalReport.summary.stageOverlap.avgPct, 'number');
}

const improvedWithAbsoluteDuration = await runFixture(
  'improved-with-absolute-duration',
  [
    '[bench] baseline rows=50000 ms=98.2 rowsPerSec=509272.8',
    '[bench] current rows=50000 ms=73.5 rowsPerSec=680493.4',
    '[bench] delta ms=-24.7 (-25.2%) rowsPerSec=171220.5 duration=73.5ms'
  ]
);
assert.equal(
  improvedWithAbsoluteDuration.summary.triageHints.some((hint) => hint.includes('Regression signal')),
  false,
  'expected absolute duration on a delta line not to override negative ms delta'
);
assert.equal(
  improvedWithAbsoluteDuration.results[0].parsed?.current?.metrics?.rowsPerSec,
  680493.4,
  'expected numeric metrics with plain decimal values'
);

const inlineCurrentDeltaReport = await runFixture(
  'inline-current-delta',
  [
    '[bench] baseline ms=1286.9 bytes=2554949',
    '[bench] current ms=335.5 bytes=2849724 delta=-951.4ms (-73.9%)'
  ]
);
assert.equal(
  inlineCurrentDeltaReport.results[0].parsed?.delta,
  null,
  'expected current lines with inline delta metrics not to be classified as delta lines'
);
assert.equal(
  inlineCurrentDeltaReport.summary.triageHints.some((hint) => hint.includes('Regression signal')),
  false,
  'expected missing delta line not to create a false regression signal from current duration'
);

const hashMetricReport = await runFixture(
  'hash-metric',
  [
    '[bench] baseline queueHash=6feaf895 total=10.0ms',
    '[bench] current queueHash=b4c54270 total=8.0ms',
    '[bench] delta ms=-2.0 (-20.0%)'
  ]
);
assert.equal(
  hashMetricReport.results[0].parsed?.baseline?.metrics?.queueHash,
  '6feaf895',
  'expected alphanumeric metric values to stay strings'
);

const regressionReport = await runFixture(
  'positive-ms-regression',
  [
    '[bench] baseline algo=rolling-hash ms=14.0 vocab=10000',
    '[bench] current algo=rolling-hash ms=17.9 vocab=10000 delta=3.9ms (28.1%)',
    '[bench] delta ms=3.9 (28.1%)'
  ]
);
assert.equal(regressionReport.summary.regressionSignals.length, 1);
assert.equal(regressionReport.summary.regressionSignals[0].deltaMs, 3.9);
assert.equal(
  regressionReport.summary.triageHints.some((hint) => hint.includes('positive delta duration=3.9ms')),
  true,
  'expected positive ms delta to produce a regression hint'
);

console.log('bench runner contract test passed');

