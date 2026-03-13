#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  createDoctorCommandResolver,
  createDoctorRunner,
  createToolingDoctorTempRoot,
  writeDoctorWorkspaceMarker
} from '../../helpers/tooling-doctor-fixture.js';

const tempRoot = await createToolingDoctorTempRoot('tooling-doctor-workspace-phpactor');
const resolveCommandProfile = createDoctorCommandResolver({
  available: ['phpactor']
});

const { runDoctor } = createDoctorRunner({
  tempRoot,
  enabledTools: ['phpactor'],
  resolveCommandProfile
});

const reportMissingMarkers = await runDoctor();
const providerMissing = (reportMissingMarkers.providers || []).find((entry) => entry.id === 'phpactor');
const missingCheck = (providerMissing?.checks || []).find((check) => check.name === 'phpactor-workspace-model');
assert.ok(missingCheck, 'expected workspace-model check for phpactor provider');
assert.equal(missingCheck.status, 'warn', 'expected warn when PHP workspace markers are missing');

await writeDoctorWorkspaceMarker(tempRoot, 'phpactor');
const reportWithMarkers = await runDoctor();
const providerPresent = (reportWithMarkers.providers || []).find((entry) => entry.id === 'phpactor');
const presentCheck = (providerPresent?.checks || []).find((check) => check.name === 'phpactor-workspace-model');
assert.ok(presentCheck, 'expected workspace-model check after marker creation');
assert.equal(presentCheck.status, 'ok', 'expected ok when PHP workspace markers are present');

console.log('tooling doctor workspace model phpactor detection test passed');
