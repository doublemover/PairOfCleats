#!/usr/bin/env node
import assert from 'node:assert/strict';
import { normalizeToolProvisioningDeclaration, orderProvisioningRequirements, createToolProvisioningPlan, bindProvisioningCommand,
  verifyToolProvisioningPlan, probeProvisioningCommand } from '../../../tools/tooling/provisioning-plan.js';
import { verifyInstallerRequirementProbe } from '../../../tools/tooling/install-requirements.js';

assert.equal(verifyInstallerRequirementProbe('dotnet', { ok: true, stdout: 'Microsoft.NETCore.App 10.0.0 [runtime]' }).ok, false, 'runtime-only dotnet cannot install SDK tools');
assert.equal(verifyInstallerRequirementProbe('dotnet', { ok: true, stdout: '10.0.100 [C:\\dotnet\\sdk]' }).identity.family, 'dotnet-sdk');
assert.equal(verifyInstallerRequirementProbe('php', { ok: true, stdout: JSON.stringify({ family: 'php', version: '8.4.0', binary: '/php', extensions: ['json'] }) }, { requiredComponents: ['mbstring'] }).reason, 'missing_runtime_components');
assert.equal(verifyInstallerRequirementProbe('java', { ok: true, stdout: 'totally unrelated command' }).ok, false);
assert.throws(() => orderProvisioningRequirements([{ id: 'one', dependsOn: ['two'] }, { id: 'two', dependsOn: ['one'] }]), /cycle/);
const tool = normalizeToolProvisioningDeclaration({ id: 'test-server', install: { cache: { cmd: 'npm', args: ['install', 'test-server@1.0.0'] } } });
assert.equal(tool.install.cache.requires, 'npm');
assert.deepEqual(tool.install.cache.prerequisites.map(entry => entry.id), ['node', 'npm']);
let probes = 0;
const preview = createToolProvisioningPlan({ tool, selection: { scope: 'cache', plan: tool.install.cache }, resolve: () => process.execPath });
assert.equal(probes, 0);
assert.equal(preview.steps.every(step => step.state === 'not-probed'), true);
const verified = createToolProvisioningPlan({ tool, selection: { scope: 'cache', plan: tool.install.cache }, resolve: () => process.execPath,
  probe: (_command, args) => { probes++; return { ok: true, stdout: args[0] === '--version' ? '26.12.1' : '' }; } });
assert.equal(verified.steps.find(step => step.id === 'node').state, 'incompatible', 'npm-like output cannot identify Node');
const empty = bindProvisioningCommand({ cmd: 'npm', args: [], requires: 'npm' }, { steps: [] }, { PATH: '/preserve', TOKEN: 'private' });
assert.equal(empty.env.TOKEN, 'private');
assert.equal(JSON.stringify(preview).includes('private'), false);
const selectedMissing = createToolProvisioningPlan({ tool: { id: 'missing-runtime', prerequisites: [{ id: 'node', command: process.execPath + '.missing', family: 'node' }] },
  selection: { scope: 'cache', plan: null } });
assert.equal(selectedMissing.steps[0].state, 'missing');
assert.equal(selectedMissing.steps[0].reason, 'command-bytes-unavailable', 'missing explicit absolute commands become actionable plan blockers');
let asyncProbe = 0;
const asyncVerified = await verifyToolProvisioningPlan(preview, { probe: async (_command, _args, options) => {
  assert.equal(options.timeoutMs, 4000);
  assert.equal(options.maxOutputBytes, 65536);
  return { ok: true, stdout: asyncProbe++ === 0 ? 'v26.12.1' : '11.0.0' };
} });
assert.equal(asyncVerified.state, 'requirements-verified');
assert.equal(asyncVerified.steps.every(step => step.state === 'verified'), true);
const alreadyCancelled = new AbortController(); alreadyCancelled.abort(new Error('fixture cancelled'));
await assert.rejects(verifyToolProvisioningPlan(preview, { signal: alreadyCancelled.signal,
  probe: async () => { throw new Error('cancelled verification cannot execute a prerequisite'); } }), /fixture cancelled/);
const pending = Object.assign(new Error('fixture pending exact child'), { cacheOwnershipPending: true });
await assert.rejects(probeProvisioningCommand('fixture', [], { spawn: async () => { throw pending; } }), error => error.cause === pending
  && error.cacheOwnershipReleased() === false,
'unknown async teardown cannot be flattened into an ordinary missing-prerequisite result');
console.log('Provisioning requires typed recognized runtimes and read-only plans.');
