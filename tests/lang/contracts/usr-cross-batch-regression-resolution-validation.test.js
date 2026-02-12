#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateUsrBenchmarkRegression } from '../../../src/contracts/validators/usr-matrix.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');

const matrixDir = path.join(repoRoot, 'tests', 'lang', 'matrix');
const batchShards = JSON.parse(fs.readFileSync(path.join(matrixDir, 'usr-language-batch-shards.json'), 'utf8'));
const benchmarkPolicy = JSON.parse(fs.readFileSync(path.join(matrixDir, 'usr-benchmark-policy.json'), 'utf8'));
const sloBudgets = JSON.parse(fs.readFileSync(path.join(matrixDir, 'usr-slo-budgets.json'), 'utf8'));

const ciOrderText = fs.readFileSync(path.join(repoRoot, 'tests', 'ci', 'ci.order.txt'), 'utf8');
const ciLiteOrderText = fs.readFileSync(path.join(repoRoot, 'tests', 'ci-lite', 'ci-lite.order.txt'), 'utf8');

const shardRows = Array.isArray(batchShards.rows) ? batchShards.rows : [];
const benchmarkRows = Array.isArray(benchmarkPolicy.rows) ? benchmarkPolicy.rows : [];

const integrationShard = shardRows.find((row) => row.id === 'B8');
assert.equal(Boolean(integrationShard), true, 'language-batch shards must define B8 cross-batch integration shard');
assert.equal(integrationShard.scopeType, 'integration', 'B8 shard must be integration scope');
assert.equal(Array.isArray(integrationShard.dependsOn), true, 'B8 shard must declare dependencies');
for (const dependency of ['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7']) {
  assert.equal(integrationShard.dependsOn.includes(dependency), true, `B8 shard must depend on ${dependency}`);
}
assert.equal(String(integrationShard.notes || '').toLowerCase().includes('regression'), true, 'B8 shard notes must include regression intent');

const mixedRepoRow = benchmarkRows.find((row) => row.datasetClass === 'mixed-repo');
const languageBatchRow = benchmarkRows.find((row) => row.datasetClass === 'language-batch');
assert.equal(Boolean(mixedRepoRow), true, 'benchmark policy must include mixed-repo dataset row');
assert.equal(Boolean(languageBatchRow), true, 'benchmark policy must include language-batch dataset row');
assert.equal(mixedRepoRow.laneId, 'ci-long', 'mixed-repo benchmark must execute on ci-long lane');
assert.equal(languageBatchRow.laneId, 'ci-long', 'language-batch benchmark must execute on ci-long lane');

const observedResults = Object.fromEntries(benchmarkRows.map((row) => [
  row.id,
  {
    p50DurationMs: Math.max(1, row.percentileTargets.p50DurationMs - 25),
    p95DurationMs: Math.max(1, row.percentileTargets.p95DurationMs - 25),
    p99DurationMs: Math.max(1, row.percentileTargets.p99DurationMs - 25),
    variancePct: Math.max(0, row.maxVariancePct - 1),
    peakMemoryMb: Math.max(1, row.maxPeakMemoryMb - 32)
  }
]));

const regressionEval = evaluateUsrBenchmarkRegression({
  benchmarkPolicyPayload: benchmarkPolicy,
  sloBudgetsPayload: sloBudgets,
  observedResults
});
assert.equal(regressionEval.ok, true, `cross-batch regression baseline should pass benchmark regression evaluation: ${regressionEval.errors.join('; ')}`);

for (const testId of [
  'lang/contracts/usr-benchmark-policy-validation',
  'lang/contracts/usr-mixed-repo-integration-validation',
  'lang/contracts/usr-cross-language-canonical-bundle-coherence-validation'
]) {
  assert.equal(ciOrderText.includes(testId), true, `ci lane must include B8 regression readiness validator: ${testId}`);
  assert.equal(ciLiteOrderText.includes(testId), true, `ci-lite lane must include B8 regression readiness validator: ${testId}`);
}

console.log('usr cross-batch regression resolution validation checks passed');
