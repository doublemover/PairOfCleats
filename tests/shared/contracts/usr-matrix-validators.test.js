#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  validateUsrMatrixRegistry,
  listUsrMatrixRegistryIds,
  resolveUsrRuntimeConfig,
  validateUsrRuntimeConfigResolution,
  validateUsrFeatureFlagConflicts,
  buildUsrFeatureFlagStateReport
} from '../../../src/contracts/validators/usr-matrix.js';
import { validateUsrReport } from '../../../src/contracts/validators/usr.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const matrixDir = path.join(repoRoot, 'tests', 'lang', 'matrix');

const requiredRegistries = [
  'usr-runtime-config-policy',
  'usr-failure-injection-matrix',
  'usr-fixture-governance',
  'usr-language-profiles',
  'usr-framework-profiles',
  'usr-capability-matrix',
  'usr-ownership-matrix',
  'usr-escalation-policy'
];

for (const registryId of requiredRegistries) {
  const filePath = path.join(matrixDir, `${registryId}.json`);
  const payload = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const result = validateUsrMatrixRegistry(registryId, payload);
  assert.equal(result.ok, true, `${registryId} should validate: ${result.errors.join('; ')}`);
}

const registryIds = listUsrMatrixRegistryIds();
for (const registryId of requiredRegistries) {
  assert.equal(registryIds.includes(registryId), true, `expected validator registry list to include ${registryId}`);
}

const runtimePolicyPath = path.join(matrixDir, 'usr-runtime-config-policy.json');
const runtimePolicy = JSON.parse(fs.readFileSync(runtimePolicyPath, 'utf8'));
const negative = {
  ...runtimePolicy,
  rows: runtimePolicy.rows.map((row, idx) => (idx === 0 ? { ...row, unexpectedFlag: true } : row))
};
const negativeResult = validateUsrMatrixRegistry('usr-runtime-config-policy', negative);
assert.equal(negativeResult.ok, false, 'unknown row key must fail strict matrix validation');

const runtimeResolution = resolveUsrRuntimeConfig({
  policyPayload: runtimePolicy,
  strictMode: true,
  layers: {
    policyFile: {
      'usr.parser.maxSegmentMs': 1800,
      'usr.framework.enableOverlays': false
    },
    env: {
      'usr.parser.maxSegmentMs': '2000',
      'usr.framework.enableOverlays': 'true'
    },
    argv: {
      'usr.parser.maxSegmentMs': 2500
    }
  }
});
assert.equal(runtimeResolution.ok, true, `runtime resolution should pass: ${runtimeResolution.errors.join('; ')}`);
assert.equal(runtimeResolution.values['usr.parser.maxSegmentMs'], 2500, 'argv layer must win precedence');
assert.equal(runtimeResolution.values['usr.framework.enableOverlays'], true, 'env must override policy-file for boolean values');
assert.equal(runtimeResolution.appliedByKey['usr.parser.maxSegmentMs'], 'argv', 'expected argv source tracking');
assert.equal(runtimeResolution.appliedByKey['usr.framework.enableOverlays'], 'env', 'expected env source tracking');

const runtimeStrictFailure = validateUsrRuntimeConfigResolution({
  policyPayload: runtimePolicy,
  strictMode: true,
  layers: {
    env: {
      'usr.parser.maxSegmentMs': '50000'
    }
  }
});
assert.equal(runtimeStrictFailure.ok, false, 'strict disallow violation should fail');
assert.equal(runtimeStrictFailure.errors.some((msg) => msg.includes('usr.parser.maxSegmentMs')), true, 'strict error should reference failing key');

const runtimeWarningOnly = validateUsrRuntimeConfigResolution({
  policyPayload: runtimePolicy,
  strictMode: true,
  layers: {
    env: {
      'usr.reporting.emitRawParserKinds': 'maybe'
    }
  }
});
assert.equal(runtimeWarningOnly.ok, true, 'warn-unknown strict behavior should not fail resolution');
assert.equal(runtimeWarningOnly.warnings.some((msg) => msg.includes('usr.reporting.emitRawParserKinds')), true, 'warn-only row should emit warning');

const runtimeUnknownKey = validateUsrRuntimeConfigResolution({
  policyPayload: runtimePolicy,
  strictMode: false,
  layers: {
    argv: {
      'usr.unknown.key': true
    }
  }
});
assert.equal(runtimeUnknownKey.ok, true, 'unknown keys should be warnings in non-strict mode');
assert.equal(runtimeUnknownKey.warnings.some((msg) => msg.includes('usr.unknown.key')), true, 'unknown key should be surfaced as warning');

const strictFeatureFlagConflict = validateUsrFeatureFlagConflicts({
  values: {
    'usr.rollout.cutoverEnabled': true,
    'usr.rollout.shadowReadEnabled': true,
    'usr.strictMode.enabled': true
  },
  strictMode: true
});
assert.equal(strictFeatureFlagConflict.ok, false, 'strict feature-flag conflict must fail');
assert.equal(strictFeatureFlagConflict.errors.some((msg) => msg.includes('usr.rollout.cutoverEnabled')), true, 'strict conflict must report cutover/shadow conflict');

const nonStrictFeatureFlagConflict = validateUsrFeatureFlagConflicts({
  values: {
    'usr.rollout.cutoverEnabled': true,
    'usr.rollout.shadowReadEnabled': true,
    'usr.strictMode.enabled': true
  },
  strictMode: false
});
assert.equal(nonStrictFeatureFlagConflict.ok, true, 'non-strict feature-flag conflict should downgrade to warning');
assert.equal(nonStrictFeatureFlagConflict.warnings.some((msg) => msg.includes('usr.rollout.cutoverEnabled')), true, 'non-strict conflict warning must mention conflicting flags');

const featureFlagState = buildUsrFeatureFlagStateReport({
  policyPayload: runtimePolicy,
  strictMode: true,
  layers: {
    policyFile: {
      'usr.parser.maxSegmentMs': 1800,
      'usr.framework.enableOverlays': false
    },
    env: {
      'usr.parser.maxSegmentMs': '2200'
    },
    argv: {
      'usr.parser.maxSegmentMs': 2500,
      'usr.rollout.cutoverEnabled': false,
      'usr.rollout.shadowReadEnabled': true
    }
  },
  runId: 'run-usr-feature-flag-state-001',
  lane: 'ci-lite',
  producerId: 'usr-matrix-validator-tests'
});
assert.equal(featureFlagState.ok, true, `feature-flag state report should succeed: ${featureFlagState.errors.join('; ')}`);
assert.equal(featureFlagState.values['usr.parser.maxSegmentMs'], 2500, 'feature-flag state report must preserve runtime precedence resolution');
assert.equal(featureFlagState.appliedByKey['usr.parser.maxSegmentMs'], 'argv', 'feature-flag state report must preserve runtime source attribution');
assert.equal(featureFlagState.payload.rows.length, runtimePolicy.rows.length, 'feature-flag state rows must cover every runtime policy key');
const featureFlagReportValidation = validateUsrReport('usr-feature-flag-state', featureFlagState.payload);
assert.equal(featureFlagReportValidation.ok, true, `feature-flag state payload must validate: ${featureFlagReportValidation.errors.join('; ')}`);

const featureFlagStateConflict = buildUsrFeatureFlagStateReport({
  policyPayload: runtimePolicy,
  strictMode: true,
  layers: {
    argv: {
      'usr.rollout.cutoverEnabled': true,
      'usr.rollout.shadowReadEnabled': true
    }
  },
  runId: 'run-usr-feature-flag-state-002',
  lane: 'ci'
});
assert.equal(featureFlagStateConflict.ok, false, 'feature-flag state report must fail strict-mode conflicting flags');
assert.equal(featureFlagStateConflict.payload.status, 'fail', 'feature-flag conflict report must carry fail status');
console.log('usr matrix validator tests passed');


