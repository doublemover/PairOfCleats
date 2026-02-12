#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  validateUsrBackcompatMatrixCoverage,
  buildUsrBackcompatMatrixReport
} from '../../../src/contracts/validators/usr-matrix.js';
import { validateUsrReport } from '../../../src/contracts/validators/usr.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');

const unifiedSpecPath = path.join(repoRoot, 'docs', 'specs', 'unified-syntax-representation.md');
const ciOrderPath = path.join(repoRoot, 'tests', 'ci', 'ci.order.txt');
const ciLiteOrderPath = path.join(repoRoot, 'tests', 'ci-lite', 'ci-lite.order.txt');
const backcompatMatrixPath = path.join(repoRoot, 'tests', 'lang', 'matrix', 'usr-backcompat-matrix.json');

const unifiedSpecText = fs.readFileSync(unifiedSpecPath, 'utf8');
const ciOrderText = fs.readFileSync(ciOrderPath, 'utf8');
const ciLiteOrderText = fs.readFileSync(ciLiteOrderPath, 'utf8');
const backcompatMatrix = JSON.parse(fs.readFileSync(backcompatMatrixPath, 'utf8'));

const requiredSectionAnchors = [
  '### 33.1 Diagnostic code taxonomy',
  '### 33.2 Resolution envelope reason code taxonomy',
  '### 34.1 `USRDocumentV1`',
  '### 34.2 `USRSegmentV1`',
  '### 34.3 `USRNodeV1`',
  '### 35.1 Canonicalization rules (applies to all framework examples)',
  '### 35.11 Framework-specific edge-case canonicalization checklist',
  '### 36.1 Producer/reader compatibility matrix',
  '### 36.7 Pairwise scenario expansion rules',
  '### 36.8 Mandatory reporting dimensions'
];

for (const anchor of requiredSectionAnchors) {
  assert.equal(unifiedSpecText.includes(anchor), true, `unified USR spec missing required section 33-36 anchor: ${anchor}`);
}

const requiredCiTests = [
  'lang/contracts/usr-diagnostic-remediation-routing-validation',
  'lang/contracts/usr-canonical-example-validation',
  'lang/contracts/usr-cross-language-canonical-bundle-coherence-validation',
  'lang/contracts/usr-framework-canonicalization',
  'lang/contracts/usr-f5-hard-requirements-validation',
  'backcompat/backcompat-matrix-validation'
];

const ciOnlyTests = new Set(['backcompat/backcompat-matrix-validation']);

for (const testId of requiredCiTests) {
  assert.equal(ciOrderText.includes(testId), true, `ci order must include F.5 hard-requirements test: ${testId}`);
  if (!ciOnlyTests.has(testId)) {
    assert.equal(ciLiteOrderText.includes(testId), true, `ci-lite order must include F.5 hard-requirements test: ${testId}`);
  }
}

const matrixRows = Array.isArray(backcompatMatrix.rows) ? backcompatMatrix.rows : [];
const expectedBaseIds = new Set(Array.from({ length: 12 }, (_, index) => `BC-${String(index + 1).padStart(3, '0')}`));
const seenBaseIds = new Set(matrixRows.map((row) => row.id));

for (const baseId of expectedBaseIds) {
  assert.equal(seenBaseIds.has(baseId), true, `backcompat matrix missing required section 36 base scenario: ${baseId}`);
}

const hasPairwiseExpansion = matrixRows.some((row) => Array.isArray(row.readerVersions) && row.readerVersions.length > 1);
assert.equal(hasPairwiseExpansion, true, 'backcompat matrix must include pairwise-expanded scenario coverage (readerVersions length > 1)');

const coverage = validateUsrBackcompatMatrixCoverage({
  backcompatMatrixPayload: backcompatMatrix,
  strictEnum: true
});
assert.equal(coverage.ok, true, `backcompat matrix coverage validation should pass: ${coverage.errors.join('; ')}`);

const report = buildUsrBackcompatMatrixReport({
  backcompatMatrixPayload: backcompatMatrix,
  strictEnum: true,
  runId: 'run-usr-f5-hard-reqs-001',
  lane: 'ci',
  producerId: 'usr-f5-hard-requirements-validator'
});
assert.equal(report.ok, true, `backcompat matrix report generation should pass: ${report.errors.join('; ')}`);

const reportValidation = validateUsrReport('usr-backcompat-matrix-results', report.payload);
assert.equal(reportValidation.ok, true, `backcompat matrix report payload must validate: ${reportValidation.errors.join('; ')}`);
assert.equal(report.payload.summary.strictScenarioCount > 0, true, 'backcompat report must include strict scenario rollup');
assert.equal(report.payload.summary.nonStrictScenarioCount > 0, true, 'backcompat report must include non-strict scenario rollup');

console.log('usr F.5 hard requirements validation checks passed');
