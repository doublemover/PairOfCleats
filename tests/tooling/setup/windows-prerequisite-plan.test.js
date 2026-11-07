#!/usr/bin/env node
// Source UNVALIDATED; injected metadata/children never acquire or install tools.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { WINDOWS_PREREQUISITE_CATALOG } from '../../../tools/setup/windows-prerequisite-catalog.js';
import { createWindowsPrerequisitePlan, applyWindowsPrerequisitePlan, inspectWindowsPrerequisiteInstaller } from '../../../tools/setup/windows-prerequisite-plan.js';
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
const cancelled = new AbortController();
const interruption = new Error('inert prerequisite inspection interrupted');
let discoveries = 0;
await assert.rejects(createWindowsPrerequisitePlan(request, { ...dependencies, signal: cancelled.signal,
  inspectInstaller: async () => { cancelled.abort(interruption); throw interruption; },
  discoverTarget: async () => { discoveries++; return { state: 'absent' }; }
}), error => error === interruption);
assert.equal(discoveries, 0, 'cancelled inspection cannot become a blocker followed by another native discovery');
await assert.rejects(inspectWindowsPrerequisiteInstaller(request.bootstrapperPath, { signal: cancelled.signal,
  env: {}, spawn: async () => { throw new Error('pre-cancelled native inspection must not launch'); }
}), error => error === interruption);
let inputReads = 0;
await assert.rejects(runPrerequisiteCli(['--plan', 'inert.json'], { signal: cancelled.signal,
  readInput: async () => { inputReads++; return request; }
}), error => error === interruption);
assert.equal(inputReads, 0);
const forwarded = new AbortController();
await runPrerequisiteCli(['--plan', 'inert.json'], { signal: forwarded.signal,
  readInput: async (_file, options) => { assert.equal(options.signal, forwarded.signal); return request; },
  plan: async (_request, options) => { assert.equal(options.signal, forwarded.signal); return plan; }
});

if (process.platform === 'win32') {
  const parent = path.join(process.cwd(), '.tmp', 'tasks', 'windows-prerequisite-plan');
  await fs.mkdir(parent, { recursive: true });
  const stateRoot = await fs.mkdtemp(path.join(parent, 'case-'));
  try {
    const unsigned = path.join(stateRoot, "unsigned $(exit 91) & '🚀.ps1");
    await fs.writeFile(unsigned, '# Inspection fixture; never executed.');
    const inspected = await inspectWindowsPrerequisiteInstaller(unsigned);
    assert.equal(inspected.path, unsigned);
    assert.equal(inspected.signature.status, 'NotSigned',
      'the real PowerShell inspector treats spaces, quotes, Unicode and command syntax as literal path input');
    assert.equal(inspected.verification, 'actual-local-bytes-and-native-authenticode');
    const fixtureCatalog = { ...WINDOWS_PREREQUISITE_CATALOG, allocation: { complete: true,
      writes: [{ root: stateRoot, requiredBytes: 64, source: 'inert-fixture-only-not-a-production-estimate' }] } };
    const options = { ...dependencies, catalog: fixtureCatalog };
    const approved = await createWindowsPrerequisitePlan({ ...request, stateRoot }, options);
    const compiler = path.win32.join(request.installPath, 'fixture-cl.exe');
    const discovery = { platform: 'win32', arch: request.arch,
      toolchain: { compiler: { installationPath: request.installPath, executable: compiler } },
      childEnv: { npm_config_python: 'fixture-python' } };
    const capability = { schemaVersion: 1, kind: 'windows-compiler-capability', state: 'compile-link-target-verified',
      platform: 'win32', arch: request.arch, selected: { compiler } };
    const outcome = await applyWindowsPrerequisitePlan(approved, { ...options, approveSystemChanges: true, acceptInstallerTerms: true,
      discover: async () => discovery, verifyCapability: async () => capability });
    assert.equal(outcome.state, 'prerequisites-verified-locked-bootstrap-required');
    assert.equal(outcome.readinessRecorded, false);
    assert.equal(outcome.childEnv.npm_config_python, 'fixture-python');
    await assert.rejects(applyWindowsPrerequisitePlan(approved, { ...options, approveSystemChanges: true, acceptInstallerTerms: true,
      discover: () => ({ childEnv: {} }), verifyCapability: async () => { throw new Error('unknown discovery cannot start compilation'); }
    }), /did not select the exact reviewed/);
    await assert.rejects(applyWindowsPrerequisitePlan(approved, { ...options, approveSystemChanges: true, acceptInstallerTerms: true,
      discover: () => discovery, verifyCapability: async () => ({ state: 'failed' })
    }), /canonical verified target receipt/);
    const interruptedApply = new AbortController();
    let postInstallDiscoveries = 0;
    await assert.rejects(applyWindowsPrerequisitePlan(approved, { ...options, signal: interruptedApply.signal,
      approveSystemChanges: true, acceptInstallerTerms: true,
      spawn: async () => { interruptedApply.abort(interruption); return { exitCode: 0 }; },
      discover: () => { postInstallDiscoveries++; return discovery; }
    }), error => error === interruption && error.prerequisiteOutcome.state === 'cancelled');
    assert.equal(postInstallDiscoveries, 0, 'settled cancellation cannot start post-install compilation');
    const reboot = await applyWindowsPrerequisitePlan(approved, { ...options, approveSystemChanges: true, acceptInstallerTerms: true,
      spawn: async () => ({ exitCode: 3010 }) });
    assert.equal(reboot.state, 'reboot-required');
  } finally { await fs.rm(stateRoot, { recursive: true, force: true }); }
}
console.log('Windows prerequisite review/apply source fixture completed.');
