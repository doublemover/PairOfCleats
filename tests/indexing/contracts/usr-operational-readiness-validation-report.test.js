#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildUsrOperationalReadinessValidationReport } from '../../../src/contracts/validators/usr-matrix.js';
import { ensureTestingEnv } from '../../helpers/test-env.js';

ensureTestingEnv(process.env);

const root = process.cwd();
const readMatrix = (fileName) => JSON.parse(
  fs.readFileSync(path.join(root, 'tests', 'lang', 'matrix', fileName), 'utf8')
);

const operationalReadinessPolicyPayload = readMatrix('usr-operational-readiness-policy.json');
const qualityGatesPayload = readMatrix('usr-quality-gates.json');
const languageProfilesPayload = readMatrix('usr-language-profiles.json');
const conformanceLevelsPayload = readMatrix('usr-conformance-levels.json');

const report = buildUsrOperationalReadinessValidationReport({
  operationalReadinessPolicyPayload,
  qualityGatesPayload,
  languageProfilesPayload,
  conformanceLevelsPayload,
  knownLanes: []
});
assert.equal(report.payload.artifactId, 'usr-operational-readiness-validation');
assert.equal(report.payload.summary.rowCount > 0, true);
assert.equal(typeof report.payload.summary.blocked, 'boolean');

const blockingGateId = qualityGatesPayload.rows.find((row) => row.blocking === true)?.id;
assert.equal(typeof blockingGateId, 'string');

const blockedReport = buildUsrOperationalReadinessValidationReport({
  operationalReadinessPolicyPayload,
  qualityGatesPayload,
  languageProfilesPayload,
  conformanceLevelsPayload,
  knownLanes: [],
  missingArtifactSchemas: ['usr-operational-readiness-validation'],
  failingBlockingGateIds: [blockingGateId]
});
assert.equal(blockedReport.blocked, true);
assert(
  blockedReport.blockers.some((blocker) => blocker.includes('missing-artifact:usr-operational-readiness-validation')),
  'expected missing artifact blocker'
);
assert(
  blockedReport.blockers.some((blocker) => blocker.includes(`failing-gate:${blockingGateId}`)),
  'expected failing gate blocker'
);

console.log('usr operational readiness validation report test passed');
