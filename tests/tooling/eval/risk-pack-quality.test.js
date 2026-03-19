#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { applyTestEnv } from '../../helpers/test-env.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';
import { createRiskPackEvalFixtureSet } from '../../helpers/risk-pack-eval.js';

applyTestEnv();

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'eval-risk-pack-quality');
const { datasetPath, gatesPath } = await createRiskPackEvalFixtureSet(tempRoot);

const result = spawnSync(
  process.execPath,
  [
    path.join(root, 'tools', 'eval', 'risk-pack.js'),
    '--dataset',
    datasetPath,
    '--gates',
    gatesPath,
    '--enforce-gates'
  ],
  {
    env: process.env,
    encoding: 'utf8'
  }
);

assert.equal(result.status, 0, `expected risk-pack eval gates to pass: ${result.stderr || result.stdout}`);

const payload = JSON.parse(result.stdout || '{}');
assert.equal(payload.summary?.cases, 3, 'expected three golden cases');
assert.equal(payload.summary?.summaryExactRate, 1, 'expected exact summary matches for all goldens');
assert.equal(payload.summary?.flowPrecisionAvg, 1, 'expected exact flow precision across goldens');
assert.equal(payload.summary?.flowRecallAvg, 1, 'expected exact flow recall across goldens');
assert.equal(payload.summary?.capBehaviorRate, 1, 'expected exact capped-output behavior across goldens');
assert.ok(Array.isArray(payload.gates) && payload.gates.every((gate) => gate.pass === true), 'expected all configured gates to pass');

console.log('risk pack quality eval test passed');
