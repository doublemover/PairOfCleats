#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  validateUsrEvidenceEnvelope,
  validateUsrReport,
  validateUsrCapabilityTransition
} from '../../../src/contracts/validators/usr.js';

const envelope = {
  schemaVersion: 'usr-1.0.0',
  artifactId: 'usr-validation-report',
  generatedAt: '2026-02-12T01:00:00Z',
  producerId: 'usr-contract-tests',
  runId: 'run-usr-contract-001',
  lane: 'ci',
  buildId: null,
  status: 'pass',
  scope: {
    scopeType: 'lane',
    scopeId: 'ci'
  },
  blockingFindings: [],
  advisoryFindings: [],
  evidenceRefs: []
};

const envelopeResult = validateUsrEvidenceEnvelope(envelope);
assert.equal(envelopeResult.ok, true, `valid envelope should pass: ${envelopeResult.errors.join('; ')}`);

const envelopeMissingRun = { ...envelope };
delete envelopeMissingRun.runId;
const missingRunResult = validateUsrEvidenceEnvelope(envelopeMissingRun);
assert.equal(missingRunResult.ok, false, 'envelope missing runId must fail');

const report = {
  ...envelope,
  artifactId: 'usr-conformance-summary',
  summary: { passCount: 1, failCount: 0 },
  rows: [{ profileId: 'typescript', level: 'C1', status: 'pass' }]
};

const reportResult = validateUsrReport('usr-conformance-summary', report);
assert.equal(reportResult.ok, true, `valid report should pass: ${reportResult.errors.join('; ')}`);

const reportMissingRows = { ...report };
delete reportMissingRows.rows;
const missingRowsResult = validateUsrReport('usr-conformance-summary', reportMissingRows);
assert.equal(missingRowsResult.ok, false, 'report missing rows must fail');

const transitionOk = validateUsrCapabilityTransition({
  from: 'supported',
  to: 'partial',
  diagnostic: 'USR-W-CAPABILITY-DOWNGRADED',
  reasonCode: 'parser_timeout'
});
assert.equal(transitionOk.ok, true, `valid capability transition should pass: ${transitionOk.errors.join('; ')}`);

const transitionBad = validateUsrCapabilityTransition({
  from: 'supported',
  to: 'unsupported',
  diagnostic: 'USR-W-DEGRADED-CAPABILITY'
});
assert.equal(transitionBad.ok, false, 'non-canonical diagnostic must fail');

console.log('usr schema validator tests passed');
