#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildUsrLanguageConformanceDashboardReport,
  buildUsrFrameworkConformanceDashboardReport
} from '../../../src/contracts/validators/usr-matrix.js';
import { validateUsrReport } from '../../../src/contracts/validators/usr.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');

const languageProfiles = JSON.parse(
  fs.readFileSync(path.join(repoRoot, 'tests', 'lang', 'matrix', 'usr-language-profiles.json'), 'utf8')
);
const frameworkProfiles = JSON.parse(
  fs.readFileSync(path.join(repoRoot, 'tests', 'lang', 'matrix', 'usr-framework-profiles.json'), 'utf8')
);
const conformanceLevels = JSON.parse(
  fs.readFileSync(path.join(repoRoot, 'tests', 'lang', 'matrix', 'usr-conformance-levels.json'), 'utf8')
);

const knownConformanceLanes = ['conformance-c0', 'conformance-c1', 'conformance-c2', 'conformance-c3', 'conformance-c4'];

const languageDashboard = buildUsrLanguageConformanceDashboardReport({
  languageProfilesPayload: languageProfiles,
  conformanceLevelsPayload: conformanceLevels,
  knownLanes: knownConformanceLanes,
  runId: 'run-usr-language-conformance-dashboard-001',
  lane: 'ci',
  producerId: 'usr-language-conformance-dashboard-harness'
});
assert.equal(languageDashboard.ok, true, `language conformance dashboard should pass: ${languageDashboard.errors.join('; ')}`);
assert.equal(languageDashboard.rows.some((row) => row.rowType === 'language-conformance-dashboard'), true, 'language dashboard must emit language-conformance rows');
const languageDashboardValidation = validateUsrReport('usr-conformance-summary', languageDashboard.payload);
assert.equal(languageDashboardValidation.ok, true, `language conformance dashboard payload must validate: ${languageDashboardValidation.errors.join('; ')}`);

const frameworkDashboard = buildUsrFrameworkConformanceDashboardReport({
  frameworkProfilesPayload: frameworkProfiles,
  languageProfilesPayload: languageProfiles,
  conformanceLevelsPayload: conformanceLevels,
  knownLanes: knownConformanceLanes,
  runId: 'run-usr-framework-conformance-dashboard-001',
  lane: 'ci',
  producerId: 'usr-framework-conformance-dashboard-harness'
});
assert.equal(frameworkDashboard.ok, true, `framework conformance dashboard should pass: ${frameworkDashboard.errors.join('; ')}`);
assert.equal(frameworkDashboard.rows.some((row) => row.rowType === 'framework-conformance-dashboard'), true, 'framework dashboard must emit framework-conformance rows');
const frameworkDashboardValidation = validateUsrReport('usr-conformance-summary', frameworkDashboard.payload);
assert.equal(frameworkDashboardValidation.ok, true, `framework conformance dashboard payload must validate: ${frameworkDashboardValidation.errors.join('; ')}`);

const languageDashboardNegative = buildUsrLanguageConformanceDashboardReport({
  languageProfilesPayload: languageProfiles,
  conformanceLevelsPayload: conformanceLevels,
  knownLanes: knownConformanceLanes.filter((laneId) => laneId !== 'conformance-c1'),
  runId: 'run-usr-language-conformance-dashboard-002',
  lane: 'ci'
});
assert.equal(languageDashboardNegative.ok, false, 'language dashboard must fail when required conformance lane coverage is missing');

const frameworkDashboardNegative = buildUsrFrameworkConformanceDashboardReport({
  frameworkProfilesPayload: frameworkProfiles,
  languageProfilesPayload: languageProfiles,
  conformanceLevelsPayload: conformanceLevels,
  knownLanes: knownConformanceLanes.filter((laneId) => laneId !== 'conformance-c4'),
  runId: 'run-usr-framework-conformance-dashboard-002',
  lane: 'ci'
});
assert.equal(frameworkDashboardNegative.ok, false, 'framework dashboard must fail when required C4 lane coverage is missing');

console.log('usr conformance dashboard validation checks passed');
