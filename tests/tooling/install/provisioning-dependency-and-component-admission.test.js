#!/usr/bin/env node
// Authored for deferred integration. Explicit inert trusted runtime files and
// probe adapters exercise the actual preview/verification/launch bind owners.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { bindProvisioningCommand, createToolProvisioningPlan, normalizeToolProvisioningDeclaration,
  orderProvisioningRequirements, verifyToolProvisioningPlan } from '../../../tools/tooling/provisioning-plan.js';
import { createToolInstallPreview } from '../../../tools/tooling/install-preview.js';
import { resolveInstallerRequirementProbeArgs, verifyInstallerRequirementProbe } from '../../../tools/tooling/install-requirements.js';

const temporary = await makeTempDir('poc-prerequisite-dependencies-');
try {
  const command = path.join(temporary, 'explicit-trusted-runtime-fixture');
  await fs.writeFile(command, 'inert selected runtime fixture bytes');
  const tool = { id: 'fixture-dependency', prerequisites: [
    { id: 'runtime', command, family: 'node', phase: 'launch', dependsOn: [] },
    { id: 'manager', command, family: 'npm', phase: 'install', dependsOn: ['runtime'] }
  ] };
  const selection = { scope: 'cache', plan: null };
  const unprobed = createToolProvisioningPlan({ tool, selection });
  assert.deepEqual(unprobed.steps.map(step => step.state), ['not-probed', 'not-probed']);
  let probes = 0;
  const failed = createToolProvisioningPlan({ tool, selection, probe: () => { probes++; return { ok: true, stdout: 'npm-like 11.0.0' }; } });
  assert.equal(probes, 2, 'only alternate probes for the failing runtime execute; its manager never executes');
  assert.deepEqual(failed.steps.map(step => step.state), ['incompatible', 'blocked']);
  assert.deepEqual(failed.steps[1].blockedBy, ['runtime']);
  probes = 0;
  const asynchronous = await verifyToolProvisioningPlan(unprobed, { probe: async () => { probes++; return { ok: false, outcome: 'missing' }; } });
  assert.equal(probes, 2);
  assert.equal(asynchronous.steps[1].state, 'blocked');
  assert.equal(asynchronous.steps[1].reason, 'upstream-prerequisite-not-verified');
  assert.throws(() => bindProvisioningCommand({ cmd: 'npm', requires: 'manager', args: [] }, asynchronous, {}), /not verified/);
  const missing = createToolProvisioningPlan({ tool: { ...tool, prerequisites: tool.prerequisites.map(step =>
    step.id === 'runtime' ? { ...step, command: command + '.absent' } : step) }, selection });
  assert.deepEqual(missing.steps.map(step => step.state), ['missing', 'blocked']);
  const preview = createToolInstallPreview({ tools: [tool] }, { locate: () => ({ found: false, path: null }), provisioning: () => missing });
  assert.equal(preview.entries[0].blockers.some(blocker => blocker.requirement === 'manager' && blocker.blockedBy[0] === 'runtime'), true);
  assert.throws(() => orderProvisioningRequirements([{ id: 'invalid', dependsOn: 'another-runtime' }]), /edge\/component declaration/);
  const ruby = normalizeToolProvisioningDeclaration({ id: 'fixture-ruby', prerequisites: [{ id: 'ruby', command, family: 'ruby' }],
    install: { cache: { cmd: 'gem', args: ['install', 'explicit-fixture@1.0.0'], requires: 'gem' } } });
  assert.deepEqual(ruby.install.cache.prerequisites[0].dependsOn, ['ruby']);

  const pythonRequirement = { id: 'python', command, family: 'python3', phase: 'install', dependsOn: [],
    versionRange: '>=3.10.0 <3.15.0', requiredComponents: ['venv', 'pip'] };
  const pythonTool = { id: 'fixture-python-environment', prerequisites: [pythonRequirement] };
  const python = components => ({ ok: true, stdout: JSON.stringify({ family: 'python', version: '3.13.7', executable: command, components }) });
  const pythonPlan = createToolProvisioningPlan({ tool: pythonTool, selection });
  const missingPip = await verifyToolProvisioningPlan(pythonPlan, { probe: async () => python(['venv', 'ensurepip']) });
  assert.equal(missingPip.steps[0].reason, 'missing_runtime_components');
  assert.deepEqual(missingPip.steps[0].missingComponents, ['pip']);
  assert.equal((await verifyToolProvisioningPlan(pythonPlan, { probe: async () => python(['venv', 'pip']) })).state, 'requirements-verified');
  const other = path.join(temporary, 'other-runtime'); await fs.writeFile(other, 'another inert runtime');
  const different = await verifyToolProvisioningPlan(pythonPlan, { probe: async () => ({ ok: true,
    stdout: JSON.stringify({ family: 'python', version: '3.13.7', executable: other, components: ['venv', 'pip'] }) }) });
  assert.equal(different.steps[0].reason, 'reported_runtime_executable_mismatch');
  assert.equal(verifyInstallerRequirementProbe('ruby', { ok: true, stdout: JSON.stringify({ family: 'ruby', version: '3.4.0', executable: command,
    components: ['bundler'] }) }, { requiredComponents: ['bundler'] }).ok, true);
  assert.equal(verifyInstallerRequirementProbe('php', { ok: true, stdout: JSON.stringify({ family: 'php', version: '8.4.0', binary: command,
    extensions: [42, null] }) }, { requiredComponents: ['json'] }).reason, 'missing_runtime_components');
  const pythonArgs = resolveInstallerRequirementProbeArgs('python3')[0];
  assert.equal(pythonArgs[0], '-c'); assert.ok(pythonArgs[1].includes('find_spec'));
  assert.equal(pythonArgs[1].includes('pip install'), false, 'component discovery cannot install packages');

  const jdk = path.join(temporary, 'jdk'), secondJdk = path.join(temporary, 'other-jdk');
  for (const root of [jdk, secondJdk]) {
    await fs.mkdir(path.join(root, 'bin'), { recursive: true });
    for (const name of ['java', 'javac']) await fs.writeFile(path.join(root, 'bin', name), 'inert selected JDK fixture');
  }
  const javaTool = compiler => ({ id: 'fixture-jdk', prerequisites: [
    { id: 'java', command: path.join(jdk, 'bin', 'java'), family: 'java', dependsOn: [] },
    { id: 'javac', command: path.join(compiler, 'bin', 'javac'), family: 'javac', dependsOn: ['java'] }
  ] });
  const verifyJava = candidate => candidate.endsWith('javac') ? { ok: true, stdout: 'javac 21.0.8' } : { ok: true, stderr: 'openjdk version "21.0.8"' };
  const matched = createToolProvisioningPlan({ tool: javaTool(jdk), selection, probe: verifyJava });
  assert.equal(bindProvisioningCommand({ cmd: command, args: [] }, matched, {}).env.JAVA_HOME, jdk);
  const mismatched = createToolProvisioningPlan({ tool: javaTool(secondJdk), selection, probe: verifyJava });
  assert.equal(mismatched.steps[1].reason, 'selected-runtime-root-mismatch');
  assert.throws(() => bindProvisioningCommand({ cmd: command, args: [] }, mismatched, {}), /not verified/);
  const mismatchedAsync = await verifyToolProvisioningPlan(createToolProvisioningPlan({ tool: javaTool(secondJdk), selection }), { probe: async candidate => verifyJava(candidate) });
  assert.equal(mismatchedAsync.steps[1].reason, 'selected-runtime-root-mismatch', 'installed-tool reuse cannot bypass shared-runtime SDK alignment');
  assert.throws(() => bindProvisioningCommand({ cmd: command, args: [] }, matched, { JAVA_HOME: secondJdk }), /selection changed/);
} finally { await rmDirRecursive(temporary); }
console.log('Prerequisite DAG failures block dependent launch; Python components, runtime identity and shared JDK selection remain explicit.');
