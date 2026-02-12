#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  validateUsrWaiverPolicyControls,
  buildUsrWaiverActiveReport,
  buildUsrWaiverExpiryReport
} from '../../../src/contracts/validators/usr-matrix.js';
import { validateUsrReport } from '../../../src/contracts/validators/usr.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');

const waiverPolicyPath = path.join(repoRoot, 'tests', 'lang', 'matrix', 'usr-waiver-policy.json');
const waiverPolicy = JSON.parse(fs.readFileSync(waiverPolicyPath, 'utf8'));

const ownershipMatrixPath = path.join(repoRoot, 'tests', 'lang', 'matrix', 'usr-ownership-matrix.json');
const ownershipMatrix = JSON.parse(fs.readFileSync(ownershipMatrixPath, 'utf8'));

const escalationPolicyPath = path.join(repoRoot, 'tests', 'lang', 'matrix', 'usr-escalation-policy.json');
const escalationPolicy = JSON.parse(fs.readFileSync(escalationPolicyPath, 'utf8'));

const baselineValidation = validateUsrWaiverPolicyControls({
  waiverPolicyPayload: waiverPolicy,
  ownershipMatrixPayload: ownershipMatrix,
  escalationPolicyPayload: escalationPolicy,
  evaluationTime: '2026-02-12T00:00:00Z',
  strictMode: true
});
assert.equal(baselineValidation.ok, true, `waiver-policy baseline validation should pass: ${baselineValidation.errors.join('; ')}`);

const activeReport = buildUsrWaiverActiveReport({
  waiverPolicyPayload: waiverPolicy,
  ownershipMatrixPayload: ownershipMatrix,
  escalationPolicyPayload: escalationPolicy,
  evaluationTime: '2026-02-12T00:00:00Z',
  strictMode: true,
  runId: 'run-usr-waiver-active-report-001',
  lane: 'ci',
  producerId: 'usr-waiver-policy-harness'
});
assert.equal(activeReport.ok, true, `waiver active report should pass: ${activeReport.errors.join('; ')}`);
const activeReportValidation = validateUsrReport('usr-waiver-active-report', activeReport.payload);
assert.equal(activeReportValidation.ok, true, `waiver active report payload must validate: ${activeReportValidation.errors.join('; ')}`);

const expiryReport = buildUsrWaiverExpiryReport({
  waiverPolicyPayload: waiverPolicy,
  ownershipMatrixPayload: ownershipMatrix,
  escalationPolicyPayload: escalationPolicy,
  evaluationTime: '2026-02-12T00:00:00Z',
  strictMode: true,
  runId: 'run-usr-waiver-expiry-report-001',
  lane: 'ci',
  producerId: 'usr-waiver-policy-harness'
});
assert.equal(expiryReport.ok, true, `waiver expiry report should pass: ${expiryReport.errors.join('; ')}`);
const expiryReportValidation = validateUsrReport('usr-waiver-expiry-report', expiryReport.payload);
assert.equal(expiryReportValidation.ok, true, `waiver expiry report payload must validate: ${expiryReportValidation.errors.join('; ')}`);

const disallowedBypassValidation = validateUsrWaiverPolicyControls({
  waiverPolicyPayload: {
    ...waiverPolicy,
    rows: (waiverPolicy.rows || []).map((row, idx) => (
      idx === 0
        ? { ...row, waiverClass: 'strict-security-bypass' }
        : row
    ))
  },
  ownershipMatrixPayload: ownershipMatrix,
  escalationPolicyPayload: escalationPolicy,
  evaluationTime: '2026-02-12T00:00:00Z',
  strictMode: true
});
assert.equal(disallowedBypassValidation.ok, false, 'waiver-policy validation must reject disallowed strict-security bypass classes');
assert.equal(disallowedBypassValidation.errors.some((msg) => msg.includes('waiver-benchmark-overrun-ci-long')), true, 'disallowed waiver-class errors must include affected waiver row id');

const expiredBlockingValidation = validateUsrWaiverPolicyControls({
  waiverPolicyPayload: {
    ...waiverPolicy,
    rows: (waiverPolicy.rows || []).map((row, idx) => (
      idx === 0
        ? { ...row, allowedUntil: '2026-01-01T00:00:00Z' }
        : row
    ))
  },
  ownershipMatrixPayload: ownershipMatrix,
  escalationPolicyPayload: escalationPolicy,
  evaluationTime: '2026-02-12T00:00:00Z',
  strictMode: true
});
assert.equal(expiredBlockingValidation.ok, false, 'waiver-policy validation must fail on expired blocking waivers');
assert.equal(expiredBlockingValidation.errors.some((msg) => msg.includes('waiver-benchmark-overrun-ci-long')), true, 'expired waiver validation errors must include affected waiver row id');

const missingApproversValidation = validateUsrWaiverPolicyControls({
  waiverPolicyPayload: {
    ...waiverPolicy,
    rows: (waiverPolicy.rows || []).map((row, idx) => (
      idx === 0
        ? { ...row, approvers: [] }
        : row
    ))
  },
  ownershipMatrixPayload: ownershipMatrix,
  escalationPolicyPayload: escalationPolicy,
  evaluationTime: '2026-02-12T00:00:00Z',
  strictMode: true
});
assert.equal(missingApproversValidation.ok, false, 'waiver-policy validation must fail when waiver approvers are missing');
assert.equal(missingApproversValidation.errors.some((msg) => msg.includes('waiver-benchmark-overrun-ci-long')), true, 'missing approvers validation errors must include affected waiver row id');

console.log('usr waiver policy validation checks passed');
