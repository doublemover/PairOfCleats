#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  createDoctorCommandResolver,
  createDoctorRunner,
  createToolingDoctorTempRoot,
  writeDoctorWorkspaceMarker
} from '../../helpers/tooling-doctor-fixture.js';

const tempRoot = await createToolingDoctorTempRoot('tooling-doctor-workspace-haskell');
const resolveCommandProfile = createDoctorCommandResolver({
  available: ['haskell-language-server']
});

const { runDoctor } = createDoctorRunner({
  tempRoot,
  enabledTools: ['haskell-language-server'],
  resolveCommandProfile
});

const reportMissingMarkers = await runDoctor();
const providerMissing = (reportMissingMarkers.providers || []).find((entry) => entry.id === 'haskell-language-server');
const missingCheck = (providerMissing?.checks || []).find((check) => check.name === 'haskell-language-server-workspace-model');
assert.ok(missingCheck, 'expected workspace-model check for haskell-language-server provider');
assert.equal(missingCheck.status, 'warn', 'expected warn when Haskell workspace markers are missing');

await writeDoctorWorkspaceMarker(tempRoot, 'haskell-language-server');
const reportWithMarkers = await runDoctor();
const providerPresent = (reportWithMarkers.providers || []).find((entry) => entry.id === 'haskell-language-server');
const presentCheck = (providerPresent?.checks || []).find((check) => check.name === 'haskell-language-server-workspace-model');
assert.ok(presentCheck, 'expected workspace-model check after marker creation');
assert.equal(presentCheck.status, 'ok', 'expected ok when Haskell workspace markers are present');

console.log('tooling doctor workspace model haskell detection test passed');
