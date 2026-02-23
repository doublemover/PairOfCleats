#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildUsrWaiverActiveReport,
  buildUsrWaiverExpiryReport
} from '../../../src/contracts/validators/usr-matrix.js';
import { ensureTestingEnv } from '../../helpers/test-env.js';

ensureTestingEnv(process.env);

const root = process.cwd();
const readMatrix = (fileName) => JSON.parse(
  fs.readFileSync(path.join(root, 'tests', 'lang', 'matrix', fileName), 'utf8')
);

const waiverPolicyPayload = readMatrix('usr-waiver-policy.json');
const ownershipMatrixPayload = readMatrix('usr-ownership-matrix.json');
const escalationPolicyPayload = readMatrix('usr-escalation-policy.json');

const sourceRow = waiverPolicyPayload.rows.find((row) => row.blocking === false) ?? waiverPolicyPayload.rows[0];
const contractRow = structuredClone(sourceRow);
contractRow.id = `${sourceRow.id}-report-check`;
contractRow.blocking = false;
contractRow.allowedUntil = '2026-01-01T00:00:00Z';
contractRow.requiredCompensatingControls = ['usr-unknown-compensating-control.json'];

const contractPayload = {
  ...waiverPolicyPayload,
  rows: [contractRow]
};

const activeReport = buildUsrWaiverActiveReport({
  waiverPolicyPayload: contractPayload,
  ownershipMatrixPayload,
  escalationPolicyPayload,
  evaluationTime: '2026-02-01T00:00:00Z',
  strictMode: false
});

assert.equal(activeReport.ok, true, 'expected non-strict active report generation to remain non-blocking');
assert.equal(activeReport.payload.artifactId, 'usr-waiver-active-report');
assert.equal(activeReport.payload.summary.waiverCount, 1);
assert.equal(activeReport.payload.summary.activeCount, 0, 'expired waiver should not appear in active rows');
assert.equal(activeReport.payload.summary.warningCount, 2, 'expected warnings for unknown compensating artifact and expiry');
assert.equal(activeReport.payload.scope.scopeType, 'global');
assert.equal(activeReport.payload.scope.scopeId, 'global');

const expiryReport = buildUsrWaiverExpiryReport({
  waiverPolicyPayload: contractPayload,
  ownershipMatrixPayload,
  escalationPolicyPayload,
  evaluationTime: '2026-02-01T00:00:00Z',
  strictMode: true
});

assert.equal(expiryReport.ok, false, 'expected strict expiry report generation to block invalid waiver rows');
assert.equal(expiryReport.payload.artifactId, 'usr-waiver-expiry-report');
assert.equal(expiryReport.payload.summary.waiverCount, 1);
assert.equal(expiryReport.payload.summary.expiredCount, 1);
assert.equal(expiryReport.payload.summary.warningCount, 0);
assert.equal(expiryReport.payload.summary.errorCount, 2);
assert(
  expiryReport.payload.blockingFindings.some(
    (finding) => finding.message.includes('compensating control does not map to a governed report artifact')
  ),
  'expected strict expiry report to include missing compensating artifact blocking finding'
);

console.log('usr waiver report builders test passed');
