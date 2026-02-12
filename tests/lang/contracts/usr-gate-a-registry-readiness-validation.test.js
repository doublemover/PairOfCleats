#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  listUsrMatrixRegistryIds,
  validateUsrMatrixRegistry
} from '../../../src/contracts/validators/usr-matrix.js';
import {
  validateUsrDiagnosticCode,
  validateUsrReasonCode
} from '../../../src/contracts/validators/usr.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');

const matrixDir = path.join(repoRoot, 'tests', 'lang', 'matrix');
const ciOrderPath = path.join(repoRoot, 'tests', 'ci', 'ci.order.txt');
const ciLiteOrderPath = path.join(repoRoot, 'tests', 'ci-lite', 'ci-lite.order.txt');
const languageSpecsDir = path.join(repoRoot, 'docs', 'specs', 'usr', 'languages');

const ciOrderText = fs.readFileSync(ciOrderPath, 'utf8');
const ciLiteOrderText = fs.readFileSync(ciLiteOrderPath, 'utf8');

const requiredRegistryIds = [
  'usr-language-profiles',
  'usr-framework-profiles',
  'usr-framework-edge-cases',
  'usr-language-risk-profiles',
  'usr-embedding-bridge-cases',
  'usr-generated-provenance-cases',
  'usr-language-version-policy',
  'usr-language-embedding-policy',
  'usr-parser-runtime-lock',
  'usr-slo-budgets',
  'usr-alert-policies',
  'usr-security-gates',
  'usr-redaction-rules',
  'usr-runtime-config-policy',
  'usr-failure-injection-matrix',
  'usr-fixture-governance',
  'usr-benchmark-policy',
  'usr-threat-model-matrix',
  'usr-waiver-policy',
  'usr-backcompat-matrix'
];

const supportedRegistryIds = new Set(listUsrMatrixRegistryIds());
for (const registryId of requiredRegistryIds) {
  assert.equal(supportedRegistryIds.has(registryId), true, `matrix validator must support registry id: ${registryId}`);

  const matrixPath = path.join(matrixDir, `${registryId}.json`);
  assert.equal(fs.existsSync(matrixPath), true, `required Gate A registry missing file: ${registryId}.json`);

  const payload = JSON.parse(fs.readFileSync(matrixPath, 'utf8'));
  assert.equal(payload.registryId, registryId, `registryId field mismatch for matrix payload: ${registryId}`);

  const validation = validateUsrMatrixRegistry(registryId, payload);
  assert.equal(validation.ok, true, `matrix schema validation failed for ${registryId}: ${validation.errors.join('; ')}`);
}

const languageProfiles = JSON.parse(
  fs.readFileSync(path.join(matrixDir, 'usr-language-profiles.json'), 'utf8')
);
const languageVersionPolicy = JSON.parse(
  fs.readFileSync(path.join(matrixDir, 'usr-language-version-policy.json'), 'utf8')
);
const languageEmbeddingPolicy = JSON.parse(
  fs.readFileSync(path.join(matrixDir, 'usr-language-embedding-policy.json'), 'utf8')
);

const languageIds = new Set((languageProfiles.rows || []).map((row) => row.id));
const versionLanguageIds = new Set((languageVersionPolicy.rows || []).map((row) => row.languageId));
const embeddingLanguageIds = new Set((languageEmbeddingPolicy.rows || []).map((row) => row.languageId));

for (const languageId of languageIds) {
  assert.equal(versionLanguageIds.has(languageId), true, `language-version-policy missing language row: ${languageId}`);
  assert.equal(embeddingLanguageIds.has(languageId), true, `language-embedding-policy missing language row: ${languageId}`);

  const languageSpecPath = path.join(languageSpecsDir, `${languageId}.md`);
  assert.equal(fs.existsSync(languageSpecPath), true, `per-language contract spec missing: docs/specs/usr/languages/${languageId}.md`);
}

const validDiagnostic = validateUsrDiagnosticCode('USR-E-SCHEMA-VIOLATION', { strictEnum: true });
assert.equal(validDiagnostic.ok, true, `canonical diagnostic validator should pass canonical code: ${validDiagnostic.errors.join('; ')}`);

const validReason = validateUsrReasonCode('USR-R-PARSER-TIMEOUT', { strictEnum: true });
assert.equal(validReason.ok, true, `canonical reason-code validator should pass canonical code: ${validReason.errors.join('; ')}`);

const invalidDiagnostic = validateUsrDiagnosticCode('USR-E-NONEXISTENT-CODE', { strictEnum: true });
assert.equal(invalidDiagnostic.ok, false, 'diagnostic validator must reject unknown diagnostic codes in strict mode');

const invalidReason = validateUsrReasonCode('USR-R-NONEXISTENT-CODE', { strictEnum: true });
assert.equal(invalidReason.ok, false, 'reason-code validator must reject unknown reason codes in strict mode');

for (const testId of [
  'decomposed-drift/decomposed-drift-validation',
  'lang/contracts/usr-language-contract-template',
  'lang/contracts/usr-language-contract-matrix-sync-validation',
  'lang/contracts/usr-framework-contract-matrix-sync-validation'
]) {
  assert.equal(ciOrderText.includes(testId), true, `Gate A readiness CI lane missing required validator: ${testId}`);
  if (testId !== 'decomposed-drift/decomposed-drift-validation') {
    assert.equal(ciLiteOrderText.includes(testId), true, `Gate A readiness CI-lite lane missing required validator: ${testId}`);
  }
}

console.log('usr gate-a registry readiness validation checks passed');
