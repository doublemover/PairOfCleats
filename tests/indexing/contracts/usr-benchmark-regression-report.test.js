#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildUsrBenchmarkRegressionReport,
  evaluateUsrBenchmarkRegression,
  validateUsrBenchmarkMethodology
} from '../../../src/contracts/validators/usr-matrix.js';
import { ensureTestingEnv } from '../../helpers/test-env.js';

ensureTestingEnv(process.env);

const root = process.cwd();
const readMatrix = (fileName) => JSON.parse(
  fs.readFileSync(path.join(root, 'tests', 'lang', 'matrix', fileName), 'utf8')
);

const benchmarkPolicyPayload = readMatrix('usr-benchmark-policy.json');
const sloBudgetsPayload = readMatrix('usr-slo-budgets.json');

const benchmarkRow = structuredClone(benchmarkPolicyPayload.rows[0]);
const minimalBenchmarkPolicy = {
  ...benchmarkPolicyPayload,
  rows: [benchmarkRow]
};

const methodology = validateUsrBenchmarkMethodology({
  benchmarkPolicyPayload: minimalBenchmarkPolicy,
  sloBudgetsPayload
});
assert.equal(methodology.ok, true, 'expected benchmark methodology to validate for canonical row');
assert.equal(methodology.errors.length, 0);

const passEvaluation = evaluateUsrBenchmarkRegression({
  benchmarkPolicyPayload: minimalBenchmarkPolicy,
  sloBudgetsPayload,
  observedResults: {
    [benchmarkRow.id]: {
      p50DurationMs: benchmarkRow.percentileTargets.p50DurationMs - 1000,
      p95DurationMs: benchmarkRow.percentileTargets.p95DurationMs - 1000,
      p99DurationMs: benchmarkRow.percentileTargets.p99DurationMs - 1000,
      variancePct: benchmarkRow.maxVariancePct - 1,
      peakMemoryMb: benchmarkRow.maxPeakMemoryMb - 10
    }
  }
});
assert.equal(passEvaluation.ok, true);
assert.equal(passEvaluation.errors.length, 0);

const failEvaluation = evaluateUsrBenchmarkRegression({
  benchmarkPolicyPayload: minimalBenchmarkPolicy,
  sloBudgetsPayload,
  observedResults: {
    [benchmarkRow.id]: {
      p50DurationMs: benchmarkRow.percentileTargets.p50DurationMs + 1,
      p95DurationMs: benchmarkRow.percentileTargets.p95DurationMs + 1,
      p99DurationMs: benchmarkRow.percentileTargets.p99DurationMs + 1,
      variancePct: benchmarkRow.maxVariancePct + 1,
      peakMemoryMb: benchmarkRow.maxPeakMemoryMb + 1
    }
  }
});
assert.equal(failEvaluation.ok, false);
assert(
  failEvaluation.errors.some((message) => message.includes('p95DurationMs regression')),
  'expected p95 regression error'
);

const report = buildUsrBenchmarkRegressionReport({
  benchmarkPolicyPayload: minimalBenchmarkPolicy,
  sloBudgetsPayload,
  observedResults: {
    [benchmarkRow.id]: {
      p50DurationMs: benchmarkRow.percentileTargets.p50DurationMs + 1,
      p95DurationMs: benchmarkRow.percentileTargets.p95DurationMs + 1,
      p99DurationMs: benchmarkRow.percentileTargets.p99DurationMs + 1,
      variancePct: benchmarkRow.maxVariancePct + 1,
      peakMemoryMb: benchmarkRow.maxPeakMemoryMb + 1
    }
  }
});
assert.equal(report.payload.artifactId, 'usr-benchmark-regression-summary');
assert.equal(report.payload.status, 'fail');
assert.equal(report.payload.summary.rowCount, 1);
assert.equal(report.payload.summary.errorCount > 0, true);

console.log('usr benchmark regression report test passed');
