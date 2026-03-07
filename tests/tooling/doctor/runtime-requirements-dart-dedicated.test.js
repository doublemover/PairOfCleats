#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  createDoctorCommandResolver,
  createToolingDoctorTempRoot,
  runToolingDoctorFixture
} from '../../helpers/tooling-doctor-fixture.js';

const tempRoot = await createToolingDoctorTempRoot('tooling-doctor-runtime-reqs-dart');
const resolveCommandProfile = createDoctorCommandResolver({
  available: ['dart'],
  reject: ({ cmd, args }) => cmd === 'dart' && args.length === 1 && args[0] === '--version'
});

const report = await runToolingDoctorFixture({
  tempRoot,
  enabledTools: ['dart'],
  resolveCommandProfile
});

const provider = (report.providers || []).find((entry) => entry.id === 'dart');
assert.ok(provider, 'expected dedicated dart provider report');
const dartRuntimeCheck = (provider.checks || []).find((check) => check.name === 'dart-runtime-dart-sdk');
assert.ok(dartRuntimeCheck, 'expected Dart SDK runtime requirement check');
assert.equal(dartRuntimeCheck.status, 'error', 'expected Dart SDK runtime check error when --version probe fails');

console.log('tooling doctor dedicated dart runtime requirements test passed');
