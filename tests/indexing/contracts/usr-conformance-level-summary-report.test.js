#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildUsrConformanceLevelSummaryReport } from '../../../src/contracts/validators/usr-matrix.js';
import { ensureTestingEnv } from '../../helpers/test-env.js';

ensureTestingEnv(process.env);

const root = process.cwd();
const readMatrix = (fileName) => JSON.parse(
  fs.readFileSync(path.join(root, 'tests', 'lang', 'matrix', fileName), 'utf8')
);

const languageProfilesPayload = readMatrix('usr-language-profiles.json');
const conformanceLevelsPayload = readMatrix('usr-conformance-levels.json');

const validReport = buildUsrConformanceLevelSummaryReport({
  targetLevel: 'C1',
  languageProfilesPayload,
  conformanceLevelsPayload,
  knownLanes: []
});
assert.equal(validReport.payload.artifactId, 'usr-conformance-summary');
assert.equal(validReport.payload.summary.targetLevel, 'C1');
assert.equal(validReport.payload.summary.profileCount > 0, true);
assert.equal(validReport.payload.scope.scopeType, 'lane');

const invalidReport = buildUsrConformanceLevelSummaryReport({
  targetLevel: 'C9',
  languageProfilesPayload,
  conformanceLevelsPayload,
  knownLanes: []
});
assert.equal(invalidReport.ok, false);
assert.equal(invalidReport.payload.status, 'fail');
assert(
  invalidReport.errors.some((message) => message.includes('unsupported target conformance level')),
  'expected unsupported target level error'
);

console.log('usr conformance level summary report test passed');
