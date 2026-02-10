#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

import { applyTestEnv } from '../../../helpers/test-env.js';

applyTestEnv({ testing: '1' });

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'bench-runner-contract');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const fixtureScript = path.join(tempRoot, 'fixture.js');
await fs.writeFile(
  fixtureScript,
  [
    '#!/usr/bin/env node',
    "console.log('[bench] baseline duration=10.0ms throughput=100.0/s amount=1000');",
    "console.log('[bench] current duration=8.0ms throughput=125.0/s amount=1000');",
    "console.log('[bench] delta duration=-2.0ms (-20.0%) throughput=25.0/s (25.0%) amount=1000');",
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
assert.equal(report.schemaVersion, 1);
assert.ok(Array.isArray(report.results) && report.results.length === 1, 'expected single result');

const entry = report.results[0];
assert.equal(entry.ok, true);
assert.equal(entry.parsed?.baseline?.metrics?.duration, 10);
assert.equal(entry.parsed?.current?.metrics?.duration, 8);
assert.equal(entry.parsed?.delta?.metrics?.duration, -2);
assert.equal(entry.parsed?.baseline?.metrics?.throughput, 100);
assert.equal(entry.parsed?.current?.metrics?.throughput, 125);
assert.equal(entry.parsed?.delta?.metrics?.throughput, 25);

console.log('bench runner contract test passed');

