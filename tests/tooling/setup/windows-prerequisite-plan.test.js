#!/usr/bin/env node
// Source UNVALIDATED; injected metadata/children never acquire or install tools.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { WINDOWS_PREREQUISITE_CATALOG } from '../../../tools/setup/windows-prerequisite-catalog.js';
import { createWindowsPrerequisitePlan, applyWindowsPrerequisitePlan } from '../../../tools/setup/windows-prerequisite-plan.js';
import { runPrerequisiteCli } from '../../../tools/setup/prerequisites.js';

const request = { mode: 'install', arch: 'x64', installPath: 'C:\\fixture\\BuildTools',
  bootstrapperPath: 'C:\\fixture\\vs_BuildTools.exe', stateRoot: 'C:\\fixture\\state' };
let launches = 0;
const metadata = { path: request.bootstrapperPath, bytes: 1234, sha256: WINDOWS_PREREQUISITE_CATALOG.sha256,
  signature: { status: 'Valid', subject: 'CN=Microsoft Corporation, O=Microsoft Corporation, C=US', thumbprint: 'a'.repeat(40), productVersion: 'fixture-observed-version' } };
const dependencies = { platform: 'win32', env: {}, inspectInstaller: async () => metadata,
  discoverTarget: async () => ({ state: 'absent', instance: null }),
  spawn: async () => { launches++; return { exitCode: 0 }; } };
const plan = await createWindowsPrerequisitePlan(request, dependencies);
assert.equal(plan.installer.bytes, 1234, 'actual observed bytes are separate from unavailable official length');
assert.equal(plan.acquisition.bytes, null);
assert.ok(plan.blockers.some(value => value.code === 'deferred-unknown-system-destination-allocation'));
await assert.rejects(applyWindowsPrerequisitePlan(plan, dependencies), /explicit system-change approval/);
const blocked = await applyWindowsPrerequisitePlan(plan, { ...dependencies, approveSystemChanges: true, acceptInstallerTerms: true });
assert.equal(blocked.state, 'blocked');
assert.equal(launches, 0, 'explicit approval cannot turn an unknown peak into a qualified allocation');
await assert.rejects(applyWindowsPrerequisitePlan({ ...plan, action: { command: 'untrusted-command', args: [] } },
  { ...dependencies, approveSystemChanges: true, acceptInstallerTerms: true }), /changed/);
const invalidSignature = await createWindowsPrerequisitePlan(request, { ...dependencies,
  inspectInstaller: async () => ({ ...metadata, signature: { ...metadata.signature, status: 'NotTrusted' } }) });
assert.ok(invalidSignature.blockers.some(value => value.code === 'installer-identity-or-signature-disagrees'));
const targetCollision = await createWindowsPrerequisitePlan(request, { ...dependencies,
  discoverTarget: async () => ({ state: 'unknown-existing-target', instance: null }) });
assert.ok(targetCollision.blockers.some(value => value.code === 'install-target-already-present-or-unknown'));
const wrongProduct = await createWindowsPrerequisitePlan({ ...request, mode: 'modify' }, { ...dependencies,
  discoverTarget: async () => ({ state: 'registered', instance: { productId: 'OtherProduct', installationVersion: '17.14', isComplete: true } }) });
assert.ok(wrongProduct.blockers.some(value => value.code === 'modify-requires-complete-exact-build-tools-2022-instance'));
let appliedOptions;
await runPrerequisiteCli(['--apply-plan', 'inert.json', '--approve-system-changes', '--accept-installer-terms'], {
  readInput: async () => plan, apply: async (_plan, options) => { appliedOptions = options; return { state: 'fixture' }; }
});
assert.equal(appliedOptions.approveSystemChanges, true);
assert.equal(appliedOptions.acceptInstallerTerms, true);
await assert.rejects(runPrerequisiteCli(['--plan', 'inert.json', '--approve-system-changes'], { readInput: async () => request }), /only to explicit/);

if (process.platform === 'win32') {
  const parent = path.join(process.cwd(), '.tmp', 'tasks', 'windows-prerequisite-plan');
  await fs.mkdir(parent, { recursive: true });
  const stateRoot = await fs.mkdtemp(path.join(parent, 'case-'));
  try {
    const fixtureCatalog = { ...WINDOWS_PREREQUISITE_CATALOG, allocation: { complete: true,
      writes: [{ root: stateRoot, requiredBytes: 64, source: 'inert-fixture-only-not-a-production-estimate' }] } };
    const options = { ...dependencies, catalog: fixtureCatalog };
    const approved = await createWindowsPrerequisitePlan({ ...request, stateRoot }, options);
    const outcome = await applyWindowsPrerequisitePlan(approved, { ...options, approveSystemChanges: true, acceptInstallerTerms: true,
      discover: () => ({ childEnv: { npm_config_python: 'fixture-python' } }), verifyCapability: async () => ({ state: 'fixture' }) });
    assert.equal(outcome.state, 'prerequisites-verified-locked-bootstrap-required');
    assert.equal(outcome.readinessRecorded, false);
    assert.equal(outcome.childEnv.npm_config_python, 'fixture-python');
    const reboot = await applyWindowsPrerequisitePlan(approved, { ...options, approveSystemChanges: true, acceptInstallerTerms: true,
      spawn: async () => ({ exitCode: 3010 }) });
    assert.equal(reboot.state, 'reboot-required');
  } finally { await fs.rm(stateRoot, { recursive: true, force: true }); }
}
console.log('Windows prerequisite review/apply source fixture completed.');
