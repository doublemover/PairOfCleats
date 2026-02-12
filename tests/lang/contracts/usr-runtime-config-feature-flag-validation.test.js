#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  resolveUsrRuntimeConfig,
  buildUsrFeatureFlagStateReport
} from '../../../src/contracts/validators/usr-matrix.js';
import { validateUsrReport } from '../../../src/contracts/validators/usr.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');

const runtimePolicyPath = path.join(repoRoot, 'tests', 'lang', 'matrix', 'usr-runtime-config-policy.json');
const runtimePolicy = JSON.parse(fs.readFileSync(runtimePolicyPath, 'utf8'));

const requiredRuntimeKeys = [
  'usr.fallback.allowHeuristic',
  'usr.framework.enableOverlays',
  'usr.parser.maxSegmentMs',
  'usr.parser.selectionMode',
  'usr.risk.interproceduralEnabled',
  'usr.rollout.cutoverEnabled',
  'usr.rollout.shadowReadEnabled',
  'usr.strictMode.enabled'
];

const policyRows = Array.isArray(runtimePolicy.rows) ? runtimePolicy.rows : [];
const policyKeys = new Set(policyRows.map((row) => row.key));
for (const key of requiredRuntimeKeys) {
  assert.equal(policyKeys.has(key), true, `runtime config policy must include required key: ${key}`);
}

const precedenceResolution = resolveUsrRuntimeConfig({
  policyPayload: runtimePolicy,
  strictMode: true,
  layers: {
    policyFile: {
      'usr.parser.maxSegmentMs': 1800,
      'usr.framework.enableOverlays': false
    },
    env: {
      'usr.parser.maxSegmentMs': '2200',
      'usr.framework.enableOverlays': 'true'
    },
    argv: {
      'usr.parser.maxSegmentMs': 2500
    }
  }
});
assert.equal(precedenceResolution.ok, true, `runtime config precedence resolution should pass: ${precedenceResolution.errors.join('; ')}`);
assert.equal(precedenceResolution.values['usr.parser.maxSegmentMs'], 2500, 'argv must win runtime config precedence');
assert.equal(precedenceResolution.appliedByKey['usr.parser.maxSegmentMs'], 'argv', 'runtime config resolution must record argv precedence source');
assert.equal(precedenceResolution.values['usr.framework.enableOverlays'], true, 'env boolean coercion must override policy file value');

const featureFlagState = buildUsrFeatureFlagStateReport({
  policyPayload: runtimePolicy,
  strictMode: true,
  layers: {
    policyFile: {
      'usr.rollout.cutoverEnabled': false,
      'usr.rollout.shadowReadEnabled': true
    }
  },
  runId: 'run-usr-runtime-feature-flag-001',
  lane: 'ci-lite',
  producerId: 'usr-runtime-feature-flag-harness'
});
assert.equal(featureFlagState.ok, true, `feature-flag state build should pass: ${featureFlagState.errors.join('; ')}`);
assert.equal(featureFlagState.payload.rows.length, policyRows.length, 'feature-flag state artifact must include one row per runtime policy key');

const rowKeySet = new Set(featureFlagState.payload.rows.map((row) => row.key));
for (const key of requiredRuntimeKeys) {
  assert.equal(rowKeySet.has(key), true, `feature-flag state artifact rows must include required runtime key: ${key}`);
}

const featureFlagReportValidation = validateUsrReport('usr-feature-flag-state', featureFlagState.payload);
assert.equal(featureFlagReportValidation.ok, true, `feature-flag state payload must validate: ${featureFlagReportValidation.errors.join('; ')}`);

const strictConflict = buildUsrFeatureFlagStateReport({
  policyPayload: runtimePolicy,
  strictMode: true,
  layers: {
    argv: {
      'usr.rollout.cutoverEnabled': true,
      'usr.rollout.shadowReadEnabled': true
    }
  },
  runId: 'run-usr-runtime-feature-flag-002',
  lane: 'ci'
});
assert.equal(strictConflict.ok, false, 'strict runtime feature-flag conflict must fail');
assert.equal(strictConflict.payload.status, 'fail', 'strict runtime feature-flag conflict payload must carry fail status');
assert.equal(strictConflict.errors.some((msg) => msg.includes('usr.rollout.cutoverEnabled')), true, 'strict conflict must surface conflicting flag pair');

const advisoryConflict = buildUsrFeatureFlagStateReport({
  policyPayload: runtimePolicy,
  strictMode: false,
  layers: {
    argv: {
      'usr.rollout.cutoverEnabled': true,
      'usr.rollout.shadowReadEnabled': true
    }
  },
  runId: 'run-usr-runtime-feature-flag-003',
  lane: 'ci-lite'
});
assert.equal(advisoryConflict.ok, true, 'non-strict runtime feature-flag conflict should downgrade to warning');
assert.equal(advisoryConflict.payload.status, 'warn', 'non-strict runtime feature-flag conflict payload must carry warn status');
assert.equal(advisoryConflict.warnings.some((msg) => msg.includes('usr.rollout.cutoverEnabled')), true, 'non-strict conflict warning must mention conflicting flags');

console.log('usr runtime config and feature-flag validation checks passed');
