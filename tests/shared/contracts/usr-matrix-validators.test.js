#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  validateUsrMatrixRegistry,
  listUsrMatrixRegistryIds
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

console.log('usr matrix validator tests passed');
