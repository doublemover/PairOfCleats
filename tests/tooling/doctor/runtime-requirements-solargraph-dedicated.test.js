#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  createDoctorCommandResolver,
  createToolingDoctorTempRoot,
  runToolingDoctorFixture
} from '../../helpers/tooling-doctor-fixture.js';

const tempRoot = await createToolingDoctorTempRoot('tooling-doctor-runtime-reqs-solargraph');
const resolveCommandProfile = createDoctorCommandResolver({
  available: ['solargraph'],
  missing: ['ruby', 'gem']
});

const report = await runToolingDoctorFixture({
  tempRoot,
  enabledTools: ['solargraph'],
  resolveCommandProfile
});

const provider = (report.providers || []).find((entry) => entry.id === 'solargraph');
assert.ok(provider, 'expected dedicated solargraph provider report');
const rubyRuntimeCheck = (provider.checks || []).find((check) => check.name === 'solargraph-runtime-ruby');
assert.ok(rubyRuntimeCheck, 'expected Ruby runtime requirement check');
assert.equal(rubyRuntimeCheck.status, 'error', 'expected Ruby runtime check error when ruby command missing');
const gemRuntimeCheck = (provider.checks || []).find((check) => check.name === 'solargraph-runtime-gem');
assert.ok(gemRuntimeCheck, 'expected RubyGems runtime requirement check');
assert.equal(gemRuntimeCheck.status, 'error', 'expected RubyGems runtime check error when gem command missing');

console.log('tooling doctor dedicated solargraph runtime requirements test passed');
