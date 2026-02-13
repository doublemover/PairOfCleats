#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRunRules } from '../../../runner/run-config.js';
import { resolveConformanceLaneId } from '../../../../src/contracts/validators/conformance-lanes.js';
import {
  validateUsrMatrixRegistry,
  evaluateUsrConformancePromotionReadiness,
  buildUsrOperationalReadinessValidationReport,
  buildUsrReleaseReadinessScorecard
} from '../../../../src/contracts/validators/usr-matrix.js';
import { validateUsrReport } from '../../../../src/contracts/validators/usr.js';
import { resolveCurrentTestLane } from '../../../helpers/lane-resolution.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
const reportLane = resolveCurrentTestLane({ repoRoot, testFilePath: __filename });

const operationalReadinessPath = path.join(repoRoot, 'tests', 'lang', 'matrix', 'usr-operational-readiness-policy.json');
const qualityGatesPath = path.join(repoRoot, 'tests', 'lang', 'matrix', 'usr-quality-gates.json');
const languageProfilesPath = path.join(repoRoot, 'tests', 'lang', 'matrix', 'usr-language-profiles.json');
const conformanceLevelsPath = path.join(repoRoot, 'tests', 'lang', 'matrix', 'usr-conformance-levels.json');
const schemaDir = path.join(repoRoot, 'docs', 'schemas', 'usr');
const runRules = loadRunRules({ root: repoRoot });
const conformanceLaneId = resolveConformanceLaneId(Array.from(runRules.knownLanes || []));
assert.equal(Boolean(conformanceLaneId), true, 'conformance lane must be discoverable from run rules');
const knownConformanceLanes = [conformanceLaneId];

const operationalReadiness = JSON.parse(fs.readFileSync(operationalReadinessPath, 'utf8'));
const qualityGates = JSON.parse(fs.readFileSync(qualityGatesPath, 'utf8'));
const languageProfiles = JSON.parse(fs.readFileSync(languageProfilesPath, 'utf8'));
const conformanceLevels = JSON.parse(fs.readFileSync(conformanceLevelsPath, 'utf8'));

const operationalSchemaValidation = validateUsrMatrixRegistry('usr-operational-readiness-policy', operationalReadiness);
assert.equal(operationalSchemaValidation.ok, true, `operational readiness matrix should validate: ${operationalSchemaValidation.errors.join('; ')}`);

const qualitySchemaValidation = validateUsrMatrixRegistry('usr-quality-gates', qualityGates);
assert.equal(qualitySchemaValidation.ok, true, `quality gates matrix should validate: ${qualitySchemaValidation.errors.join('; ')}`);

const operationalRows = Array.isArray(operationalReadiness.rows) ? operationalReadiness.rows : [];
assert.equal(operationalRows.length > 0, true, 'operational readiness policy must contain rows');

const requiredPhases = ['pre-cutover', 'cutover', 'incident', 'post-cutover'];
const phasesPresent = new Set(operationalRows.map((row) => row.phase));
for (const phase of requiredPhases) {
  assert.equal(phasesPresent.has(phase), true, `operational readiness policy is missing required phase: ${phase}`);
}

const requiredBlockingPhases = ['pre-cutover', 'cutover', 'incident'];
for (const phase of requiredBlockingPhases) {
  const phaseRows = operationalRows.filter((row) => row.phase === phase);
  assert.equal(phaseRows.length > 0, true, `missing operational readiness rows for blocking phase: ${phase}`);
  assert.equal(phaseRows.some((row) => row.blocking === true), true, `phase ${phase} must include a blocking row`);
}

const missingArtifactSchemas = [];
for (const row of operationalRows) {
  assert.equal(typeof row.runbookId === 'string' && row.runbookId.trim().length > 0, true, `runbookId must be non-empty for ${row.id}`);

  const requiredRoles = Array.isArray(row.requiredRoles) ? row.requiredRoles : [];
  const requiredArtifacts = Array.isArray(row.requiredArtifacts) ? row.requiredArtifacts : [];

  assert.equal(requiredRoles.length > 0, true, `${row.id} must define at least one required role`);
  assert.equal(new Set(requiredRoles).size, requiredRoles.length, `${row.id} requiredRoles must not contain duplicates`);

  assert.equal(requiredArtifacts.length > 0, true, `${row.id} must define at least one required artifact`);
  assert.equal(new Set(requiredArtifacts).size, requiredArtifacts.length, `${row.id} requiredArtifacts must not contain duplicates`);

  assert.equal(Number.isInteger(row.maxResponseMinutes) && row.maxResponseMinutes > 0, true, `${row.id} maxResponseMinutes must be a positive integer`);
  assert.equal(Number.isInteger(row.maxRecoveryMinutes) && row.maxRecoveryMinutes > 0, true, `${row.id} maxRecoveryMinutes must be a positive integer`);
  assert.equal(row.maxRecoveryMinutes >= row.maxResponseMinutes, true, `${row.id} maxRecoveryMinutes must be >= maxResponseMinutes`);

  for (const artifactId of requiredArtifacts) {
    const schemaFile = `${artifactId.replace(/\.json$/, '')}.schema.json`;
    const schemaPath = path.join(schemaDir, schemaFile);
    if (!fs.existsSync(schemaPath)) {
      missingArtifactSchemas.push(`${row.id}:${artifactId}`);
    }
  }
}

assert.deepEqual(missingArtifactSchemas, [], `all operational readiness required artifacts must have schemas: ${missingArtifactSchemas.join(', ')}`);

const releaseScorecardRow = operationalRows.find((row) => row.blocking === true && (row.requiredArtifacts || []).includes('usr-release-readiness-scorecard.json'));
assert.equal(Boolean(releaseScorecardRow), true, 'at least one blocking operational readiness row must require usr-release-readiness-scorecard.json');

const qualityRows = Array.isArray(qualityGates.rows) ? qualityGates.rows : [];
assert.equal(qualityRows.length > 0, true, 'quality gates matrix must contain rows');

const blockingQualityRows = qualityRows.filter((row) => row.blocking === true);
assert.equal(blockingQualityRows.length > 0, true, 'quality gates must include blocking rows');

const requiredBlockingDomains = ['framework-binding', 'minimum-slice', 'provenance', 'resolution'];
const blockingDomains = new Set(blockingQualityRows.map((row) => row.domain));
for (const domain of requiredBlockingDomains) {
  assert.equal(blockingDomains.has(domain), true, `quality gates must include a blocking row for domain: ${domain}`);
}

for (const row of qualityRows) {
  assert.equal(typeof row.fixtureSetId === 'string' && row.fixtureSetId.trim().length > 0, true, `quality gate ${row.id} must include non-empty fixtureSetId`);
  assert.equal(Number.isFinite(row.thresholdValue), true, `quality gate ${row.id} thresholdValue must be numeric`);
  assert.equal(['>=', '<=', '>', '<', '=='].includes(row.thresholdOperator), true, `quality gate ${row.id} thresholdOperator must be a recognized operator`);
}

const baselineEvaluation = evaluateUsrConformancePromotionReadiness({
  languageProfilesPayload: languageProfiles,
  conformanceLevelsPayload: conformanceLevels,
  knownLanes: knownConformanceLanes,
  missingArtifacts: missingArtifactSchemas,
  failingBlockingGateIds: []
});
assert.equal(baselineEvaluation.blocked, false, `baseline implementation-readiness promotion should be unblocked: ${baselineEvaluation.blockers.join(', ')}`);
assert.equal(baselineEvaluation.readiness.testRolloutBlocked, false, 'baseline implementation readiness should not block C0/C1 test rollout');
assert.equal(baselineEvaluation.readiness.deepConformanceBlocked, false, 'baseline implementation readiness should not block C2/C3 deep conformance');
assert.equal(baselineEvaluation.readiness.frameworkConformanceBlocked, false, 'baseline implementation readiness should not block C4 framework conformance');

const operationalReadinessReport = buildUsrOperationalReadinessValidationReport({
  operationalReadinessPolicyPayload: operationalReadiness,
  qualityGatesPayload: qualityGates,
  languageProfilesPayload: languageProfiles,
  conformanceLevelsPayload: conformanceLevels,
  knownLanes: knownConformanceLanes,
  missingArtifactSchemas,
  runId: 'run-usr-operational-readiness-validation-001',
  lane: reportLane
});
assert.equal(operationalReadinessReport.ok, true, `operational readiness report should pass: ${operationalReadinessReport.errors.join('; ')}`);
const operationalReadinessReportValidation = validateUsrReport('usr-operational-readiness-validation', operationalReadinessReport.payload);
assert.equal(operationalReadinessReportValidation.ok, true, `operational readiness report payload must validate: ${operationalReadinessReportValidation.errors.join('; ')}`);

const releaseReadinessScorecard = buildUsrReleaseReadinessScorecard({
  operationalReadinessPolicyPayload: operationalReadiness,
  qualityGatesPayload: qualityGates,
  languageProfilesPayload: languageProfiles,
  conformanceLevelsPayload: conformanceLevels,
  knownLanes: knownConformanceLanes,
  missingArtifactSchemas,
  runId: 'run-usr-release-readiness-scorecard-001',
  lane: reportLane
});
assert.equal(releaseReadinessScorecard.ok, true, `release readiness scorecard should pass: ${releaseReadinessScorecard.errors.join('; ')}`);
const releaseReadinessScorecardValidation = validateUsrReport('usr-release-readiness-scorecard', releaseReadinessScorecard.payload);
assert.equal(releaseReadinessScorecardValidation.ok, true, `release readiness scorecard payload must validate: ${releaseReadinessScorecardValidation.errors.join('; ')}`);

const simulatedFailureEvaluation = evaluateUsrConformancePromotionReadiness({
  languageProfilesPayload: languageProfiles,
  conformanceLevelsPayload: conformanceLevels,
  knownLanes: knownConformanceLanes,
  missingArtifacts: [],
  failingBlockingGateIds: [blockingQualityRows[0].id]
});
assert.equal(simulatedFailureEvaluation.blocked, true, 'promotion blocker evaluator must block when a blocking gate fails');
assert.equal(simulatedFailureEvaluation.blockers[0].startsWith('failing-gate:'), true, 'promotion blocker reason must include failing gate ID');

const simulatedFailureScorecard = buildUsrReleaseReadinessScorecard({
  operationalReadinessPolicyPayload: operationalReadiness,
  qualityGatesPayload: qualityGates,
  languageProfilesPayload: languageProfiles,
  conformanceLevelsPayload: conformanceLevels,
  knownLanes: knownConformanceLanes,
  missingArtifactSchemas: [],
  failingBlockingGateIds: [blockingQualityRows[0].id],
  runId: 'run-usr-release-readiness-scorecard-002',
  lane: reportLane
});
assert.equal(simulatedFailureScorecard.ok, false, 'release readiness scorecard must fail when a blocking quality gate fails');
assert.equal(simulatedFailureScorecard.payload.status, 'fail', 'failing release readiness scorecard must carry fail status');

const missingC0Readiness = evaluateUsrConformancePromotionReadiness({
  languageProfilesPayload: languageProfiles,
  conformanceLevelsPayload: {
    ...conformanceLevels,
    rows: (conformanceLevels.rows || []).map((row) => (
      row.profileType === 'language' && row.profileId === 'javascript'
        ? { ...row, requiredLevels: (row.requiredLevels || []).filter((level) => level !== 'C0') }
        : row
    ))
  },
  knownLanes: knownConformanceLanes
});
assert.equal(missingC0Readiness.blocked, true, 'missing C0 requirements must block test rollout readiness');
assert.equal(missingC0Readiness.readiness.testRolloutBlocked, true, 'missing C0 requirements must set testRolloutBlocked=true');
assert.equal(missingC0Readiness.blockers.some((reason) => reason.startsWith('missing-test-rollout-readiness:C0')), true, 'missing C0 blocker reason must be present');

const missingC2Readiness = evaluateUsrConformancePromotionReadiness({
  languageProfilesPayload: languageProfiles,
  conformanceLevelsPayload: {
    ...conformanceLevels,
    rows: (conformanceLevels.rows || []).map((row) => (
      row.profileType === 'language' && row.profileId === 'javascript'
        ? { ...row, requiredLevels: (row.requiredLevels || []).filter((level) => level !== 'C2') }
        : row
    ))
  },
  knownLanes: knownConformanceLanes
});
assert.equal(missingC2Readiness.blocked, true, 'missing C2 requirements must block deep conformance readiness');
assert.equal(missingC2Readiness.readiness.deepConformanceBlocked, true, 'missing C2 requirements must set deepConformanceBlocked=true');
assert.equal(missingC2Readiness.blockers.some((reason) => reason.startsWith('missing-deep-conformance-readiness:C2')), true, 'missing C2 blocker reason must be present');

const missingC4LaneReadiness = evaluateUsrConformancePromotionReadiness({
  languageProfilesPayload: languageProfiles,
  conformanceLevelsPayload: conformanceLevels,
  knownLanes: ['ci']
});
assert.equal(missingC4LaneReadiness.blocked, true, 'missing conformance lane must block framework conformance readiness');
assert.equal(missingC4LaneReadiness.readiness.frameworkConformanceBlocked, true, 'missing conformance lane must set frameworkConformanceBlocked=true');
assert.equal(missingC4LaneReadiness.blockers.some((reason) => reason.startsWith('missing-framework-conformance-readiness:C4')), true, 'missing C4 lane blocker reason must be present');

console.log('usr implementation readiness validation checks passed');

