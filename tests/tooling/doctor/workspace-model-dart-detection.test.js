#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  createDoctorCommandResolver,
  createDoctorRunner,
  createToolingDoctorTempRoot,
  writeDoctorWorkspaceMarker
} from '../../helpers/tooling-doctor-fixture.js';

const tempRoot = await createToolingDoctorTempRoot('tooling-doctor-workspace-dart');
const resolveCommandProfile = createDoctorCommandResolver({
  available: ['dart']
});

const { runDoctor } = createDoctorRunner({
  tempRoot,
  enabledTools: ['dart'],
  resolveCommandProfile
});

const reportMissingMarkers = await runDoctor();
const providerMissing = (reportMissingMarkers.providers || []).find((entry) => entry.id === 'dart');
const missingCheck = (providerMissing?.checks || []).find((check) => check.name === 'dart-workspace-model');
assert.ok(missingCheck, 'expected workspace-model check for dart provider');
assert.equal(missingCheck.status, 'warn', 'expected warn when Dart workspace markers are missing');

await writeDoctorWorkspaceMarker(tempRoot, 'dart');
const reportWithMarkers = await runDoctor();
const providerPresent = (reportWithMarkers.providers || []).find((entry) => entry.id === 'dart');
const presentCheck = (providerPresent?.checks || []).find((check) => check.name === 'dart-workspace-model');
assert.ok(presentCheck, 'expected workspace-model check after marker creation');
assert.equal(presentCheck.status, 'ok', 'expected ok when Dart workspace markers are present');

console.log('tooling doctor workspace model dart detection test passed');
