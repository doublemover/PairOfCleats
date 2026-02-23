#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildUsrFeatureFlagStateReport } from '../../../src/contracts/validators/usr-matrix.js';
import { ensureTestingEnv } from '../../helpers/test-env.js';

ensureTestingEnv(process.env);

const root = process.cwd();
const policyPath = path.join(root, 'tests', 'lang', 'matrix', 'usr-runtime-config-policy.json');
const policyPayload = JSON.parse(fs.readFileSync(policyPath, 'utf8'));

const sharedLayers = {
  policyFile: {
    'usr.rollout.cutoverEnabled': false
  },
  env: {
    'usr.rollout.shadowReadEnabled': true
  },
  argv: {
    'usr.rollout.cutoverEnabled': true,
    'usr.strictMode.enabled': false
  }
};

const strictReport = buildUsrFeatureFlagStateReport({
  policyPayload,
  layers: sharedLayers,
  strictMode: true
});

assert.equal(strictReport.ok, false, 'expected strict mode report to fail on disallowed runtime flag combinations');
assert(
  strictReport.errors.some((entry) => entry.includes('cutoverEnabled and usr.rollout.shadowReadEnabled')),
  'expected strict mode conflict error when cutover and shadow-read are both enabled'
);
assert(
  strictReport.errors.some((entry) => entry.includes('usr.strictMode.enabled cannot be false')),
  'expected strict mode error when runtime strict-mode flag is disabled'
);
assert.equal(strictReport.payload.status, 'fail', 'expected strict mode report payload status to be fail');

const strictCutoverRow = strictReport.payload.rows.find((row) => row.key === 'usr.rollout.cutoverEnabled');
const strictShadowRow = strictReport.payload.rows.find((row) => row.key === 'usr.rollout.shadowReadEnabled');
assert.equal(strictCutoverRow?.source, 'argv', 'expected argv to win precedence for cutover flag');
assert.equal(strictShadowRow?.source, 'env', 'expected env to remain source for shadow-read flag');

const nonStrictReport = buildUsrFeatureFlagStateReport({
  policyPayload,
  layers: sharedLayers,
  strictMode: false
});

assert.equal(nonStrictReport.ok, true, 'expected non-strict mode to downgrade conflicts to warnings');
assert.equal(nonStrictReport.errors.length, 0, 'expected no blocking errors in non-strict mode for this scenario');
assert(
  nonStrictReport.warnings.some((entry) => entry.includes('cutoverEnabled and usr.rollout.shadowReadEnabled')),
  'expected non-strict warning for cutover/shadow-read conflict'
);
assert.equal(nonStrictReport.payload.status, 'warn', 'expected non-strict report payload status to be warn');

console.log('usr feature-flag state report test passed');
