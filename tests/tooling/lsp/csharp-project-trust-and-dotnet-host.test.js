import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseDotnetApplicationLaunch } from '../../../src/index/tooling/dotnet-launch.js';
import { createCsharpProvider } from '../../../src/index/tooling/csharp-provider.js';
import { createConfiguredLspProvider } from '../../../src/index/tooling/lsp-provider/factory.js';
import { normalizeServerConfig } from '../../../src/index/tooling/lsp-provider/normalize.js';
import { buildSingleSymbolInputs, createLspProviderTempRepo, resolveLspStubServerPath, runDedicatedProviderFixture } from '../../helpers/lsp-provider-fixture.js';
import { withTemporaryEnv } from '../../helpers/test-env.js';
import { cleanupLspTestRuntime } from '../../helpers/lsp-runtime.js';

// Authored .NET-host/provider-consumer fixture. The selected fake host speaks
// the protocol via Node; it does not qualify any SDK, CLR assembly or MSBuild.
assert.deepEqual(parseDotnetApplicationLaunch(['--roll-forward', 'Major', 'server.dll', '--stdio']), {
  assemblyArg: 'server.dll', hostOptions: [{ name: '--roll-forward', value: 'Major' }], applicationArgs: ['--stdio'], mode: 'application'
});
assert.equal(parseDotnetApplicationLaunch(['exec', '--runtimeconfig', 'selected.runtimeconfig.json',
  '--depsfile', 'selected.deps.json', '--additionalprobingpath', 'packages', 'server.dll']).assemblyArg, 'server.dll');
for (const unsupported of [[], ['--roll-forward'], ['--unknown', 'value', 'server.dll'],
  ['--runtimeconfig', 'settings.json', 'server.dll'], ['exec', '--depsfile', '--runtimeconfig', 'settings.json'],
  ['build', 'project.csproj'], ['exec'], ['server.exe']]) assert.ok(parseDotnetApplicationLaunch(unsupported).error);
const hostName = process.platform === 'win32' ? 'dotnet.cmd' : 'dotnet';
const hostBody = process.platform === 'win32' ? `@echo off\r\nif "%1"=="--version" (echo Dotnet fixture host& exit /b 0)\r\nif "%1"=="--help" (echo Dotnet fixture host& exit /b 0)\r\n"${process.execPath}" "${resolveLspStubServerPath()}" --mode csharp\r\n`
  : `#!/usr/bin/env node\nimport { spawn } from 'node:child_process'; if (['--version','--help'].includes(process.argv[2])) { console.log('Dotnet fixture host'); } else { const child = spawn(${JSON.stringify(process.execPath)}, [${JSON.stringify(resolveLspStubServerPath())}, '--mode', 'csharp'], { stdio: 'inherit' }); child.once('exit', code => process.exit(code ?? 1)); }\n`;
const root = await createLspProviderTempRepo({ name: 'csharp-host-trust', files: [
  { path: 'App.csproj', content: '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>net10.0</TargetFramework></PropertyGroup></Project>' },
  { path: 'server.dll', content: 'protocol fixture placeholder, never a CLR assembly' },
  { path: 'server.runtimeconfig.json', content: '{}' }, { path: hostName, content: hostBody }
] });
const inputs = buildSingleSymbolInputs({ scenarioName: 'csharp-host-trust', virtualPath: 'src/App.cs',
  text: 'class App { string Greet(string name) => name; }\n', languageId: 'csharp', effectiveExt: '.cs', symbolName: 'Greet' });
try {
  if (process.platform !== 'win32') await fs.chmod(path.join(root, hostName), 0o755);
  const provider = createCsharpProvider();
  await withTemporaryEnv({ PAIROFCLEATS_TRUSTED_REPOS: '[]' }, async () => {
    const denied = await provider.preflight({ repoRoot: root, toolingConfig: { csharp: { enabled: true, cmd: 'must-not-be-probed' } } }, inputs);
    assert.equal(denied.blockProvider, true);
    assert.equal(denied.reasonCode, 'csharp-ls_workspace_trust_required');
    const renamed = createConfiguredLspProvider(normalizeServerConfig({ id: 'renamed-csharp', cmd: process.execPath,
      args: ['--version'], languages: ['csharp'] }, 0));
    assert.match((await renamed.preflight({ repoRoot: root, toolingConfig: {} }, inputs)).reasonCode, /workspace_trust_required$/u);
  });
  const result = await runDedicatedProviderFixture({ tempRoot: root, providerId: 'csharp-ls', providerConfigKey: 'csharp',
    authorizeFixtureExecution: true, inputs, providerConfig: { cmd: path.join(root, hostName),
      args: ['exec', '--runtimeconfig', path.join(root, 'server.runtimeconfig.json'), '--roll-forward', 'Major', path.join(root, 'server.dll'), '--stdio'] } });
  const payload = result.byChunkUid.get(inputs.chunkUid)?.payload;
  assert.equal(payload?.returnType, 'string', 'documented host-option layout reaches the real provider merge');
  assert.equal(payload?.paramTypes.name[0].type, 'string');
} finally {
  await cleanupLspTestRuntime({ reason: 'csharp_host_trust', strict: true });
  await fs.rm(root, { recursive: true, force: true });
}
console.log('C# project execution requires exact trust; dotnet host option operands retain correct assembly selection');
