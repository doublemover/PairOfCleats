#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildUsrFixtureGovernanceValidationReport,
  validateUsrFixtureGovernanceControls
} from '../../../src/contracts/validators/usr-matrix.js';
import { ensureTestingEnv } from '../../helpers/test-env.js';

ensureTestingEnv(process.env);

const root = process.cwd();
const fixtureGovernancePayload = JSON.parse(
  fs.readFileSync(path.join(root, 'tests', 'lang', 'matrix', 'usr-fixture-governance.json'), 'utf8')
);

const valid = validateUsrFixtureGovernanceControls({ fixtureGovernancePayload });
assert.equal(valid.ok, true, 'expected canonical fixture governance matrix to validate');
assert.equal(valid.errors.length, 0);

const invalidRows = [
  structuredClone(fixtureGovernancePayload.rows[0]),
  structuredClone(fixtureGovernancePayload.rows[1])
];
invalidRows[1].fixtureId = invalidRows[0].fixtureId;
invalidRows[1].reviewers = [invalidRows[1].owner];
invalidRows[1].mutationPolicy = 'allow-generated-refresh';
invalidRows[1].conformanceLevels = ['C1'];

const invalidPayload = {
  ...fixtureGovernancePayload,
  rows: invalidRows
};

const invalid = validateUsrFixtureGovernanceControls({
  fixtureGovernancePayload: invalidPayload
});
assert.equal(invalid.ok, false, 'expected invalid fixture governance rows to fail validation');
assert(
  invalid.errors.some((message) => message.includes('fixtureId must be unique within fixture-governance matrix')),
  'expected duplicate fixture id error'
);
assert(
  invalid.errors.some((message) => message.includes('blocking fixture rows cannot use mutationPolicy=allow-generated-refresh')),
  'expected blocking mutation policy error'
);
assert(
  invalid.errors.some((message) => message.includes('framework fixture rows must include C4 in conformanceLevels')),
  'expected framework conformance level error'
);

const report = buildUsrFixtureGovernanceValidationReport({
  fixtureGovernancePayload: invalidPayload,
  lane: 'nightly',
  scope: { scopeType: 'lane', scopeId: 'nightly' }
});
assert.equal(report.payload.artifactId, 'usr-validation-report');
assert.equal(report.payload.status, 'fail');
assert.equal(report.payload.summary.validationDomain, 'fixture-governance');
assert.equal(report.payload.summary.errorCount > 0, true);
assert.equal(report.payload.scope.scopeType, 'lane');
assert.equal(report.payload.scope.scopeId, 'nightly');

console.log('usr fixture governance validation report test passed');
