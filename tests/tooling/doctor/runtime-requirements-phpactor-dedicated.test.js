#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  createDoctorCommandResolver,
  createToolingDoctorTempRoot,
  runToolingDoctorFixture
} from '../../helpers/tooling-doctor-fixture.js';

const tempRoot = await createToolingDoctorTempRoot('tooling-doctor-runtime-reqs-phpactor');
const resolveCommandProfile = createDoctorCommandResolver({
  available: ['phpactor'],
  missing: ['php']
});

const report = await runToolingDoctorFixture({
  tempRoot,
  enabledTools: ['phpactor'],
  resolveCommandProfile
});

const provider = (report.providers || []).find((entry) => entry.id === 'phpactor');
assert.ok(provider, 'expected dedicated phpactor provider report');
const phpRuntimeCheck = (provider.checks || []).find((check) => check.name === 'phpactor-runtime-php');
assert.ok(phpRuntimeCheck, 'expected PHP runtime requirement check');
assert.equal(phpRuntimeCheck.status, 'error', 'expected PHP runtime check error when php command missing');

console.log('tooling doctor dedicated phpactor runtime requirements test passed');
