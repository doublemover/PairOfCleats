#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  validateUsrMatrixRegistry,
  listUsrMatrixRegistryIds,
  resolveUsrRuntimeConfig,
  validateUsrRuntimeConfigResolution
} from '../../../src/contracts/validators/usr-matrix.js';

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

console.log('usr matrix validator tests passed');
