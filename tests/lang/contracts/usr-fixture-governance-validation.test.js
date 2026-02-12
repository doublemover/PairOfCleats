#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  validateUsrFixtureGovernanceControls,
  buildUsrFixtureGovernanceValidationReport
} from '../../../src/contracts/validators/usr-matrix.js';
import { validateUsrReport } from '../../../src/contracts/validators/usr.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');

const fixtureGovernancePath = path.join(repoRoot, 'tests', 'lang', 'matrix', 'usr-fixture-governance.json');
const fixtureGovernance = JSON.parse(fs.readFileSync(fixtureGovernancePath, 'utf8'));
const rows = Array.isArray(fixtureGovernance.rows) ? fixtureGovernance.rows : [];

assert.equal(rows.length > 0, true, 'fixture-governance matrix must contain rows');

const fixtureIdSet = new Set();
for (const row of rows) {
  assert.equal(fixtureIdSet.has(row.fixtureId), false, `fixture-governance fixtureId must be unique: ${row.fixtureId}`);
  fixtureIdSet.add(row.fixtureId);

  assert.equal(typeof row.owner === 'string' && row.owner.length > 0, true, `fixture-governance row owner must be non-empty: ${row.fixtureId}`);
  assert.equal(Array.isArray(row.reviewers) && row.reviewers.length > 0, true, `fixture-governance row reviewers must be non-empty: ${row.fixtureId}`);
  assert.equal(Array.isArray(row.families) && row.families.length > 0, true, `fixture-governance row families must be non-empty: ${row.fixtureId}`);
  assert.equal(Array.isArray(row.roadmapTags) && row.roadmapTags.length > 0, true, `fixture-governance row roadmapTags must be non-empty: ${row.fixtureId}`);
  assert.equal(Array.isArray(row.conformanceLevels) && row.conformanceLevels.length > 0, true, `fixture-governance row conformanceLevels must be non-empty: ${row.fixtureId}`);

  if (row.profileType === 'language') {
    assert.equal(row.roadmapTags.includes(`appendix-c:${row.profileId}`), true, `language fixture row must include appendix-c roadmap tag: ${row.fixtureId}`);
  }
  if (row.profileType === 'framework') {
    assert.equal(row.roadmapTags.includes(`appendix-d:${row.profileId}`), true, `framework fixture row must include appendix-d roadmap tag: ${row.fixtureId}`);
  }
}

const blockingRows = rows.filter((row) => row.blocking === true);
assert.equal(blockingRows.length > 0, true, 'fixture-governance matrix must contain blocking rows');
assert.equal(blockingRows.some((row) => row.families.includes('framework-overlay')), true, 'fixture-governance matrix must include blocking framework-overlay coverage');
assert.equal(blockingRows.some((row) => row.families.includes('failure-injection')), true, 'fixture-governance matrix must include blocking failure-injection coverage');

const controls = validateUsrFixtureGovernanceControls({
  fixtureGovernancePayload: fixtureGovernance
});
assert.equal(controls.ok, true, `fixture-governance controls should pass: ${controls.errors.join('; ')}`);

const validationReport = buildUsrFixtureGovernanceValidationReport({
  fixtureGovernancePayload: fixtureGovernance,
  runId: 'run-usr-fixture-governance-001',
  lane: 'ci-lite',
  producerId: 'usr-fixture-governance-harness'
});
assert.equal(validationReport.ok, true, `fixture-governance validation report should pass: ${validationReport.errors.join('; ')}`);
const reportValidation = validateUsrReport('usr-validation-report', validationReport.payload);
assert.equal(reportValidation.ok, true, `fixture-governance validation report payload must validate: ${reportValidation.errors.join('; ')}`);

const invalidGovernance = {
  ...fixtureGovernance,
  rows: rows.map((row, idx) => (
    idx === 0
      ? {
          ...row,
          owner: row.reviewers[0] || row.owner,
          mutationPolicy: row.blocking ? 'allow-generated-refresh' : row.mutationPolicy
        }
      : row
  ))
};
const invalidControls = validateUsrFixtureGovernanceControls({
  fixtureGovernancePayload: invalidGovernance
});
assert.equal(invalidControls.ok, false, 'fixture-governance controls must fail invalid owner/reviewer or mutation-policy combinations');

console.log('usr fixture-governance validation checks passed');
