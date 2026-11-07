#!/usr/bin/env node
// Authored regression for typed prerequisite versions and existing consumers;
// synthetic runtimes are explicitly selected/trusted and install nothing.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { runNode } from '../../helpers/run-node.js';
import { verifyInstallerRequirementProbe } from '../../../tools/tooling/install-requirements.js';
import { bindProvisioningCommand, createToolProvisioningPlan, orderProvisioningRequirements } from '../../../tools/tooling/provisioning-plan.js';
import { getToolingRegistry } from '../../../tools/tooling/utils.js';

const probe = stdout => ({ ok: true, stdout });
assert.equal(verifyInstallerRequirementProbe('dotnet-runtime', probe('Microsoft.NETCore.App 10.0.1 [C:\\dotnet\\shared\\Microsoft.NETCore.App]'),
  { versionRange: '>=10.0.0 <11', requiredComponents: ['Microsoft.NETCore.App'] }).ok, true);
assert.equal(verifyInstallerRequirementProbe('dotnet-runtime', probe('10.0.100 [C:\\dotnet\\sdk]')).ok, false, 'an SDK row is not runtime evidence');
assert.equal(verifyInstallerRequirementProbe('dotnet-runtime', probe('Microsoft.NETCore.App 9.0.10 [runtime]'),
  { versionRange: '>=10.0.0 <11' }).reason, 'unsupported_runtime_version');
assert.equal(verifyInstallerRequirementProbe('dotnet-runtime', probe('Microsoft.NETCore.App 10.0.1 [core]'),
  { versionRange: '>=10.0.0 <11', requiredComponents: ['Microsoft.NETCore.App', 'Microsoft.AspNetCore.App'] }).reason, 'missing_runtime_components');
const sdks = '11.0.100 [newer]\n10.0.100 [compatible]\n8.0.100 [older]';
assert.equal(verifyInstallerRequirementProbe('dotnet', probe(sdks), { versionRange: '>=10.0.0 <11' }).identity.version, '10.0.100',
  'select a compatible SDK independently of output ordering');
assert.equal(verifyInstallerRequirementProbe('dotnet', probe('10.0.100-preview.1 [preview]'), { versionRange: '>=10.0.0 <11' }).ok, false);
assert.equal(verifyInstallerRequirementProbe('java', probe('openjdk version "17.0.12"'), { versionRange: '>=21' }).reason, 'unsupported_runtime_version');
assert.equal(verifyInstallerRequirementProbe('java', probe('openjdk version "21"'), { versionRange: '>=21' }).ok, true);
assert.equal(verifyInstallerRequirementProbe('java', probe('java version "1.8.0_442"'), { versionRange: '>=21' }).ok, false);
assert.equal(verifyInstallerRequirementProbe('rustup', probe('stable-x86_64-pc-windows-msvc (default)')).ok, true, 'active stable toolchain identity is not a numeric rustup version');
assert.equal(verifyInstallerRequirementProbe('php', probe(JSON.stringify({ family: 'php', version: '8.1.30', binary: '/php' })), { versionRange: '>=8.2' }).ok, false);
assert.equal(verifyInstallerRequirementProbe('php', probe(JSON.stringify({ family: 'php', version: '8.4malformed', binary: '/php' }))).reason, 'invalid_runtime_version');
assert.equal(verifyInstallerRequirementProbe('node', probe('v26.12.1'), { versionRange: 'invalid' }).reason, 'invalid_runtime_version_constraint');
assert.throws(() => orderProvisioningRequirements([{ id: 'java', command: 'java', family: 'java', versionRange: '>=17' },
  { id: 'java', command: 'java', family: 'java', versionRange: '>=21' }]), /Conflicting prerequisite version constraints/);

const temporary = await makeTempDir('poc-provisioning-versions-');
try {
  const repo = path.join(temporary, 'repo'), bin = path.join(temporary, 'trusted-fixtures'), tools = path.join(temporary, 'tools');
  await fs.mkdir(repo); await fs.mkdir(bin);
  const dotnetTool = getToolingRegistry(tools, repo).find(tool => tool.id === 'csharp-ls');
  let lookups = 0;
  const pinned = createToolProvisioningPlan({ tool: dotnetTool, selection: { scope: 'cache', plan: null }, env: { DOTNET_ROOT: path.join(temporary, 'absent-runtime') },
    resolve: () => { lookups++; return process.execPath; } });
  assert.equal(pinned.steps[0].reason, 'command-bytes-unavailable');
  assert.equal(lookups, 0, 'an unavailable explicit .NET root never falls back to PATH');
  const invalidPin = createToolProvisioningPlan({ tool: dotnetTool, selection: { scope: 'cache', plan: null }, env: { DOTNET_ROOT: 'relative-runtime' } });
  assert.equal(invalidPin.steps[0].reason, 'invalid-explicit-runtime-root');
  const wrongRoot = { steps: [{ id: 'dotnet-runtime', family: 'dotnet-runtime', state: 'verified',
    executable: { path: process.execPath, sha256: '0'.repeat(64), size: 0 } }] };
  assert.throws(() => bindProvisioningCommand({ cmd: 'dotnet', args: [] }, wrongRoot, {}), /bytes changed/);

  const writeFixture = async (name, body) => {
    const script = path.join(bin, name + '.mjs');
    await fs.writeFile(script, body);
    await fs.writeFile(path.join(bin, name + (process.platform === 'win32' ? '.cmd' : '')), process.platform === 'win32'
      ? `@echo off\r\n"${process.execPath}" "${script}" %*\r\n` : `#!${process.execPath}\n${body}`, { mode: 0o755 });
  };
  const marker = path.join(temporary, 'sdk-probed');
  await writeFixture('csharp-ls', "console.log('csharp-ls 0.28.0');\n");
  await writeFixture('dotnet', `import fs from 'node:fs';
if(process.argv.includes('--list-runtimes')) console.log('Microsoft.NETCore.App 9.0.10 [fixture-runtime]');
else { fs.writeFileSync(${JSON.stringify(marker)}, 'SDK probe was unnecessary'); console.log('10.0.100 [fixture-sdk]'); }\n`);
  const env = applyTestEnv({ syncProcess: false, testConfig: { tooling: { dir: tools } }, extraEnv: {
    PAIROFCLEATS_HOME: path.join(temporary, 'home'), PAIROFCLEATS_TRUSTED_REPOS: JSON.stringify([repo]),
    PAIROFCLEATS_TRUSTED_CONFIG: null, DOTNET_ROOT: null, PATH: bin, Path: bin
  } });
  const result = runNode(['tools/tooling/install.js', '--repo', repo, '--tools', 'csharp-ls', '--no-fallback', '--json'],
    'installed C# server retains runtime version blocker', process.cwd(), env, { timeoutMs: 10000, stdio: 'pipe', allowFailure: true });
  assert.equal(result.status, 1, result.stderr);
  assert.ok(result.stdout.trim(), result.stderr || 'Installer emitted no JSON diagnostic.');
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.results[0].status, 'missing-requirement');
  assert.equal(payload.results[0].provisioning.steps[0].reason, 'unsupported_runtime_version');
  assert.equal(payload.actions.length, 0, 'already-present server bytes cannot trigger installation with a broken runtime');
  await assert.rejects(fs.stat(marker), { code: 'ENOENT' });
} finally { await rmDirRecursive(temporary); }
console.log('Provisioning versions, SDK/runtime components and explicit runtime roots fail closed through the actual installer.');
