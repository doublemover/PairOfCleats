#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveCurrentTestLane } from '../../../helpers/lane-resolution.js';
import {
  validateUsrReport,
  validateUsrRequiredAuditReports,
  USR_REQUIRED_AUDIT_REPORT_IDS,
  listUsrReportIds
} from '../../../../src/contracts/validators/usr.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
const reportLane = resolveCurrentTestLane({ repoRoot, testFilePath: __filename });

const reportSchemaIds = listUsrReportIds();
for (const artifactId of USR_REQUIRED_AUDIT_REPORT_IDS) {
  assert.equal(reportSchemaIds.includes(artifactId), true, `required audit report schema must be registered: ${artifactId}`);
}

const baseEnvelope = {
  schemaVersion: 'usr-1.0.0',
  generatedAt: '2026-02-12T08:30:00Z',
  producerId: 'usr-report-envelope-harness',
  runId: 'run-usr-report-envelope-001',
  lane: reportLane,
  buildId: null,
  status: 'pass',
  scope: {
    scopeType: 'lane',
    scopeId: reportLane
  },
  blockingFindings: [],
  advisoryFindings: []
};

const requiredAuditReports = Object.fromEntries(
  USR_REQUIRED_AUDIT_REPORT_IDS.map((artifactId) => [artifactId, {
    ...baseEnvelope,
    artifactId,
    summary: { artifactId, rowCount: 0 },
    rows: []
  }])
);

const reportSetValidation = validateUsrRequiredAuditReports(requiredAuditReports);
assert.equal(reportSetValidation.ok, true, `required audit report set should validate: ${reportSetValidation.errors.join('; ')}`);

for (const artifactId of USR_REQUIRED_AUDIT_REPORT_IDS) {
  const reportValidation = validateUsrReport(artifactId, requiredAuditReports[artifactId]);
  assert.equal(reportValidation.ok, true, `required audit report payload should validate: ${artifactId} ${reportValidation.errors.join('; ')}`);
}

const rolloutReportArtifacts = [
  'usr-release-train-readiness',
  'usr-no-cut-decision-log',
  'usr-post-cutover-stabilization-report'
];
for (const artifactId of rolloutReportArtifacts) {
  const rolloutPayload = {
    ...baseEnvelope,
    artifactId,
    summary: { artifactId, rowCount: 0 },
    rows: []
  };
  const rolloutValidation = validateUsrReport(artifactId, rolloutPayload);
  assert.equal(rolloutValidation.ok, true, `rollout report payload should validate: ${artifactId} ${rolloutValidation.errors.join('; ')}`);
}

const missingRunIdReport = {
  ...requiredAuditReports['usr-release-readiness-scorecard']
};
delete missingRunIdReport.runId;
const missingRunIdValidation = validateUsrReport('usr-release-readiness-scorecard', missingRunIdReport);
assert.equal(missingRunIdValidation.ok, false, 'required run metadata omission must fail report envelope validation');

const unknownKeyReport = {
  ...requiredAuditReports['usr-validation-report'],
  unknownAuditField: true
};
const unknownKeyValidation = validateUsrReport('usr-validation-report', unknownKeyReport);
assert.equal(unknownKeyValidation.ok, false, 'unknown top-level report keys must be rejected');

const missingRequiredAuditSet = validateUsrRequiredAuditReports({
  ...requiredAuditReports,
  'usr-waiver-active-report': undefined
});
assert.equal(missingRequiredAuditSet.ok, false, 'missing required audit artifact payload must fail required-set validation');

console.log('usr report envelope validation checks passed');
