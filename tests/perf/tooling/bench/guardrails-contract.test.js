#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

import { applyTestEnv } from '../../../helpers/test-env.js';

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
const passing = spawnSync(
  process.execPath,
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
  { cwd: root, env: testEnv, encoding: 'utf8' }
);
if (passing.status !== 0) {
  console.error(passing.stdout || '');
  console.error(passing.stderr || '');
  process.exit(passing.status ?? 1);
}
const passPayload = JSON.parse(String(passing.stdout || '{}'));
assert.equal(passPayload.ok, true, 'expected guardrails pass');

const failing = spawnSync(
  process.execPath,
  [
    scriptPath,
    '--report',
    reportPath,
    '--max-stage-duration-ms',
    '80',
    '--json'
  ],
  { cwd: root, env: testEnv, encoding: 'utf8' }
);
assert.equal(failing.status, 1, 'expected guardrails failure exit code');
const failPayload = JSON.parse(String(failing.stdout || '{}'));
assert.equal(failPayload.ok, false, 'expected failure payload');
assert.ok(Array.isArray(failPayload.failedChecks) && failPayload.failedChecks.length > 0, 'expected failing checks');

console.log('bench guardrails contract test passed');
