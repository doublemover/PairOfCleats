#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  validateUsrSecurityGateControls,
  buildUsrSecurityGateValidationReport
} from '../../../src/contracts/validators/usr-matrix.js';
import { validateUsrReport } from '../../../src/contracts/validators/usr.js';
import { resolveCurrentTestLane } from '../../helpers/lane-resolution.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const reportLane = resolveCurrentTestLane({ repoRoot, testFilePath: __filename });

const securityGates = JSON.parse(
  fs.readFileSync(path.join(repoRoot, 'tests', 'lang', 'matrix', 'usr-security-gates.json'), 'utf8')
);
const redactionRules = JSON.parse(
  fs.readFileSync(path.join(repoRoot, 'tests', 'lang', 'matrix', 'usr-redaction-rules.json'), 'utf8')
);

const gateResults = Object.fromEntries((securityGates.rows || []).map((row) => [
  row.check,
  { pass: true }
]));
const redactionResults = Object.fromEntries((redactionRules.rows || []).map((row) => [
  row.class,
  { pass: true, misses: 0 }
]));

const evaluation = validateUsrSecurityGateControls({
  securityGatesPayload: securityGates,
  redactionRulesPayload: redactionRules,
  gateResults,
  redactionResults
});
assert.equal(evaluation.ok, true, `security-gate controls should pass: ${evaluation.errors.join('; ')}`);
assert.equal(evaluation.rows.some((row) => row.rowType === 'security-gate'), true, 'security-gate control evaluation must include security-gate rows');
assert.equal(evaluation.rows.some((row) => row.rowType === 'redaction-rule'), true, 'security-gate control evaluation must include redaction-rule rows');

const validationReport = buildUsrSecurityGateValidationReport({
  securityGatesPayload: securityGates,
  redactionRulesPayload: redactionRules,
  gateResults,
  redactionResults,
  runId: 'run-usr-security-gate-validation-001',
  lane: reportLane,
  producerId: 'usr-security-gate-harness'
});
assert.equal(validationReport.ok, true, `security-gate validation report should pass: ${validationReport.errors.join('; ')}`);
const reportValidation = validateUsrReport('usr-validation-report', validationReport.payload);
assert.equal(reportValidation.ok, true, `security-gate validation report payload must validate: ${reportValidation.errors.join('; ')}`);

const advisoryOnly = validateUsrSecurityGateControls({
  securityGatesPayload: securityGates,
  redactionRulesPayload: redactionRules,
  gateResults: {
    ...gateResults,
    report_payload_size_within_cap: { pass: false }
  },
  redactionResults
});
assert.equal(advisoryOnly.ok, true, 'non-blocking security-gate failures should remain advisory');
assert.equal(advisoryOnly.errors.length, 0, 'non-blocking security-gate failures should not emit blocking errors');
assert.equal(advisoryOnly.warnings.some((message) => message.includes('security-gate-report-size-cap')), true, 'non-blocking security-gate failures must emit warnings');

const failingEvaluation = validateUsrSecurityGateControls({
  securityGatesPayload: securityGates,
  redactionRulesPayload: redactionRules,
  gateResults: {
    ...gateResults,
    runtime_exec_disallowed: { pass: false }
  },
  redactionResults: {
    ...redactionResults,
    'private-key-material': { pass: false, misses: 2 }
  }
});
assert.equal(failingEvaluation.ok, false, 'blocking security/redaction failures should fail validation');
assert.equal(failingEvaluation.errors.some((message) => message.includes('security-gate-runtime-sandbox')), true, 'blocking failures should include failed security gate id');
assert.equal(failingEvaluation.errors.some((message) => message.includes('redact-private-key')), true, 'blocking failures should include failed redaction rule id');

console.log('usr security gate validation checks passed');
