import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveDotnetRuntimeLaunch } from '../../../src/index/tooling/dotnet-runtime.js';
import { resolveToolingCommandProfile } from '../../../src/index/tooling/command-resolver.js';
import { drainLspSessionPool } from '../../../src/integrations/tooling/providers/lsp/session-pool.js';
import { collectLspTypes } from '../../../src/integrations/tooling/providers/lsp.js';
import { createManagedCommandFixture } from '../../helpers/managed-command-fixture.js';
import { buildSingleSymbolInputs, createLspProviderTempRepo, resolveLspStubServerPath, runDedicatedProviderFixture } from '../../helpers/lsp-provider-fixture.js';
import { withTemporaryEnv } from '../../helpers/test-env.js';

// Authored actual C# provider consumer. Both selected managed generations are
// protocol fixtures using Node, not an official SDK, CLR or MSBuild receipt.
const root = await createLspProviderTempRepo({ name: 'managed-dotnet-provider', files: [
  { path: 'App.csproj', content: '<Project />\n' }
] });
const shellQuote = value => "'" + value.replaceAll("'", "'\\''") + "'";
const shim = (script, args = '') => process.platform === 'win32'
  ? `@echo off\r\n"${process.execPath}" "%~dp0${script}" ${args} %*\r\n`
  : `#!/bin/sh\nexec ${shellQuote(process.execPath)} "$(dirname "$0")/${script}" ${args} "$@"\n`;
try {
  await withTemporaryEnv({ PAIROFCLEATS_HOME: path.join(root, 'home'), PAIROFCLEATS_TRUSTED_REPOS: JSON.stringify([root]) }, async () => {
    const hostName = process.platform === 'win32' ? 'dotnet.cmd' : 'dotnet';
    const sdk = await createManagedCommandFixture(root, { toolId: 'dotnet-sdk', installId: 'c'.repeat(64),
      commandRelative: hostName, commandContent: shim('sdk.mjs'), additionalFiles: [{ path: 'sdk.mjs',
        content: "if (!['--version','--list-sdks','--help'].includes(process.argv[2])) process.exit(19); console.log('10.0.100 [synthetic fixture]');\n" }] });
    const server = await createManagedCommandFixture(root, { toolId: 'csharp-ls',
      commandRelative: process.platform === 'win32' ? 'selected-server.cmd' : 'selected-server', commandContent: shim('server.mjs'),
      additionalFiles: [{ path: 'server.mjs', content: `import fs from 'node:fs';
        const expected=${JSON.stringify(sdk.root)};
        if(process.env.DOTNET_ROOT!==expected || process.env.DOTNET_HOST_PATH!==${JSON.stringify(sdk.command)})process.exit(23);
        if(['--version','--help'].includes(process.argv[2])){console.log('CSharp protocol fixture');}
        else{fs.writeFileSync(${JSON.stringify(path.join(root, 'observed-dotnet.json'))},JSON.stringify({root:process.env.DOTNET_ROOT,host:process.env.DOTNET_HOST_PATH}));
          process.argv.push('--mode','csharp'); await import(${JSON.stringify(pathToFileURL(resolveLspStubServerPath()).href)});}
      ` }] });
    if (process.platform !== 'win32') { await fs.chmod(sdk.command, 0o755); await fs.chmod(server.command, 0o755); }
    const launch = resolveDotnetRuntimeLaunch({ command: server.command, providerId: 'csharp-ls', toolingRoot: sdk.toolingRoot,
      baseEnv: { DOTNET_ROOT: 'wrong', DOTNET_ROOT_X64: 'wrong-architecture-root', MSBuildSDKsPath: 'wrong-sdk', PATH: 'ambient' } });
    assert.equal(launch.environment.DOTNET_ROOT, sdk.root);
    assert.equal(launch.environment.DOTNET_HOST_PATH, sdk.command);
    assert.equal(launch.environment.MSBuildSDKsPath, undefined);
    assert.deepEqual(launch.managedRuntimeCommands.map(entry => entry.installId), [sdk.installId]);
    const profile = resolveToolingCommandProfile({ providerId: 'fixture-sdk-probe', cmd: 'dotnet', args: ['--list-sdks'],
      repoRoot: root, toolingConfig: { dir: sdk.toolingRoot } });
    assert.equal(profile.resolved.cmd, sdk.command, 'bare SDK selection resolves the canonical host before PATH');
    assert.equal(profile.probe.ok, true);
    assert.equal(await sdk.protected(), false, 'bounded version probes release the independent SDK owner');
    const inputs = buildSingleSymbolInputs({ scenarioName: 'managed-dotnet-provider', virtualPath: 'App.cs',
      text: 'class App { string Greet(string name) => name; }\n', languageId: 'csharp', effectiveExt: '.cs', symbolName: 'Greet' });
    await withTemporaryEnv({ PAIROFCLEATS_TRUSTED_REPOS: '[]' }, async () => {
      const denied = await collectLspTypes({ rootDir: root, providerId: 'csharp-ls', cmd: server.command,
        toolingRoot: sdk.toolingRoot, documents: inputs.documents, targets: inputs.targets });
      assert.deepEqual(denied.byChunkUid, {});
      assert.ok(denied.checks.some(check => check.name === 'csharp-ls_workspace_trust_required'));
      await assert.rejects(fs.access(path.join(root, 'observed-dotnet.json')), { code: 'ENOENT' });
      assert.equal(await server.protected(), false);
      assert.equal(await sdk.protected(), false);
    });
    const result = await runDedicatedProviderFixture({ tempRoot: root, providerId: 'csharp-ls', providerConfigKey: 'csharp',
      inputs, authorizeFixtureExecution: true, toolingConfig: { dir: sdk.toolingRoot },
      providerConfig: { cmd: server.command, args: [], sessionIdleTimeoutMs: 60000 } });
    assert.equal(result.byChunkUid.get(inputs.chunkUid)?.payload.returnType, 'string');
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(root, 'observed-dotnet.json'), 'utf8')), { root: sdk.root, host: sdk.command });
    assert.equal(await server.protected(), true, 'server generation remains owned during idle pooling');
    assert.equal(await sdk.protected(), true, 'independent SDK generation remains owned during idle pooling');
    const renamed = await collectLspTypes({ rootDir: root, providerId: 'custom-dotnet-profile', cmd: server.command,
      args: [], toolingRoot: sdk.toolingRoot, documents: inputs.documents, targets: inputs.targets,
      sessionIdleTimeoutMs: 60000 });
    assert.equal(renamed.runtime.managedRuntimeInstallations[0].installId, sdk.installId,
      'renamed configured servers still bind their admitted C# source language to the selected SDK');
    assert.equal((await drainLspSessionPool()).status, 'ok');
    assert.equal(await server.protected(), false);
    assert.equal(await sdk.protected(), false);
    await fs.writeFile(path.join(sdk.owner, 'current.json'), '{}');
    assert.throws(() => resolveDotnetRuntimeLaunch({ command: server.command, providerId: 'csharp-ls', toolingRoot: sdk.toolingRoot }),
      { code: 'ERR_TOOLING_DOTNET_RUNTIME_UNAVAILABLE' }, 'damaged selected SDK never becomes an ambient fallback');
    const denied = resolveToolingCommandProfile({ providerId: 'csharp-ls', cmd: server.command, repoRoot: root, toolingConfig: { dir: sdk.toolingRoot } });
    assert.equal(denied.resolved.mode, 'blocked');
  });
} finally { await drainLspSessionPool(); await fs.rm(root, { recursive: true, force: true }); }
console.log('Managed C# provider binds and retains exact independent SDK/server generations through idle pooling');
