#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { applyTestEnv } from '../helpers/test-env.js';

const ROOT = process.cwd();
const gatePath = path.join(ROOT, 'tools', 'bench', 'language', 'tooling-lsp-guardrail.js');
const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pairofcleats-tooling-lsp-guardrail-diff-'));
const reportPath = path.join(tempRoot, 'report.json');
const baselinePath = path.join(tempRoot, 'baseline.json');
const jsonPath = path.join(tempRoot, 'tooling-lsp-guardrail.json');

await fs.writeFile(reportPath, `${JSON.stringify({
  schemaVersion: 3,
  metrics: {
    requests: 4,
    enrichmentCoverage: 1,
    fatalFailures: 0,
    timedOut: 0
  },
  sampleCount: 4
}, null, 2)}\n`, 'utf8');

await fs.writeFile(baselinePath, `${JSON.stringify({
  metrics: {
    totalTasks: 3,
    summaryCoverage: 0.75,
    crashRetentionCount: 1,
    topRegressionCount: 2,
    timedOutRatio: 0.5
  }
}, null, 2)}\n`, 'utf8');

try {
  const result = spawnSync(
    process.execPath,
    [gatePath, '--report', reportPath, '--baseline', baselinePath, '--json', jsonPath],
    {
      cwd: ROOT,
      env: applyTestEnv({ syncProcess: false }),
      encoding: 'utf8'
    }
  );

  if (result.status !== 0) {
    console.error('tooling lsp guardrail regression diff test failed');
    console.error(result.stderr || result.stdout || '');
  }
  assert.equal(result.status, 0, `expected tooling lsp guardrail status=0, received ${result.status}`);

  const payload = JSON.parse(await fs.readFile(jsonPath, 'utf8'));
  assert.ok(payload?.regressionDiff && typeof payload.regressionDiff === 'object', 'expected regression diff payload');
  assert.equal(Number.isFinite(Number(payload.regressionDiff.totalTasksDelta)), true, 'expected totalTasks delta');
  assert.equal(Number.isFinite(Number(payload.regressionDiff.timedOutRatioDelta)), true, 'expected timedOutRatio delta');

  console.log('tooling lsp guardrail regression diff test passed');
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}
