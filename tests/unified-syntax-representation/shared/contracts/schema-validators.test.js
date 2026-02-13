#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveCurrentTestLane } from '../../../helpers/lane-resolution.js';
import {
  validateUsrEvidenceEnvelope,
  validateUsrReport,
  listUsrReportIds,
  validateUsrRequiredAuditReports,
  USR_REQUIRED_AUDIT_REPORT_IDS,
  validateUsrCapabilityTransition,
  buildUsrDiagnosticsTransitionReport,
  validateUsrCanonicalId,
  validateUsrDiagnosticCode,
  validateUsrReasonCode,
  validateUsrEdgeEndpoint,
  validateUsrEdgeEndpoints
} from '../../../../src/contracts/validators/usr.js';
import {
  USR_DIAGNOSTIC_CODE_SCHEMA
} from '../../../../src/contracts/schemas/usr.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
const reportLane = resolveCurrentTestLane({ repoRoot, testFilePath: __filename });
const edgeConstraintPath = path.join(repoRoot, 'tests', 'lang', 'matrix', 'usr-edge-kind-constraints.json');
const edgeConstraintRegistry = JSON.parse(fs.readFileSync(edgeConstraintPath, 'utf8'));

const envelope = {
  schemaVersion: 'usr-1.0.0',
  artifactId: 'usr-validation-report',
  generatedAt: '2026-02-12T01:00:00Z',
  producerId: 'usr-contract-tests',
  runId: 'run-usr-contract-001',
  lane: reportLane,
  buildId: null,
  status: 'pass',
  scope: {
    scopeType: 'lane',
    scopeId: reportLane
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

const reportSchemaIds = listUsrReportIds();
for (const requiredArtifactId of USR_REQUIRED_AUDIT_REPORT_IDS) {
  assert.equal(reportSchemaIds.includes(requiredArtifactId), true, `required audit report schema must be registered: ${requiredArtifactId}`);
}

const requiredAuditReports = Object.fromEntries(
  USR_REQUIRED_AUDIT_REPORT_IDS.map((artifactId) => [artifactId, {
    ...envelope,
    artifactId,
    summary: { artifactId },
    rows: []
  }])
);

const requiredAuditValidation = validateUsrRequiredAuditReports(requiredAuditReports);
assert.equal(requiredAuditValidation.ok, true, `required audit report set should validate: ${requiredAuditValidation.errors.join('; ')}`);

const missingAuditReportValidation = validateUsrRequiredAuditReports({
  ...requiredAuditReports,
  'usr-waiver-expiry-report': undefined
});
assert.equal(missingAuditReportValidation.ok, false, 'missing required audit report payload must fail');

const reportWithUnknownKey = {
  ...requiredAuditReports['usr-validation-report'],
  unexpectedTopLevelKey: true
};
const reportWithUnknownKeyResult = validateUsrReport('usr-validation-report', reportWithUnknownKey);
assert.equal(reportWithUnknownKeyResult.ok, false, 'report with unknown top-level key must fail strict report schema validation');

const transitionOk = validateUsrCapabilityTransition({
  from: 'supported',
  to: 'partial',
  diagnostic: 'USR-W-CAPABILITY-DOWNGRADED',
  reasonCode: 'USR-R-PARSER-TIMEOUT'
});
assert.equal(transitionOk.ok, true, `valid capability transition should pass: ${transitionOk.errors.join('; ')}`);

const transitionBad = validateUsrCapabilityTransition({
  from: 'supported',
  to: 'unsupported',
  diagnostic: 'USR-W-DEGRADED-CAPABILITY'
});
assert.equal(transitionBad.ok, false, 'non-canonical diagnostic must fail');

const canonicalDocIdOk = validateUsrCanonicalId('docUid', 'doc64:v1:0123abc456def789');
assert.equal(canonicalDocIdOk.ok, true, `canonical docUid should pass: ${canonicalDocIdOk.errors.join('; ')}`);

const canonicalDocIdBad = validateUsrCanonicalId('docUid', 'doc64:v1:not-hex');
assert.equal(canonicalDocIdBad.ok, false, 'invalid docUid grammar must fail');

const diagnosticCodeOk = validateUsrDiagnosticCode('USR-E-PARSER-FAILED');
assert.equal(diagnosticCodeOk.ok, true, `canonical diagnostic code should pass: ${diagnosticCodeOk.errors.join('; ')}`);

const diagnosticSchemaPattern = new RegExp(USR_DIAGNOSTIC_CODE_SCHEMA.pattern);
assert.equal(diagnosticSchemaPattern.test('USR-I-CANONICALIZATION-DEGRADED'), true, 'diagnostic schema pattern must allow informational USR-I-* diagnostics');
assert.equal(diagnosticSchemaPattern.test('USR-R-NOT-A-DIAGNOSTIC'), false, 'diagnostic schema pattern must reject USR-R-* reason codes');

const diagnosticCodeUnknown = validateUsrDiagnosticCode('USR-E-NOT-IN-TAXONOMY');
assert.equal(diagnosticCodeUnknown.ok, false, 'unknown diagnostic code must fail strict enum validation');

const reasonCodeOk = validateUsrReasonCode('USR-R-MULTIPLE-CANDIDATES');
assert.equal(reasonCodeOk.ok, true, `canonical reason code should pass: ${reasonCodeOk.errors.join('; ')}`);

const reasonCodeUnknown = validateUsrReasonCode('USR-R-UNKNOWN-REASON');
assert.equal(reasonCodeUnknown.ok, false, 'unknown reason code must fail strict enum validation');

const transitionUnknownReason = validateUsrCapabilityTransition({
  from: 'supported',
  to: 'partial',
  diagnostic: 'USR-W-CAPABILITY-DOWNGRADED',
  reasonCode: 'USR-R-UNKNOWN-REASON'
});
assert.equal(transitionUnknownReason.ok, false, 'capability transition with unknown reason code must fail');

const diagnosticsTransitionReport = buildUsrDiagnosticsTransitionReport({
  diagnostics: ['USR-E-PARSER-FAILED', 'USR-W-CAPABILITY-DOWNGRADED'],
  reasonCodes: ['USR-R-PARSER-TIMEOUT'],
  transitions: [
    {
      from: 'supported',
      to: 'partial',
      diagnostic: 'USR-W-CAPABILITY-DOWNGRADED',
      reasonCode: 'USR-R-PARSER-TIMEOUT'
    }
  ],
  runId: 'run-usr-diagnostics-transition-001',
  lane: 'diagnostics-summary'
});
assert.equal(diagnosticsTransitionReport.ok, true, `diagnostics transition report should pass: ${diagnosticsTransitionReport.errors.join('; ')}`);
const diagnosticsTransitionReportValidation = validateUsrReport('usr-validation-report', diagnosticsTransitionReport.payload);
assert.equal(diagnosticsTransitionReportValidation.ok, true, `diagnostics transition report payload should validate: ${diagnosticsTransitionReportValidation.errors.join('; ')}`);

const diagnosticsTransitionReportNegative = buildUsrDiagnosticsTransitionReport({
  diagnostics: ['USR-E-NOT-IN-TAXONOMY'],
  transitions: [
    {
      from: 'supported',
      to: 'unsupported',
      diagnostic: 'USR-W-DEGRADED-CAPABILITY'
    }
  ],
  runId: 'run-usr-diagnostics-transition-002',
  lane: 'diagnostics-summary'
});
assert.equal(diagnosticsTransitionReportNegative.ok, false, 'diagnostics transition report should fail for invalid diagnostic transitions');

const validEdge = {
  edgeUid: 'edge64:v1:0011aa22bb33cc44',
  kind: 'calls',
  status: 'resolved',
  source: {
    entity: 'node',
    uid: 'n64:v1:1111aa22bb33cc44'
  },
  target: {
    entity: 'symbol',
    uid: 'symu:v1:pkg:module:callable'
  },
  attrs: {}
};
const validEdgeResult = validateUsrEdgeEndpoint(validEdge, edgeConstraintRegistry);
assert.equal(validEdgeResult.ok, true, `valid edge endpoints should pass: ${validEdgeResult.errors.join('; ')}`);

const invalidEdgeEntity = {
  ...validEdge,
  source: {
    entity: 'document',
    uid: 'doc64:v1:1111aa22bb33cc44'
  }
};
const invalidEntityResult = validateUsrEdgeEndpoint(invalidEdgeEntity, edgeConstraintRegistry);
assert.equal(invalidEntityResult.ok, false, 'edge with invalid source entity for kind must fail');

const invalidEdgeUid = {
  ...validEdge,
  edgeUid: 'edge64:v1:invalid'
};
const invalidEdgeUidResult = validateUsrEdgeEndpoint(invalidEdgeUid, edgeConstraintRegistry);
assert.equal(invalidEdgeUidResult.ok, false, 'edge with invalid edgeUid grammar must fail');

const resolvedWithoutTarget = {
  ...validEdge,
  target: null
};
const resolvedWithoutTargetResult = validateUsrEdgeEndpoint(resolvedWithoutTarget, edgeConstraintRegistry);
assert.equal(resolvedWithoutTargetResult.ok, false, 'resolved edge without target must fail');

const invalidSelfEdge = {
  ...validEdge,
  source: {
    entity: 'node',
    uid: 'n64:v1:1111aa22bb33cc44'
  },
  target: {
    entity: 'node',
    uid: 'n64:v1:1111aa22bb33cc44'
  }
};
const invalidSelfEdgeResult = validateUsrEdgeEndpoint(invalidSelfEdge, edgeConstraintRegistry);
assert.equal(invalidSelfEdgeResult.ok, false, 'self-edge must be rejected for non-ast_parent kinds');

const edgeBatchResult = validateUsrEdgeEndpoints([validEdge, invalidEdgeEntity], edgeConstraintRegistry);
assert.equal(edgeBatchResult.ok, false, 'edge batch validation should fail when any edge violates endpoint constraints');

console.log('usr schema validator tests passed');
