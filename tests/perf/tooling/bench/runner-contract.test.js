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
  assert.equal(canonicalEntry.ok, true);
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

console.log('bench runner contract test passed');

