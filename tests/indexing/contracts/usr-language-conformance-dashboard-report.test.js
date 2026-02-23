#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildUsrLanguageConformanceDashboardReport } from '../../../src/contracts/validators/usr-matrix.js';
import { ensureTestingEnv } from '../../helpers/test-env.js';

ensureTestingEnv(process.env);

const root = process.cwd();
const readMatrix = (fileName) => JSON.parse(
  fs.readFileSync(path.join(root, 'tests', 'lang', 'matrix', fileName), 'utf8')
);

const languageProfilesPayload = readMatrix('usr-language-profiles.json');
const conformanceLevelsPayload = readMatrix('usr-conformance-levels.json');

const validReport = buildUsrLanguageConformanceDashboardReport({
  languageProfilesPayload,
  conformanceLevelsPayload,
  knownLanes: []
});
assert.equal(validReport.payload.artifactId, 'usr-conformance-summary');
assert.equal(validReport.payload.summary.dashboard, 'language-conformance');
assert.equal(typeof validReport.payload.summary.levelCoverage.C0.requiredCount, 'number');
assert.equal(validReport.payload.summary.profileCount > 0, true);

const invalidConformancePayload = structuredClone(conformanceLevelsPayload);
const removedProfileId = invalidConformancePayload.rows.find((row) => row.profileType === 'language')?.profileId;
assert.equal(typeof removedProfileId, 'string');
invalidConformancePayload.rows = invalidConformancePayload.rows.filter((row) => row.profileId !== removedProfileId);

const invalidReport = buildUsrLanguageConformanceDashboardReport({
  languageProfilesPayload,
  conformanceLevelsPayload: invalidConformancePayload,
  knownLanes: []
});
assert.equal(invalidReport.ok, false, 'expected missing language conformance rows to fail dashboard report');
assert(
  invalidReport.errors.some((message) => message.includes('missing conformance-levels row for language profile')),
  'expected missing language conformance row error'
);

console.log('usr language conformance dashboard report test passed');
