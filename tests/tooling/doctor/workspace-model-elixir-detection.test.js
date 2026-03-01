#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  createDoctorCommandResolver,
  createDoctorRunner,
  createToolingDoctorTempRoot,
  writeDoctorWorkspaceMarker
} from '../../helpers/tooling-doctor-fixture.js';

const tempRoot = await createToolingDoctorTempRoot('tooling-doctor-workspace-elixir');
const resolveCommandProfile = createDoctorCommandResolver({
  available: ['elixir-ls']
});

const { runDoctor } = createDoctorRunner({
  tempRoot,
  enabledTools: ['elixir-ls'],
  resolveCommandProfile
});

const reportMissingMarkers = await runDoctor();
const providerMissing = (reportMissingMarkers.providers || []).find((entry) => entry.id === 'elixir-ls');
const missingCheck = (providerMissing?.checks || []).find((check) => check.name === 'elixir-ls-workspace-model');
assert.ok(missingCheck, 'expected workspace-model check for elixir-ls provider');
assert.equal(missingCheck.status, 'warn', 'expected warn when Elixir workspace markers are missing');

await writeDoctorWorkspaceMarker(tempRoot, 'elixir-ls');
const reportWithMarkers = await runDoctor();
const providerPresent = (reportWithMarkers.providers || []).find((entry) => entry.id === 'elixir-ls');
const presentCheck = (providerPresent?.checks || []).find((check) => check.name === 'elixir-ls-workspace-model');
assert.ok(presentCheck, 'expected workspace-model check after marker creation');
assert.equal(presentCheck.status, 'ok', 'expected ok when Elixir workspace markers are present');

console.log('tooling doctor workspace model elixir detection test passed');
