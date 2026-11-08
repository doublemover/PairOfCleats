#!/usr/bin/env node
// Authored actual lifecycle consumer fixture. Runtime commands are explicitly
// selected trusted inert files; no installer, runtime or vendor binary executes.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { withTemporaryEnv } from '../../helpers/test-env.js';
import { applyToolLifecyclePlan, planToolLifecycle } from '../../../tools/tooling/lifecycle.js';

const temporary = await makeTempDir('poc-lifecycle-prerequisites-');
try {
  const repo = path.join(temporary, 'repo'), toolingRoot = path.join(temporary, 'tools'), runtime = path.join(repo, 'explicit-trusted-runtime');
  await fs.mkdir(repo); await fs.writeFile(runtime, 'inert selected runtime bytes');
  const archive = Buffer.from('inert archive, never requested');
  let downloads = 0;
  const tool = { id: 'fixture-lifecycle-prerequisites', authorityRepoRoot: repo,
    prerequisites: [{ id: 'python', command: runtime, family: 'python3', phase: 'launch', dependsOn: [], versionRange: '>=3.10.0', requiredComponents: ['venv', 'pip'] }],
    verifyManagedInstall: async () => assert.fail('failed runtime preflight cannot execute a managed verifier'),
    install: { cache: { approvedOrigins: ['https://fixture.invalid'],
      download: async () => { downloads++; throw new Error('unverified prerequisites cannot download'); },
      managedDescriptor: { schemaVersion: 1, toolId: 'fixture-lifecycle-prerequisites', recipeId: 'explicit-inert-fixture', version: '1.0.0',
        platform: process.platform, arch: process.arch, command: 'fixture', requiredFiles: ['fixture'], args: [],
        archive: { url: 'https://fixture.invalid/lifecycle-v1.zip', type: 'zip', bytes: archive.length, sha256: createHash('sha256').update(archive).digest('hex') },
        storageEstimate: { complete: true, writes: [{ destination: 'artifacts', requiredBytes: 1024 * 1024 }] } } } } };
  await withTemporaryEnv({ PAIROFCLEATS_HOME: path.join(temporary, 'home'), PAIROFCLEATS_TRUSTED_REPOS: JSON.stringify([repo]),
    PAIROFCLEATS_TRUSTED_CONFIG: null }, async () => {
    const approved = await planToolLifecycle({ toolingRoot, id: tool.id, operation: 'install', tool });
    assert.equal(approved.state, 'ready-for-explicit-apply');
    assert.equal(approved.provisioning.steps[0].state, 'not-probed', 'planning reads bytes but executes no prerequisite');
    let probes = 0;
    const result = await applyToolLifecyclePlan(approved, { tool, probePrerequisite: async command => {
      probes++; assert.equal(command, runtime);
      return { ok: true, stdout: JSON.stringify({ family: 'python', version: '3.9.20', executable: runtime, components: ['venv', 'pip'] }) };
    } });
    assert.equal(result.applied, false); assert.equal(result.state, 'blocked'); assert.equal(result.phase, 'prerequisite-verification');
    assert.equal(result.provisioning.steps[0].reason, 'unsupported_runtime_version');
    assert.equal(probes, 1); assert.equal(downloads, 0);
    const missingComponent = await applyToolLifecyclePlan(approved, { tool, probePrerequisite: async () => ({ ok: true,
      stdout: JSON.stringify({ family: 'python', version: '3.13.7', executable: runtime, components: ['venv'] }) }) });
    assert.deepEqual(missingComponent.provisioning.steps[0].missingComponents, ['pip']);
    assert.equal(downloads, 0);
    await fs.writeFile(runtime, 'changed selected runtime bytes after approval');
    await assert.rejects(applyToolLifecyclePlan(approved, { tool, probePrerequisite: async () => assert.fail('stale plan cannot probe') }), /plan changed/);
    assert.equal(downloads, 0);
    await withTemporaryEnv({ PAIROFCLEATS_TRUSTED_REPOS: '[]' }, async () => {
      const blocked = await planToolLifecycle({ toolingRoot, id: tool.id, operation: 'install', tool });
      assert.equal(blocked.state, 'blocked');
      assert.equal(blocked.blockers.some(blocker => blocker.code === 'managed-prerequisite-unavailable'), true);
      assert.equal(blocked.provisioning.steps[0].reason, 'command-missing-or-untrusted');
    });
    await assert.rejects(fs.stat(toolingRoot), { code: 'ENOENT' }, 'blocked/stale lifecycle apply cannot prepare managed publication');
  });
} finally { await rmDirRecursive(temporary); }
console.log('Lifecycle apply verifies reviewed physical runtime prerequisites before downloads and preserves trust/version/component blockers.');
