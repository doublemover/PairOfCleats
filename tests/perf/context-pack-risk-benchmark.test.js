#!/usr/bin/env node
import assert from 'node:assert/strict';
import { evaluateRiskPackDataset } from '../../tools/eval/risk-pack.js';
import { applyTestEnv } from '../helpers/test-env.js';
import { resolveTestCachePath } from '../helpers/test-cache.js';
import { createRiskPackEvalFixtureSet } from '../helpers/risk-pack-eval.js';

applyTestEnv();

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'perf-risk-pack-benchmark');
const { datasetPath, gatesPath } = await createRiskPackEvalFixtureSet(tempRoot);
const payload = await evaluateRiskPackDataset({
  datasetPath,
  gatesPath
});

assert.equal(payload.summary?.cases, 3, 'expected benchmark eval to cover all risk-pack cases');
assert.equal(payload.summary?.cappedCases, 1, 'expected one capped benchmark case');
assert.ok(Number.isFinite(payload.summary?.avgElapsedMs), 'expected average elapsed time metric');
assert.ok(Number.isFinite(payload.summary?.maxPeakRssMb), 'expected peak RSS metric');
assert.equal(payload.summary?.capBehaviorRate, 1, 'expected capped-output benchmark behavior to match golden expectations');

console.log('context pack risk benchmark test passed');
