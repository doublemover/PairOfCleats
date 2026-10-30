#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { applyTestEnv } from '../../../helpers/test-env.js';
import { runNode } from '../../../helpers/run-node.js';

import { resolveTestCachePath } from '../../../helpers/test-cache.js';

const testEnv = applyTestEnv({ testing: '1' });

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'bench-guardrails-contract');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const reportPath = path.join(tempRoot, 'report.json');
await fs.writeFile(
  reportPath,
  `${JSON.stringify({
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    summary: {
      ok: 1,
      error: 0,
      timeout: 0,
      artifactStallDurationMs: { count: 2, p95: 20, p99: 25, max: 30 },
      stageOverlap: { count: 1, avgPct: 12, p50Pct: 12, p95Pct: 12, maxPct: 12, rows: [] },
      perCoreUtilization: {
        sampleCount: 2,
        avgPct: 82,
        minPct: 80,
        maxPct: 84,
        p50Pct: 82,
        p95Pct: 84,
        timeline: []
      },
      criticalPath: {
        scripts: [{ script: 'fixture', durationMs: 100 }],
        artifacts: [],
        reconstructedTail: []
      },
      triageHints: []
    },
    results: []
  }, null, 2)}\n`,
  'utf8'
);

const scriptPath = path.join(root, 'tools', 'bench', 'check-guardrails.js');
const passing = runNode(
  [
    scriptPath,
    '--report',
    reportPath,
    '--max-stage-duration-ms',
    '120',
    '--max-artifact-stall-p95-ms',
    '25',
    '--min-utilization-pct',
    '75',
    '--min-stage-overlap-pct',
    '10',
    '--json'
  ],
  'bench guardrails passing contract',
  root,
  testEnv,
  { stdio: 'pipe', allowFailure: true }
);
if (passing.status !== 0) {
  console.error(passing.stdout || '');
  console.error(passing.stderr || '');
  process.exit(passing.status ?? 1);
}
const passPayload = JSON.parse(String(passing.stdout || '{}'));
assert.equal(passPayload.ok, true, 'expected guardrails pass');

const failing = runNode(
  [
    scriptPath,
    '--report',
    reportPath,
    '--max-stage-duration-ms',
    '80',
    '--json'
  ],
  'bench guardrails failing contract',
  root,
  testEnv,
  { stdio: 'pipe', allowFailure: true }
);
assert.equal(failing.status, 1, 'expected guardrails failure exit code');
const failPayload = JSON.parse(String(failing.stdout || '{}'));
assert.equal(failPayload.ok, false, 'expected failure payload');
assert.ok(Array.isArray(failPayload.failedChecks) && failPayload.failedChecks.length > 0, 'expected failing checks');
assert.deepEqual(failPayload.failedChecks.map(check => check.name), ['stage-duration-max']);
assert.equal(failPayload.failedChecks[0].observed, 100);
const run = extra => runNode([scriptPath, '--report', reportPath, '--json', ...extra],
  'bench guardrail optional measurement contract', root, testEnv, { stdio: 'pipe', allowFailure: true });
const single = run(['--max-stage-duration-ms', '120']);
assert.equal(single.status, 0, single.stderr);
assert.deepEqual(JSON.parse(single.stdout).checks.map(check => check.name), ['stage-duration-max']);
await fs.writeFile(reportPath, '{}');
const absent = run(['--max-stage-duration-ms', '120']);
assert.equal(absent.status, 1);
assert.equal(JSON.parse(absent.stdout).failedChecks[0].observed, null);
const invalid = run(['--max-stage-duration-ms', 'abc']);
assert.notEqual(invalid.status, 0);
assert.match(invalid.stderr, /finite nonnegative/);
await fs.writeFile(reportPath, JSON.stringify({ summary: { criticalPath: { scripts: [{ durationMs: 0 }] } } }));
const zero = run(['--max-stage-duration-ms', '0']);
assert.equal(zero.status, 0, zero.stderr);
assert.equal(JSON.parse(zero.stdout).checks[0].observed, 0);

console.log('bench guardrails contract test passed');
