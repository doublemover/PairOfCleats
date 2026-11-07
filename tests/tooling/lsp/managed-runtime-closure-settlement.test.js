import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createRetainedLspClient } from '../../../src/integrations/tooling/lsp/managed-client.js';
import { resolveDotnetRuntimeLaunch } from '../../../src/index/tooling/dotnet-runtime.js';
import { withLspSession, drainLspSessionPool } from '../../../src/integrations/tooling/providers/lsp/session-pool.js';
import { createManagedCommandFixture } from '../../helpers/managed-command-fixture.js';
import { applyTestEnv, withTemporaryEnv } from '../../helpers/test-env.js';

// Authored through the actual retained client and session owner. Synthetic
// child resources exercise lifetime boundaries without qualifying a toolchain.
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-managed-runtime-closure-'));
applyTestEnv({ cacheRoot: path.join(root, 'cache') });
const runtimeSelection = fixture => ({ toolId: fixture.toolId, command: fixture.command,
  descriptorId: fixture.descriptorId, installId: fixture.installId });
try {
  await withTemporaryEnv({ PAIROFCLEATS_HOME: path.join(root, 'home') }, async () => {
    const server = await createManagedCommandFixture(root, { additionalFiles: [{ path: 'server.dll', content: 'inert CLR assembly fixture' }] });
    const first = await createManagedCommandFixture(root, { toolId: 'dotnet-sdk', installId: 'c'.repeat(64), commandRelative: 'dotnet.exe' });
    const options = { repoRoot: root, providerId: 'fixture-lsp', workspaceKey: root,
      toolingRoot: server.toolingRoot, cmd: server.command, args: [], cwd: root, env: { DOTNET_ROOT: first.root },
      managedRuntimeCommands: [runtimeSelection(first)], sessionIdleTimeoutMs: 60000 };
    await withLspSession(options, async lease => {
      assert.equal(lease.client.managedInstallation.installId, server.installId);
      assert.equal(lease.client.managedRuntimeInstallations[0].installId, first.installId);
    });
    assert.equal(await server.protected(), true);
    assert.equal(await first.protected(), true);
    const second = await createManagedCommandFixture(root, { toolId: 'dotnet-sdk', installId: 'd'.repeat(64), commandRelative: 'dotnet.exe' });
    await withLspSession({ ...options, env: { DOTNET_ROOT: second.root }, managedRuntimeCommands: [runtimeSelection(second)] }, async lease => {
      assert.equal(lease.reused, false, 'changed SDK generation and environment produce a different session');
      assert.equal(lease.client.managedRuntimeInstallations[0].installId, second.installId);
    });
    assert.equal((await drainLspSessionPool()).status, 'ok');
    assert.equal(await server.protected(), false);
    assert.equal(await second.protected(), false);

    const assemblyLaunch = resolveDotnetRuntimeLaunch({ command: 'dotnet', args: [path.join(server.root, 'server.dll')],
      cwd: root, providerId: 'csharp-ls', toolingRoot: server.toolingRoot, baseEnv: {} });
    assert.equal(assemblyLaunch.command, second.command);
    assert.deepEqual(new Set(assemblyLaunch.managedRuntimeCommands.map(entry => entry.toolId)), new Set(['fixture-lsp', 'dotnet-sdk']));
    const assemblyClient = await createRetainedLspClient({ cmd: assemblyLaunch.command, toolingRoot: server.toolingRoot,
      managedRuntimeCommands: assemblyLaunch.managedRuntimeCommands, cwd: root, env: assemblyLaunch.environment });
    assert.equal(await server.protected(), true, 'a dotnet-hosted managed DLL independently retains its server generation');
    assert.equal(await second.protected(), true);
    assert.equal(await assemblyClient.releaseManagedInstallation(), true);
    assert.equal(await server.protected(), false);
    assert.equal(await second.protected(), false);

    const current = { ...options, managedRuntimeCommands: [runtimeSelection(second)] };
    await assert.rejects(createRetainedLspClient({ ...current,
      managedRuntimeCommands: [{ ...runtimeSelection(second), descriptorId: 'e'.repeat(64) }] }), /changed after launch selection/u);
    assert.equal(await server.protected(), false, 'later runtime admission failure releases the already acquired server owner');
    assert.equal(await second.protected(), false);

    const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(),
      stderr: new PassThrough(), exitCode: null, signalCode: null, killed: false, unref() {} });
    let spawns = 0;
    const client = await createRetainedLspClient({ ...current, spawnProcess() { spawns += 1; return child; } });
    client.start();
    child.exitCode = 0;
    child.emit('exit', 0, null);
    assert.equal(client.getTerminationEvidence().settled, false);
    const release = client.releaseManagedInstallation();
    await Promise.resolve();
    assert.equal(await server.protected(), true, 'server ownership survives direct child exit before close');
    assert.equal(await second.protected(), true, 'runtime ownership survives the same pending original streams');
    child.emit('close', 0, null);
    assert.equal(await release, true);
    assert.equal(await server.protected(), false);
    assert.equal(await second.protected(), false);
    assert.throws(() => client.start(), { code: 'ERR_TOOLING_MANAGED_INSTALLATION' });
    assert.equal(spawns, 1, 'neither released owner permits a transport restart');
  });
} finally { await drainLspSessionPool(); await fs.rm(root, { recursive: true, force: true }); }
console.log('Independent managed SDK/server closure survives pooling, generation changes and delayed original child close');
