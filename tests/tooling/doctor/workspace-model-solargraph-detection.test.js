#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  createDoctorCommandResolver,
  createDoctorRunner,
  createToolingDoctorTempRoot,
  writeDoctorWorkspaceMarker
} from '../../helpers/tooling-doctor-fixture.js';

const tempRoot = await createToolingDoctorTempRoot('tooling-doctor-workspace-solargraph');
const resolveCommandProfile = createDoctorCommandResolver({
  available: ['solargraph']
});

const { runDoctor } = createDoctorRunner({
  tempRoot,
  enabledTools: ['solargraph'],
  resolveCommandProfile
});

const reportMissingMarkers = await runDoctor();
const providerMissing = (reportMissingMarkers.providers || []).find((entry) => entry.id === 'solargraph');
const missingCheck = (providerMissing?.checks || []).find((check) => check.name === 'solargraph-workspace-model');
assert.ok(missingCheck, 'expected workspace-model check for solargraph provider');
assert.equal(missingCheck.status, 'warn', 'expected warn when Ruby workspace markers are missing');

await writeDoctorWorkspaceMarker(tempRoot, 'solargraph');
const reportWithMarkers = await runDoctor();
const providerPresent = (reportWithMarkers.providers || []).find((entry) => entry.id === 'solargraph');
const presentCheck = (providerPresent?.checks || []).find((check) => check.name === 'solargraph-workspace-model');
assert.ok(presentCheck, 'expected workspace-model check after marker creation');
assert.equal(presentCheck.status, 'ok', 'expected ok when Ruby workspace markers are present');

console.log('tooling doctor workspace model solargraph detection test passed');
