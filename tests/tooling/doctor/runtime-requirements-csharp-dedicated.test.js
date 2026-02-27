#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  createDoctorCommandResolver,
  createToolingDoctorTempRoot,
  runToolingDoctorFixture
} from '../../helpers/tooling-doctor-fixture.js';

const tempRoot = await createToolingDoctorTempRoot('tooling-doctor-runtime-reqs-csharp');
const resolveCommandProfile = createDoctorCommandResolver({
  available: ['csharp-ls'],
  missing: ['dotnet']
});

const report = await runToolingDoctorFixture({
  tempRoot,
  enabledTools: ['csharp-ls'],
  resolveCommandProfile
});

const provider = (report.providers || []).find((entry) => entry.id === 'csharp-ls');
assert.ok(provider, 'expected dedicated csharp-ls provider report');
const dotnetRuntimeCheck = (provider.checks || []).find((check) => check.name === 'csharp-ls-runtime-dotnet');
assert.ok(dotnetRuntimeCheck, 'expected .NET runtime requirement check');
assert.equal(dotnetRuntimeCheck.status, 'error', 'expected .NET runtime check error when dotnet command missing');

console.log('tooling doctor dedicated csharp runtime requirements test passed');
