#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { applyTestEnv } from '../../../helpers/test-env.js';

import { resolveTestCachePath } from '../../../helpers/test-cache.js';

applyTestEnv({ testing: '1' });

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'bench-runner-utilization-cap');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const fixtureScript = path.join(tempRoot, 'trace.fixture.js');
await fs.writeFile(
  fixtureScript,
  [
    '#!/usr/bin/env node',
    'const trace = Array.from({ length: 3000 }, (_, i) => ({ atMs: i, utilizationPct: (i % 100) }));',
    'console.log(JSON.stringify({',
    '  timings: {',
    '    scheduler: { trace }',
    '  }',
    '}));',
    ''
  ].join('\n'),
  'utf8'
);

const benchRunner = path.join(root, 'tools', 'bench', 'bench-runner.js');
const result = spawnSync(
  process.execPath,
  [benchRunner, '--scripts', fixtureScript, '--timeout-ms', '2000'],
  { cwd: root, env: process.env, encoding: 'utf8' }
);

if (result.status !== 0) {
  console.error(result.stdout || '');
  console.error(result.stderr || '');
  process.exit(result.status ?? 1);
}

const report = JSON.parse(String(result.stdout || '{}'));
const sampleCount = Number(report?.summary?.perCoreUtilization?.sampleCount || 0);
assert.equal(sampleCount, 2048, `expected utilization sample cap of 2048, got ${sampleCount}`);
assert.ok(
  Array.isArray(report?.summary?.perCoreUtilization?.timeline)
    && report.summary.perCoreUtilization.timeline.length <= 512,
  'expected utilization timeline to remain bounded to 512 entries'
);

console.log('bench runner utilization cap test passed');
