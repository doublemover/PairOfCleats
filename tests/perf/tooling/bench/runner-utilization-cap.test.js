#!/usr/bin/env node
import assert from 'node:assert/strict';

import { createBenchRunnerFixture } from './bench-runner-fixture.js';

const { runFixture } = await createBenchRunnerFixture('bench-runner-utilization-cap');
const report = await runFixture(
  'trace',
  [
    '#!/usr/bin/env node',
    'const trace = Array.from({ length: 3000 }, (_, i) => ({ atMs: i, utilizationPct: (i % 100) }));',
    'console.log(JSON.stringify({',
    '  timings: {',
    '    scheduler: { trace }',
    '  }',
    '}));',
    ''
  ]
);
const sampleCount = Number(report?.summary?.perCoreUtilization?.sampleCount || 0);
assert.equal(sampleCount, 2048, `expected utilization sample cap of 2048, got ${sampleCount}`);
assert.ok(
  Array.isArray(report?.summary?.perCoreUtilization?.timeline)
    && report.summary.perCoreUtilization.timeline.length <= 512,
  'expected utilization timeline to remain bounded to 512 entries'
);

console.log('bench runner utilization cap test passed');
