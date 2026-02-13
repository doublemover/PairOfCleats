#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  validateUsrEmbeddingBridgeCoverage,
  buildUsrEmbeddingBridgeCoverageReport,
  validateUsrGeneratedProvenanceCoverage,
  buildUsrGeneratedProvenanceCoverageReport
} from '../../../../src/contracts/validators/usr-matrix.js';
import { validateUsrReport } from '../../../../src/contracts/validators/usr.js';
import { resolveCurrentTestLane } from '../../../helpers/lane-resolution.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
const reportLane = resolveCurrentTestLane({ repoRoot, testFilePath: __filename });

const bridgeCases = JSON.parse(
  fs.readFileSync(path.join(repoRoot, 'tests', 'lang', 'matrix', 'usr-embedding-bridge-cases.json'), 'utf8')
);
const bridgeBundle = JSON.parse(
  fs.readFileSync(path.join(repoRoot, 'tests', 'fixtures', 'usr', 'embedding-bridges', 'usr-embedding-bridge-bundle.json'), 'utf8')
);
const provenanceCases = JSON.parse(
  fs.readFileSync(path.join(repoRoot, 'tests', 'lang', 'matrix', 'usr-generated-provenance-cases.json'), 'utf8')
);
const provenanceBundle = JSON.parse(
  fs.readFileSync(path.join(repoRoot, 'tests', 'fixtures', 'usr', 'generated-provenance', 'usr-generated-provenance-bundle.json'), 'utf8')
);

const bridgeCoverage = validateUsrEmbeddingBridgeCoverage({
  bridgeCasesPayload: bridgeCases,
  bridgeBundlePayload: bridgeBundle
});
assert.equal(bridgeCoverage.ok, true, `embedding bridge coverage should pass: ${bridgeCoverage.errors.join('; ')}`);

const bridgeCoverageReport = buildUsrEmbeddingBridgeCoverageReport({
  bridgeCasesPayload: bridgeCases,
  bridgeBundlePayload: bridgeBundle,
  runId: 'run-usr-embedding-bridge-coverage-001',
  lane: reportLane,
  producerId: 'usr-embedding-bridge-dashboard-harness'
});
assert.equal(bridgeCoverageReport.ok, true, `embedding bridge coverage report should pass: ${bridgeCoverageReport.errors.join('; ')}`);
const bridgeReportValidation = validateUsrReport('usr-validation-report', bridgeCoverageReport.payload);
assert.equal(bridgeReportValidation.ok, true, `embedding bridge coverage report payload must validate: ${bridgeReportValidation.errors.join('; ')}`);

const bridgeCoverageNegative = validateUsrEmbeddingBridgeCoverage({
  bridgeCasesPayload: bridgeCases,
  bridgeBundlePayload: {
    ...bridgeBundle,
    rows: (bridgeBundle.rows || []).slice(1)
  }
});
assert.equal(bridgeCoverageNegative.ok, false, 'embedding bridge coverage must fail when required case rows are missing');

const provenanceCoverage = validateUsrGeneratedProvenanceCoverage({
  provenanceCasesPayload: provenanceCases,
  provenanceBundlePayload: provenanceBundle
});
assert.equal(provenanceCoverage.ok, true, `generated provenance coverage should pass: ${provenanceCoverage.errors.join('; ')}`);

const provenanceCoverageReport = buildUsrGeneratedProvenanceCoverageReport({
  provenanceCasesPayload: provenanceCases,
  provenanceBundlePayload: provenanceBundle,
  runId: 'run-usr-generated-provenance-coverage-001',
  lane: reportLane,
  producerId: 'usr-generated-provenance-dashboard-harness'
});
assert.equal(provenanceCoverageReport.ok, true, `generated provenance coverage report should pass: ${provenanceCoverageReport.errors.join('; ')}`);
const provenanceReportValidation = validateUsrReport('usr-validation-report', provenanceCoverageReport.payload);
assert.equal(provenanceReportValidation.ok, true, `generated provenance coverage report payload must validate: ${provenanceReportValidation.errors.join('; ')}`);

const provenanceCoverageNegative = validateUsrGeneratedProvenanceCoverage({
  provenanceCasesPayload: provenanceCases,
  provenanceBundlePayload: {
    ...provenanceBundle,
    rows: (provenanceBundle.rows || []).slice(1)
  }
});
assert.equal(provenanceCoverageNegative.ok, false, 'generated provenance coverage must fail when required case rows are missing');

console.log('usr bridge and provenance dashboard validation checks passed');
