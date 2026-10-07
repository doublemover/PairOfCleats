#!/usr/bin/env node
import assert from 'node:assert/strict';
import { resolveInstallerRequirementProbeArgs, verifyInstallerRequirementProbe } from '../../../tools/tooling/install-requirements.js';

assert.deepEqual(resolveInstallerRequirementProbeArgs('go'), [['version']], 'the SDK uses its documented version command');
for (const stdout of ['', 'GNU Go 3.8', 'another tool version 1.0', 'go version', 'go version go1.27.1']) {
  assert.equal(verifyInstallerRequirementProbe('go', { ok: true, stdout }).ok, false,
    'exit zero without the SDK protocol does not satisfy the prerequisite');
}
for (const stdout of ['go version go1.27.1 linux/amd64\n', 'go version go1.28rc1 windows/arm64',
  'go version devel go1.28-test 2026-10-04 darwin/arm64']) {
  const result = verifyInstallerRequirementProbe('go', { ok: true, stdout });
  assert.equal(result.ok, true);
  assert.equal(result.verificationLevel, 'go-sdk-version-output');
  assert.equal(result.identity.family, 'go');
}
assert.equal(verifyInstallerRequirementProbe('go', { ok: false, outcome: 'nonzero',
  stdout: 'go version go1.27.1 linux/amd64' }).ok, false, 'recognized text cannot erase an execution failure');
assert.equal(verifyInstallerRequirementProbe('dotnet', { ok: true }).ok, true, 'other prerequisite behavior is unchanged');
console.log('Go prerequisite identity rejects empty/unrelated exit-zero output and retains genuine release/development SDK protocols.');
