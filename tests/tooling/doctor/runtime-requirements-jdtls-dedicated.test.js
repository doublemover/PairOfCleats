#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  createDoctorCommandResolver,
  createToolingDoctorTempRoot,
  runToolingDoctorFixture
} from '../../helpers/tooling-doctor-fixture.js';

const tempRoot = await createToolingDoctorTempRoot('tooling-doctor-runtime-reqs-jdtls');
const resolveCommandProfile = createDoctorCommandResolver({
  available: ['jdtls'],
  missing: ['java']
});

const report = await runToolingDoctorFixture({
  tempRoot,
  enabledTools: ['jdtls'],
  resolveCommandProfile
});

const provider = (report.providers || []).find((entry) => entry.id === 'jdtls');
assert.ok(provider, 'expected dedicated jdtls provider report');
const javaRuntimeCheck = (provider.checks || []).find((check) => check.name === 'jdtls-runtime-java');
assert.ok(javaRuntimeCheck, 'expected Java runtime requirement check');
assert.equal(javaRuntimeCheck.status, 'error', 'expected Java runtime check error when java command missing');

console.log('tooling doctor dedicated jdtls runtime requirements test passed');
