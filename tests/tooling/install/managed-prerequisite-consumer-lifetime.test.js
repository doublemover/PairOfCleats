#!/usr/bin/env node
// UNRUN actual-consumer source fixture. Every positive selects trusted inert
// SDK/server files and explicit child adapters; no host SDK or vendor tool runs.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { withTemporaryEnv } from '../../helpers/test-env.js';
import { installPinnedManagedTool, inspectManagedToolRemoval } from '../../../tools/tooling/managed-install.js';
import { bindProvisioningCommand, createToolProvisioningPlan, verifyToolProvisioningPlan } from '../../../tools/tooling/provisioning-plan.js';
import { planManagedPrerequisites, provisionManagedPrerequisites } from '../../../tools/tooling/provision-prerequisites.js';
import { withManagedProvisioningRequirements } from '../../../tools/tooling/provisioning-lifetime.js';
import { withOperationalTool } from '../../../tools/tooling/operational-execution.js';
import { detectToolOwned } from '../../../tools/tooling/owned-detect.js';
import { planToolLifecycle } from '../../../tools/tooling/lifecycle.js';

const temporary = await makeTempDir('poc-sdk-prerequisite-consumers-');
try {
  const repoRoot = path.join(temporary, 'repo'), toolingRoot = path.join(temporary, 'tooling'), home = path.join(temporary, 'home');
  await fs.mkdir(repoRoot);
  const command = path.join(repoRoot, 'explicit-trusted-ripgrep-fixture'); await fs.writeFile(command, 'inert explicitly trusted server command');
  await withTemporaryEnv({ PAIROFCLEATS_HOME: home, PAIROFCLEATS_TRUSTED_REPOS: JSON.stringify([repoRoot]),
    PAIROFCLEATS_TRUSTED_CONFIG: null, DOTNET_ROOT: null, TMP: null, TEMP: null, TMPDIR: null }, async () => {
    const requirements = [{ id: 'dotnet-runtime', family: 'dotnet-runtime', command: 'dotnet', kind: 'runtime', phase: 'launch', dependsOn: [],
      versionRange: '>=10.0.0 <11.0.0', requiredComponents: ['Microsoft.NETCore.App'] },
    { id: 'dotnet', family: 'dotnet', command: 'dotnet', kind: 'sdk', phase: 'launch', dependsOn: ['dotnet-runtime'], versionRange: '>=10.0.0 <11.0.0' }];
    const tool = { id: 'ripgrep', toolingRoot, authorityRepoRoot: repoRoot, prerequisites: requirements,
      detect: { cmd: command, args: ['--version'] }, install: {} };
    const selection = { scope: 'cache', plan: null };
    const missing = createToolProvisioningPlan({ tool, selection, resolve: () => null });
    assert.equal(missing.steps[0].state, 'missing');
    const preview = planManagedPrerequisites({ provisioning: missing, platform: 'win32', arch: 'x64' });
    assert.equal(preview.state, 'ready-for-selected-install'); assert.equal(preview.actions.length, 1);
    assert.equal(preview.actions[0].managedDescriptor.toolId, 'dotnet-sdk');
    assert.equal(preview.planId, planManagedPrerequisites({ provisioning: missing, platform: 'win32', arch: 'x64' }).planId);
    for (const [changes, code] of [[{ scope: 'user' }, 'managed-prerequisite-scope-unavailable'],
      [{ env: { DOTNET_ROOT: path.join(temporary, 'explicit-unavailable-pin') } }, 'explicit-dotnet-root-retained'],
      [{ platform: 'linux' }, 'portable-dotnet-target-unavailable'],
      [{ provisioning: { ...missing, steps: missing.steps.map(step => ({ ...step, selectedCommandRejected: true })) } }, 'selected-dotnet-authority-retained'],
      [{ provisioning: { ...missing, steps: missing.steps.map(step => ({ ...step, reason: 'unsupported_runtime_version' })) } }, 'selected-dotnet-version-retained'],
      [{ provisioning: { ...missing, steps: missing.steps.map(step => ({ ...step, versionRange: '>=8 <9' })) } }, 'pinned-dotnet-requirements-unsupported']]) {
      const blocked = planManagedPrerequisites({ provisioning: missing, platform: 'win32', arch: 'x64', ...changes });
      assert.equal(blocked.state, 'blocked'); assert.equal(blocked.actions.length, 0); assert.equal(blocked.blockers[0].code, code);
    }
    const archive = Buffer.from('explicit immutable SDK fixture archive');
    let downloads = 0, selectedSdk;
    const fixtureDescriptor = { schemaVersion: 1, toolId: 'dotnet-sdk', recipeId: 'explicit-trusted-sdk-fixture', version: '10.0.402',
      platform: process.platform, arch: process.arch, command: 'dotnet.exe', args: [], requiredFiles: ['dotnet.exe'],
      archive: { url: 'https://fixture.invalid/sdk-10.0.402.zip', type: 'zip', bytes: archive.length, sha512: createHash('sha512').update(archive).digest('hex') },
      storageEstimate: { complete: true, writes: [{ destination: 'artifacts', requiredBytes: 1024 * 1024 }] } };
    const publishFixture = () => installPinnedManagedTool({ toolingRoot, descriptor: fixtureDescriptor, approvedOrigins: ['https://fixture.invalid'],
      download: async ({ url }) => { downloads++; return { body: archive, sourceUrl: url }; },
      extract: async (_archive, target) => { await fs.mkdir(target, { recursive: true }); await fs.writeFile(path.join(target, 'dotnet.exe'), 'inert SDK fixture command bytes'); },
      verify: async ({ resourceId }) => ({ ok: true, level: 'explicit-trusted-fixture-only', consumerQualified: false, settlement: { resourceId, settled: true, pending: false } }) });
    const probe = async (selected, args, options) => {
      assert.equal(selected, selectedSdk.command); assert.equal(options.env.DOTNET_ROOT, selectedSdk.root);
      return { ok: true, stdout: args[0] === '--list-sdks' ? `10.0.402 [${path.join(selectedSdk.root, 'sdk')}]\n`
        : `Microsoft.NETCore.App 10.0.13 [${path.join(selectedSdk.root, 'shared', 'Microsoft.NETCore.App')}]\n` };
    };
    // The source recipe is Windows-only. The generic immutable prerequisite
    // generation and actual consumers below remain portable fixture contracts.
    if (process.platform === 'win32') {
      const prepared = await provisionManagedPrerequisites({ tool, selection, provisioning: missing, toolingRoot, isAllowed: () => true }, {
        install: async input => {
          assert.equal(input.descriptor.toolId, 'dotnet-sdk'); assert.match(input.descriptor.archive.sha512, /^[a-f0-9]{128}$/);
          selectedSdk = await publishFixture(); return selectedSdk;
        }, probe });
      assert.equal(prepared.ok, true); assert.equal(prepared.results[0].installId, selectedSdk.installId);
    } else selectedSdk = await publishFixture();
    assert.equal(downloads, 1);
    let observed = createToolProvisioningPlan({ tool, selection, resolve: () => assert.fail('a selected managed SDK cannot fall back to PATH') });
    assert.equal(observed.steps.every(step => step.managedInstallation.installId === selectedSdk.installId), true);
    assert.equal(createToolProvisioningPlan({ tool, selection, probe: () => assert.fail('managed SDK verification requires an async lease') }).steps[0].state, 'not-probed');
    observed = await verifyToolProvisioningPlan(observed, { probe, cwd: repoRoot });
    assert.equal(observed.state, 'requirements-verified');
    const bound = bindProvisioningCommand({ cmd: command, args: [] }, observed, { DOTNET_ROOT_X64: 'ambient-root', MSBuildSDKsPath: 'ambient-sdk' });
    assert.equal(bound.env.DOTNET_ROOT, selectedSdk.root); assert.equal(bound.env.MSBuildSDKsPath, undefined);
    await withManagedProvisioningRequirements(observed, async () => {
      assert.equal((await inspectManagedToolRemoval({ toolingRoot, toolId: 'dotnet-sdk' })).state, 'blocked');
      return { value: 'closed fixture callback' };
    });
    assert.equal((await inspectManagedToolRemoval({ toolingRoot, toolId: 'dotnet-sdk' })).state, 'owned-and-idle');
    const detected = await detectToolOwned(tool, {}, { spawn: async (selected, _args, options) => {
      assert.equal(selected, command); assert.equal(options.env.DOTNET_ROOT, selectedSdk.root);
      assert.equal((await inspectManagedToolRemoval({ toolingRoot, toolId: 'dotnet-sdk' })).state, 'blocked');
      return { exitCode: 0, stdout: 'ripgrep 15.2.0' };
    } });
    assert.equal(detected.found, true);

    let childClosed = false;
    const pending = Object.freeze(Object.assign(new Error('explicit fixture child closure pending'), {
      cacheOwnershipPending: true, cacheOwnershipReleased() { assert.equal(this, pending); return childClosed; }
    }));
    const dependencies = { getConfig: () => ({ dir: toolingRoot }), resolveTools: () => [tool], probe,
      spawn: async (selected, args) => {
        assert.equal(selected, command);
        if (args[0] === '--version') return { exitCode: 0, stdout: 'ripgrep 15.2.0' };
        if (args[0] === '--json') return { exitCode: 0, stdout: JSON.stringify({ type: 'match', data: { lines: { text: 'pairofcleats-rg-probe\n' } } }) };
        throw pending;
      } };
    let failure;
    try { await withOperationalTool('ripgrep', { repoRoot }, selected => selected.run(['--files']), dependencies); }
    catch (error) { failure = error; }
    assert.equal(failure.cacheOwnershipReleased(), false);
    assert.equal((await inspectManagedToolRemoval({ toolingRoot, toolId: 'dotnet-sdk' })).state, 'blocked');
    const recovery = failure.managedInstallSession, receipt = { resourceId: recovery.resourceId, settled: true, pending: false };
    await assert.rejects(async () => recovery.releaseAfterSettlement(receipt), /pending/);
    childClosed = true; assert.equal(await recovery.releaseAfterSettlement(receipt), true);
    assert.equal(failure.cacheOwnershipReleased(), true);
    assert.equal((await inspectManagedToolRemoval({ toolingRoot, toolId: 'dotnet-sdk' })).state, 'owned-and-idle');

    const selectorFile = path.join(toolingRoot, 'installs', 'dotnet-sdk', 'current.json'), selectorBytes = await fs.readFile(selectorFile);
    await fs.writeFile(selectorFile, '{"schemaVersion":999}');
    const damaged = createToolProvisioningPlan({ tool, selection, resolve: () => assert.fail('damaged selected SDK cannot fall back') });
    assert.equal(damaged.steps[0].reason, 'selected-managed-prerequisite-unavailable');
    assert.equal(planManagedPrerequisites({ provisioning: damaged }).actions.length, 0);
    const blockedDetect = await detectToolOwned(tool, {}, { spawn: () => assert.fail('damaged prerequisite cannot execute a server') });
    assert.equal(blockedDetect.found, false); await fs.writeFile(selectorFile, selectorBytes);
    await withTemporaryEnv({ PAIROFCLEATS_TRUSTED_REPOS: '[]' }, async () => {
      await assert.rejects(withOperationalTool('ripgrep', { repoRoot }, () => assert.fail('untrusted server cannot execute'), dependencies), { code: 'ERR_OPERATIONAL_TOOL_UNAVAILABLE' });
    });
    const lifecycle = await planToolLifecycle({ toolingRoot, id: 'dotnet-sdk', operation: 'remove', tool: { ...tool, id: 'dotnet-sdk', prerequisites: [] } });
    assert.equal(lifecycle.state, 'ready-for-explicit-apply'); assert.equal(downloads, 1);
  });
} finally { await rmDirRecursive(temporary); }
console.log('Actual prerequisite selection, detector and operational consumers retain exact SDK generations and preserve pins, trust, damage and pending child recovery.');
