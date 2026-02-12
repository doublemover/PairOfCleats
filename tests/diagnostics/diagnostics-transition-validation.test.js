#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  validateUsrDiagnosticCode,
  validateUsrReasonCode,
  validateUsrCapabilityTransition,
  buildUsrDiagnosticsTransitionReport,
  validateUsrReport
} from '../../src/contracts/validators/usr.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const failureInjectionPath = path.join(repoRoot, 'lang', 'matrix', 'usr-failure-injection-matrix.json');
const failureInjection = JSON.parse(fs.readFileSync(failureInjectionPath, 'utf8'));
const backcompatPath = path.join(repoRoot, 'lang', 'matrix', 'usr-backcompat-matrix.json');
const backcompat = JSON.parse(fs.readFileSync(backcompatPath, 'utf8'));

const requiredDiagnostics = new Set([
  ...(failureInjection.rows || []).flatMap((row) => row.requiredDiagnostics || []),
  ...(backcompat.rows || []).flatMap((row) => row.requiredDiagnostics || [])
]);

assert.equal(requiredDiagnostics.size > 0, true, 'diagnostics summary lane requires at least one diagnostic code from governed matrices');
for (const code of requiredDiagnostics) {
  const result = validateUsrDiagnosticCode(code, { strictEnum: true });
  assert.equal(result.ok, true, `governed diagnostic must be canonical: ${code} ${result.errors.join('; ')}`);
}

const requiredReasons = new Set((failureInjection.rows || []).flatMap((row) => row.requiredReasonCodes || []));
for (const reasonCode of requiredReasons) {
  const result = validateUsrReasonCode(reasonCode, { strictEnum: true });
  assert.equal(result.ok, true, `governed reason code must be canonical: ${reasonCode} ${result.errors.join('; ')}`);
}

const transitionPass = validateUsrCapabilityTransition({
  from: 'supported',
  to: 'partial',
  diagnostic: 'USR-W-CAPABILITY-DOWNGRADED',
  reasonCode: 'USR-R-PARSER-TIMEOUT'
});
assert.equal(transitionPass.ok, true, `capability transition summary example should pass: ${transitionPass.errors.join('; ')}`);

const transitionFail = validateUsrCapabilityTransition({
  from: 'supported',
  to: 'unsupported',
  diagnostic: 'USR-W-DEGRADED-CAPABILITY'
});
assert.equal(transitionFail.ok, false, 'invalid capability transition diagnostic must fail strict transition validation');

const diagnosticsReport = buildUsrDiagnosticsTransitionReport({
  diagnostics: [...requiredDiagnostics],
  reasonCodes: [...requiredReasons],
  transitions: [
    {
      from: 'supported',
      to: 'partial',
      diagnostic: 'USR-W-CAPABILITY-DOWNGRADED',
      reasonCode: 'USR-R-PARSER-TIMEOUT'
    },
    {
      from: 'partial',
      to: 'unsupported',
      diagnostic: 'USR-E-CAPABILITY-LOST',
      reasonCode: 'USR-R-PARSER-UNAVAILABLE'
    }
  ],
  runId: 'run-usr-diagnostics-summary-001',
  producerId: 'usr-diagnostics-summary-lane',
  lane: 'diagnostics-summary'
});
assert.equal(diagnosticsReport.ok, true, `diagnostics transition report should pass: ${diagnosticsReport.errors.join('; ')}`);

const diagnosticsReportValidation = validateUsrReport('usr-validation-report', diagnosticsReport.payload);
assert.equal(diagnosticsReportValidation.ok, true, `diagnostics summary validation report must satisfy envelope requirements: ${diagnosticsReportValidation.errors.join('; ')}`);

const diagnosticsReportNegative = buildUsrDiagnosticsTransitionReport({
  diagnostics: ['USR-E-NOT-IN-TAXONOMY'],
  transitions: [
    {
      from: 'supported',
      to: 'unsupported',
      diagnostic: 'USR-W-DEGRADED-CAPABILITY'
    }
  ],
  runId: 'run-usr-diagnostics-summary-002',
  lane: 'diagnostics-summary'
});
assert.equal(diagnosticsReportNegative.ok, false, 'diagnostics transition report must fail on unknown diagnostic or invalid transition codes');

console.log('diagnostics transition validation checks passed');
