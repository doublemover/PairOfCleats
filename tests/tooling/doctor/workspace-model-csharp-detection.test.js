#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  createDoctorCommandResolver,
  createDoctorRunner,
  createToolingDoctorTempRoot,
  writeDoctorWorkspaceMarker
} from '../../helpers/tooling-doctor-fixture.js';

const tempRoot = await createToolingDoctorTempRoot('tooling-doctor-workspace-csharp');
const resolveCommandProfile = createDoctorCommandResolver({
  available: ['csharp-ls']
});

const { runDoctor } = createDoctorRunner({
  tempRoot,
  enabledTools: ['csharp-ls'],
  resolveCommandProfile
});

const reportMissingMarkers = await runDoctor();
const providerMissing = (reportMissingMarkers.providers || []).find((entry) => entry.id === 'csharp-ls');
const missingCheck = (providerMissing?.checks || []).find((check) => check.name === 'csharp-ls-workspace-model');
assert.ok(missingCheck, 'expected workspace-model check for csharp-ls provider');
assert.equal(missingCheck.status, 'warn', 'expected warn when C# workspace markers are missing');

await writeDoctorWorkspaceMarker(tempRoot, 'csharp-ls');
const reportWithMarkers = await runDoctor();
const providerPresent = (reportWithMarkers.providers || []).find((entry) => entry.id === 'csharp-ls');
const presentCheck = (providerPresent?.checks || []).find((check) => check.name === 'csharp-ls-workspace-model');
assert.ok(presentCheck, 'expected workspace-model check after marker creation');
assert.equal(presentCheck.status, 'ok', 'expected ok when C# workspace markers are present');

console.log('tooling doctor workspace model csharp detection test passed');
