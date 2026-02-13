#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  validateUsrBackcompatMatrixCoverage,
  buildUsrBackcompatMatrixReport
} from '../../src/contracts/validators/usr-matrix.js';
import { validateUsrReport } from '../../src/contracts/validators/usr.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const matrixPath = path.join(repoRoot, 'lang', 'matrix', 'usr-backcompat-matrix.json');
const matrix = JSON.parse(fs.readFileSync(matrixPath, 'utf8'));

const coverage = validateUsrBackcompatMatrixCoverage({
  backcompatMatrixPayload: matrix,
  strictEnum: true
});
assert.equal(coverage.ok, true, `backcompat matrix coverage should pass: ${coverage.errors.join('; ')}`);

const report = buildUsrBackcompatMatrixReport({
  backcompatMatrixPayload: matrix,
  strictEnum: true,
  runId: 'run-backcompat-matrix-validation-001',
  lane: 'backcompat',
  producerId: 'usr-backcompat-lane'
});
assert.equal(report.ok, true, `backcompat matrix report should pass: ${report.errors.join('; ')}`);
const reportValidation = validateUsrReport('usr-backcompat-matrix-results', report.payload);
assert.equal(reportValidation.ok, true, `backcompat matrix report payload must validate: ${reportValidation.errors.join('; ')}`);

const missingScenario = validateUsrBackcompatMatrixCoverage({
  backcompatMatrixPayload: {
    ...matrix,
    rows: (matrix.rows || []).filter((row) => row.id !== 'BC-012')
  },
  strictEnum: true
});
assert.equal(missingScenario.ok, false, 'backcompat matrix validation must fail when required BC scenario IDs are missing');

console.log('backcompat matrix validation checks passed');
