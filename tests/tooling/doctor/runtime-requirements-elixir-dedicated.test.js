#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  createDoctorCommandResolver,
  createToolingDoctorTempRoot,
  runToolingDoctorFixture
} from '../../helpers/tooling-doctor-fixture.js';

const tempRoot = await createToolingDoctorTempRoot('tooling-doctor-runtime-reqs-elixir');
const resolveCommandProfile = createDoctorCommandResolver({
  available: ['elixir-ls'],
  missing: ['elixir', 'erl']
});

const report = await runToolingDoctorFixture({
  tempRoot,
  enabledTools: ['elixir-ls'],
  resolveCommandProfile
});

const provider = (report.providers || []).find((entry) => entry.id === 'elixir-ls');
assert.ok(provider, 'expected dedicated elixir-ls provider report');
const elixirRuntimeCheck = (provider.checks || []).find((check) => check.name === 'elixir-ls-runtime-elixir');
assert.ok(elixirRuntimeCheck, 'expected Elixir runtime requirement check');
assert.equal(elixirRuntimeCheck.status, 'error', 'expected Elixir runtime check error when elixir command missing');
const erlRuntimeCheck = (provider.checks || []).find((check) => check.name === 'elixir-ls-runtime-erl');
assert.ok(erlRuntimeCheck, 'expected Erlang runtime requirement check');
assert.equal(erlRuntimeCheck.status, 'error', 'expected Erlang runtime check error when erl command missing');

console.log('tooling doctor dedicated elixir runtime requirements test passed');
