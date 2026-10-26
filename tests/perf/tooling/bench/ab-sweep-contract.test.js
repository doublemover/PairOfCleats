#!/usr/bin/env node
import assert from 'node:assert/strict';
import { AB_SWEEP_REPORT_VERSION } from '../../../../tools/bench/ab-sweep-admission.js';
import fs from 'node:fs/promises';
import path from 'node:path';

import { applyTestEnv } from '../../../helpers/test-env.js';
import { runNode } from '../../../helpers/run-node.js';


const testEnv = applyTestEnv({ testing: '1' });

const root = process.cwd();
const fixtureScript = path.join(root, 'tests', 'fixtures', 'ab-sweep', 'knob-aware.js');

const scriptPath = path.join(root, 'tools', 'bench', 'ab-sweep.js');
const result = runNode(
  [
    scriptPath,
    '--scripts',
    fixtureScript,
    '--cpu-tokens',
    '4,6',
    '--worker-counts',
    '1,2',
    '--write-concurrency',
    '2,3'
  ],
  'bench ab sweep contract',
  root,
  testEnv,
  { stdio: 'pipe', allowFailure: true, timeoutMs: 20000, spawnOptions: { maxBuffer: 2 * 1024 * 1024 } }
);

if (result.status !== 0) {
  console.error(result.stdout || '');
  console.error(result.stderr || '');
  process.exit(result.status ?? 1);
}

const report = JSON.parse(String(result.stdout || '{}'));
assert.equal(report.schemaVersion, AB_SWEEP_REPORT_VERSION);
assert.ok(report.matrix?.runCount >= 4, 'expected sweep matrix runs');
assert.ok(Array.isArray(report.runs) && report.runs.length === report.matrix.runCount, 'expected run rows');
assert.ok(report.recommendation?.bestRunId, 'expected recommendation output');
assert.ok(report.recommendation?.bestConfig, 'expected recommended config');
assert.equal(typeof report.recommendation.score, 'number');

assert.equal(report.matrix.runCount, 8);
assert.equal(report.coverage.eligibleVariants, 8);
assert.equal(report.recommendation.qualificationScope, 'fixture');
assert.deepEqual(report.recommendation.bestConfig, { writeConcurrency: 3, cpuTokens: 6, workerCounts: 2 });
assert.equal(report.recommendation.score, 1000 / 36);
for (const row of report.runs) {
  const raw = await fs.readFile(row.reportPath);
  const { createHash } = await import('node:crypto');
  assert.equal(row.reportReceipt.sha256, 'sha256:' + createHash('sha256').update(raw).digest('hex'));
  const receipt = JSON.parse(raw);
  assert.equal(receipt.experiment.experimentId, report.experimentId);
  assert.equal(receipt.experiment.variantId, row.experiment.variantId);
  assert.equal(row.results.length, 1);
  assert.equal(row.eligibility.eligible, true);
}

const failed = runNode([scriptPath, '--scripts', path.join(root, 'tests', 'fixtures', 'ab-sweep', 'nonzero.js'),
  '--timeout-ms', '3000'], 'bench ab sweep nonzero receipt', root, testEnv,
{ stdio: 'pipe', allowFailure: true, timeoutMs: 10000 });
assert.equal(failed.status, 1);
const failure = JSON.parse(failed.stdout);
assert.equal(failure.recommendation, null);
assert.equal(failure.outcome, 'insufficient-qualified-work');
assert.equal(failure.runs[0].summary.error, 1);
assert.equal(failure.runs[0].results[0].exitCode, 7);
assert.match(failure.runs[0].results[0].stderrTail, /ab-sweep-independent-nonzero-witness/u);
assert.ok(failure.runs[0].eligibility.reasons.includes('child-process-failed'));
const originalRaw = await fs.readFile(report.runs[0].reportPath);
assert.notEqual(path.dirname(report.runs[0].reportPath), path.dirname(failure.runs[0].reportPath));
assert.equal('sha256:' + (await import('node:crypto')).createHash('sha256').update(originalRaw).digest('hex'), report.runs[0].reportReceipt.sha256,
  'a second invocation must preserve the first invocation raw bytes');
console.log('bench ab sweep contract test passed');
