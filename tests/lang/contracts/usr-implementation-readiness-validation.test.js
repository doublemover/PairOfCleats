#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');

const operationalReadinessPath = path.join(repoRoot, 'tests', 'lang', 'matrix', 'usr-operational-readiness-policy.json');
const qualityGatesPath = path.join(repoRoot, 'tests', 'lang', 'matrix', 'usr-quality-gates.json');
const schemaDir = path.join(repoRoot, 'docs', 'schemas', 'usr');

const operationalReadiness = JSON.parse(fs.readFileSync(operationalReadinessPath, 'utf8'));
const qualityGates = JSON.parse(fs.readFileSync(qualityGatesPath, 'utf8'));


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

const evaluatePromotionBlockers = ({ missingArtifacts = [], failingBlockingGateIds = [] } = {}) => {
  const blockers = [
    ...missingArtifacts.map((artifact) => `missing-artifact:${artifact}`),
    ...failingBlockingGateIds.map((gateId) => `failing-gate:${gateId}`)
  ];
  return {
    blocked: blockers.length > 0,
    blockers
  };
};

const baselineEvaluation = evaluatePromotionBlockers({
  missingArtifacts: missingArtifactSchemas,
  failingBlockingGateIds: []
});
assert.equal(baselineEvaluation.blocked, false, `baseline implementation-readiness promotion should be unblocked: ${baselineEvaluation.blockers.join(', ')}`);

const simulatedFailureEvaluation = evaluatePromotionBlockers({
  missingArtifacts: [],
  failingBlockingGateIds: [blockingQualityRows[0].id]
});
assert.equal(simulatedFailureEvaluation.blocked, true, 'promotion blocker evaluator must block when a blocking gate fails');
assert.equal(simulatedFailureEvaluation.blockers[0].startsWith('failing-gate:'), true, 'promotion blocker reason must include failing gate ID');

console.log('usr implementation readiness validation checks passed');

