#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  createDoctorCommandResolver,
  createDoctorRunner,
  createToolingDoctorTempRoot,
  writeDoctorWorkspaceMarker
} from '../../helpers/tooling-doctor-fixture.js';

const tempRoot = await createToolingDoctorTempRoot('tooling-doctor-workspace-model');
const providerId = 'lsp-java-dedicated';
const resolveCommandProfile = createDoctorCommandResolver({
  available: ['jdtls']
});

const { runDoctor } = createDoctorRunner({
  tempRoot,
  enabledTools: [providerId],
  toolingConfig: {
    lsp: {
      enabled: true,
      servers: [
        { id: 'java-dedicated', cmd: 'jdtls', languages: ['java'] }
      ]
    }
  },
  resolveCommandProfile
});

const reportMissingMarkers = await runDoctor();
const javaMissing = (reportMissingMarkers.providers || []).find((entry) => entry.id === providerId);
const missingCheck = (javaMissing?.checks || []).find((check) => check.name === `${providerId}-workspace-model`);
assert.ok(missingCheck, 'expected workspace-model check for jdtls');
assert.equal(missingCheck.status, 'warn', 'expected warn when Java workspace markers are missing');

await writeDoctorWorkspaceMarker(tempRoot, providerId);
const reportWithMarkers = await runDoctor();
const javaPresent = (reportWithMarkers.providers || []).find((entry) => entry.id === providerId);
const presentCheck = (javaPresent?.checks || []).find((check) => check.name === `${providerId}-workspace-model`);
assert.ok(presentCheck, 'expected workspace-model check after marker creation');
assert.equal(presentCheck.status, 'ok', 'expected ok when Java workspace markers are present');

console.log('tooling doctor workspace model detection test passed');
