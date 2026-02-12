#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  evaluateUsrFailureInjectionScenarios,
  buildUsrFailureInjectionReport
} from '../../../src/contracts/validators/usr-matrix.js';
import {
  validateUsrDiagnosticCode,
  validateUsrReasonCode,
  validateUsrReport
} from '../../../src/contracts/validators/usr.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');

const matrixPath = path.join(repoRoot, 'tests', 'lang', 'matrix', 'usr-failure-injection-matrix.json');
const schemaDir = path.join(repoRoot, 'docs', 'schemas', 'usr');
const matrix = JSON.parse(fs.readFileSync(matrixPath, 'utf8'));
const matrixRows = Array.isArray(matrix.rows) ? matrix.rows : [];

assert.equal(matrixRows.length > 0, true, 'failure-injection matrix must contain rows');

const requiredFaultClasses = [
  'mapping-conflict',
  'parser-timeout',
  'parser-unavailable',
  'redaction-failure',
  'resolution-ambiguity-overflow',
  'resource-budget-breach',
  'security-gate-failure',
  'serialization-corruption'
];

const matrixFaultClasses = new Set(matrixRows.map((row) => row.faultClass));
for (const faultClass of requiredFaultClasses) {
  assert.equal(matrixFaultClasses.has(faultClass), true, `failure-injection matrix must include required fault class: ${faultClass}`);
}

for (const row of matrixRows) {
  assert.equal(row.blocking, true, `failure-injection row must be blocking for current contract surface: ${row.id}`);
  assert.equal(Number.isInteger(row.rollbackTriggerConsecutiveFailures), true, `rollbackTriggerConsecutiveFailures must be integer: ${row.id}`);
  assert.equal(row.rollbackTriggerConsecutiveFailures >= 1, true, `rollbackTriggerConsecutiveFailures must be >= 1: ${row.id}`);
  const recoveryArtifacts = Array.isArray(row.requiredRecoveryArtifacts) ? row.requiredRecoveryArtifacts : [];
  assert.equal(recoveryArtifacts.length > 0, true, `requiredRecoveryArtifacts must be non-empty: ${row.id}`);
  assert.equal(recoveryArtifacts.includes('usr-failure-injection-report.json'), true, `requiredRecoveryArtifacts must include usr-failure-injection-report.json: ${row.id}`);
  assert.equal(recoveryArtifacts.includes('usr-rollback-drill-report.json'), true, `requiredRecoveryArtifacts must include usr-rollback-drill-report.json: ${row.id}`);
  for (const artifactFileName of recoveryArtifacts) {
    const schemaPath = path.join(schemaDir, `${artifactFileName.replace(/\.json$/, '')}.schema.json`);
    assert.equal(fs.existsSync(schemaPath), true, `required recovery artifact schema missing: ${artifactFileName} (${row.id})`);
  }
  for (const diagnostic of row.requiredDiagnostics || []) {
    const diagnosticValidation = validateUsrDiagnosticCode(diagnostic, { strictEnum: true });
    assert.equal(diagnosticValidation.ok, true, `${row.id} required diagnostic must be canonical: ${diagnosticValidation.errors.join('; ')}`);
  }
  for (const reasonCode of row.requiredReasonCodes || []) {
    const reasonValidation = validateUsrReasonCode(reasonCode, { strictEnum: true });
    assert.equal(reasonValidation.ok, true, `${row.id} required reason code must be canonical: ${reasonValidation.errors.join('; ')}`);
  }
}

const strictScenarioResults = Object.fromEntries(matrixRows.map((row) => [
  row.id,
  {
    outcome: row.strictExpectedOutcome,
    diagnostics: row.requiredDiagnostics,
    reasonCodes: row.requiredReasonCodes,
    recoveryEvidence: Array.from(new Set([...(row.requiredRecoveryArtifacts || []), `recovery-${row.id}`]))
  }
]));

const nonStrictScenarioResults = Object.fromEntries(matrixRows.map((row) => [
  row.id,
  {
    outcome: row.nonStrictExpectedOutcome,
    diagnostics: row.requiredDiagnostics,
    reasonCodes: row.requiredReasonCodes,
    recoveryEvidence: Array.from(new Set([...(row.requiredRecoveryArtifacts || []), `recovery-${row.id}`]))
  }
]));

const scenarioEvaluation = evaluateUsrFailureInjectionScenarios({
  matrixPayload: matrix,
  strictScenarioResults,
  nonStrictScenarioResults,
  strictEnum: true
});
assert.equal(scenarioEvaluation.ok, true, `failure-injection scenario evaluation should pass: ${scenarioEvaluation.errors.join('; ')}`);
assert.equal(scenarioEvaluation.rows.length, matrixRows.length, 'failure-injection evaluator rows must match matrix rows');

const failureReport = buildUsrFailureInjectionReport({
  matrixPayload: matrix,
  strictScenarioResults,
  nonStrictScenarioResults,
  strictMode: true,
  runId: 'run-usr-failure-injection-001',
  lane: 'ci',
  producerId: 'usr-failure-injection-harness'
});
assert.equal(failureReport.ok, true, `failure-injection report should pass: ${failureReport.errors.join('; ')}`);
assert.equal(failureReport.payload.summary.blockingFailureCount, 0, 'passing failure-injection report must have zero blocking failures');
const reportValidation = validateUsrReport('usr-failure-injection-report', failureReport.payload);
assert.equal(reportValidation.ok, true, `failure-injection report payload must validate: ${reportValidation.errors.join('; ')}`);

const strictMismatchResults = {
  ...strictScenarioResults,
  'fi-redaction-failure': {
    ...strictScenarioResults['fi-redaction-failure'],
    outcome: 'degrade-with-diagnostics'
  }
};

const mismatchEvaluation = evaluateUsrFailureInjectionScenarios({
  matrixPayload: matrix,
  strictScenarioResults: strictMismatchResults,
  nonStrictScenarioResults,
  strictEnum: true
});
assert.equal(mismatchEvaluation.ok, false, 'failure-injection evaluator must fail when strict scenario outcomes drift from matrix expectations');
assert.equal(mismatchEvaluation.errors.some((msg) => msg.includes('fi-redaction-failure')), true, 'failure-injection evaluator mismatch errors must include scenario ID');

const mismatchReport = buildUsrFailureInjectionReport({
  matrixPayload: matrix,
  strictScenarioResults: strictMismatchResults,
  nonStrictScenarioResults,
  strictMode: true,
  runId: 'run-usr-failure-injection-002',
  lane: 'ci'
});
assert.equal(mismatchReport.ok, false, 'failure-injection report should fail when strict scenario outcomes drift');
assert.equal(mismatchReport.payload.status, 'fail', 'failure-injection mismatch report must emit fail status');
assert.equal(mismatchReport.payload.summary.blockingFailureCount > 0, true, 'failure-injection mismatch report must emit blocking failure count');

console.log('usr failure-injection validation checks passed');
