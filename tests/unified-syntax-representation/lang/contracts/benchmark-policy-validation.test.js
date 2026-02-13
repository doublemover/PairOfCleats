#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  validateUsrBenchmarkMethodology,
  evaluateUsrBenchmarkRegression,
  buildUsrBenchmarkRegressionReport
} from '../../../../src/contracts/validators/usr-matrix.js';
import { validateUsrReport } from '../../../../src/contracts/validators/usr.js';
import { resolveCurrentTestLane } from '../../../helpers/lane-resolution.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
const reportLane = resolveCurrentTestLane({ repoRoot, testFilePath: __filename });

const benchmarkPolicyPath = path.join(repoRoot, 'tests', 'lang', 'matrix', 'usr-benchmark-policy.json');
const benchmarkPolicy = JSON.parse(fs.readFileSync(benchmarkPolicyPath, 'utf8'));
const benchmarkRows = Array.isArray(benchmarkPolicy.rows) ? benchmarkPolicy.rows : [];

const sloBudgetsPath = path.join(repoRoot, 'tests', 'lang', 'matrix', 'usr-slo-budgets.json');
const sloBudgets = JSON.parse(fs.readFileSync(sloBudgetsPath, 'utf8'));
const sloRows = Array.isArray(sloBudgets.rows) ? sloBudgets.rows : [];

assert.equal(benchmarkRows.length > 0, true, 'benchmark policy matrix must contain rows');
assert.equal(sloRows.length > 0, true, 'slo budgets matrix must contain rows');

const sloLaneSet = new Set(sloRows.map((row) => row.laneId));
for (const row of benchmarkRows) {
  assert.equal(typeof row.id === 'string' && row.id.length > 0, true, 'benchmark row id must be non-empty');
  assert.equal(row.warmupRuns >= 1, true, `benchmark row warmupRuns must be >= 1: ${row.id}`);
  assert.equal(row.measureRuns >= 3, true, `benchmark row measureRuns must be >= 3: ${row.id}`);
  assert.equal(row.percentileTargets.p50DurationMs <= row.percentileTargets.p95DurationMs, true, `benchmark row percentileTargets must satisfy p50<=p95: ${row.id}`);
  assert.equal(row.percentileTargets.p95DurationMs <= row.percentileTargets.p99DurationMs, true, `benchmark row percentileTargets must satisfy p95<=p99: ${row.id}`);
  if (row.blocking) {
    assert.equal(sloLaneSet.has(row.laneId), true, `blocking benchmark row must have matching slo lane: ${row.id}`);
  }
}

const methodology = validateUsrBenchmarkMethodology({
  benchmarkPolicyPayload: benchmarkPolicy,
  sloBudgetsPayload: sloBudgets
});
assert.equal(methodology.ok, true, `benchmark methodology validation should pass: ${methodology.errors.join('; ')}`);

const observedResults = Object.fromEntries(benchmarkRows.map((row) => [
  row.id,
  {
    p50DurationMs: Math.max(1, row.percentileTargets.p50DurationMs - 20),
    p95DurationMs: Math.max(1, row.percentileTargets.p95DurationMs - 20),
    p99DurationMs: Math.max(1, row.percentileTargets.p99DurationMs - 20),
    variancePct: Math.max(0, row.maxVariancePct - 1),
    peakMemoryMb: Math.max(1, row.maxPeakMemoryMb - 16)
  }
]));

const regression = evaluateUsrBenchmarkRegression({
  benchmarkPolicyPayload: benchmarkPolicy,
  sloBudgetsPayload: sloBudgets,
  observedResults
});
assert.equal(regression.ok, true, `benchmark regression evaluation should pass: ${regression.errors.join('; ')}`);

const regressionReport = buildUsrBenchmarkRegressionReport({
  benchmarkPolicyPayload: benchmarkPolicy,
  sloBudgetsPayload: sloBudgets,
  observedResults,
  runId: 'run-usr-benchmark-policy-001',
  lane: reportLane,
  producerId: 'usr-benchmark-policy-harness'
});
assert.equal(regressionReport.ok, true, `benchmark regression report should pass: ${regressionReport.errors.join('; ')}`);
const reportValidation = validateUsrReport('usr-benchmark-regression-summary', regressionReport.payload);
assert.equal(reportValidation.ok, true, `benchmark regression report payload must validate: ${reportValidation.errors.join('; ')}`);

const firstBlockingRow = benchmarkRows.find((row) => row.blocking);
const negativeRegression = evaluateUsrBenchmarkRegression({
  benchmarkPolicyPayload: benchmarkPolicy,
  sloBudgetsPayload: sloBudgets,
  observedResults: {
    ...observedResults,
    [firstBlockingRow.id]: {
      ...observedResults[firstBlockingRow.id],
      variancePct: firstBlockingRow.maxVariancePct + 5
    }
  }
});
assert.equal(negativeRegression.ok, false, 'benchmark regression evaluation must fail on blocking variance regression');
assert.equal(negativeRegression.errors.some((msg) => msg.includes(firstBlockingRow.id)), true, 'benchmark regression errors must include failing blocking row id');

console.log('usr benchmark policy validation checks passed');
