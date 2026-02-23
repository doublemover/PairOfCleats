#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildUsrFrameworkConformanceDashboardReport } from '../../../src/contracts/validators/usr-matrix.js';
import { ensureTestingEnv } from '../../helpers/test-env.js';

ensureTestingEnv(process.env);

const root = process.cwd();
const readMatrix = (fileName) => JSON.parse(
  fs.readFileSync(path.join(root, 'tests', 'lang', 'matrix', fileName), 'utf8')
);

const frameworkProfilesPayload = readMatrix('usr-framework-profiles.json');
const languageProfilesPayload = readMatrix('usr-language-profiles.json');
const conformanceLevelsPayload = readMatrix('usr-conformance-levels.json');

const validReport = buildUsrFrameworkConformanceDashboardReport({
  frameworkProfilesPayload,
  languageProfilesPayload,
  conformanceLevelsPayload,
  knownLanes: []
});
assert.equal(validReport.payload.artifactId, 'usr-conformance-summary');
assert.equal(validReport.payload.summary.dashboard, 'framework-conformance');
assert.equal(validReport.payload.summary.profileCount > 0, true);

const invalidFrameworkPayload = structuredClone(frameworkProfilesPayload);
const firstRow = invalidFrameworkPayload.rows[0];
assert.ok(firstRow, 'expected at least one framework profile row');
firstRow.appliesToLanguages = [...(firstRow.appliesToLanguages || []), 'missing-language-id'];

const invalidReport = buildUsrFrameworkConformanceDashboardReport({
  frameworkProfilesPayload: invalidFrameworkPayload,
  languageProfilesPayload,
  conformanceLevelsPayload,
  knownLanes: []
});
assert.equal(invalidReport.ok, false, 'expected unknown framework language mapping to fail dashboard');
assert(
  invalidReport.errors.some((message) => message.includes('unknown language in appliesToLanguages: missing-language-id')),
  'expected missing language mapping error'
);

console.log('usr framework conformance dashboard report test passed');
