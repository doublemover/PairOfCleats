#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  createDoctorCommandResolver,
  createToolingDoctorTempRoot,
  runToolingDoctorFixture
} from '../../helpers/tooling-doctor-fixture.js';

const tempRoot = await createToolingDoctorTempRoot('tooling-doctor-runtime-reqs-haskell');
const resolveCommandProfile = createDoctorCommandResolver({
  available: ['haskell-language-server'],
  missing: ['ghc']
});

const report = await runToolingDoctorFixture({
  tempRoot,
  enabledTools: ['haskell-language-server'],
  resolveCommandProfile
});

const provider = (report.providers || []).find((entry) => entry.id === 'haskell-language-server');
assert.ok(provider, 'expected dedicated haskell-language-server provider report');
const ghcRuntimeCheck = (provider.checks || []).find((check) => check.name === 'haskell-language-server-runtime-ghc');
assert.ok(ghcRuntimeCheck, 'expected GHC runtime requirement check');
assert.equal(ghcRuntimeCheck.status, 'error', 'expected GHC runtime check error when ghc command missing');

console.log('tooling doctor dedicated haskell runtime requirements test passed');
