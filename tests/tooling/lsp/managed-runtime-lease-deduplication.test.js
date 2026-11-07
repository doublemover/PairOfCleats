import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createManagedCommandFixture } from '../../helpers/managed-command-fixture.js';
import { withTemporaryEnv } from '../../helpers/test-env.js';
import { createRetainedLspClient } from '../../../src/integrations/tooling/lsp/managed-client.js';
import { runWithManagedCommandInstallationSync, reuseRetainedManagedCommandInstallation } from '../../../src/index/tooling/managed-command-lifetime.js';
import { spawnResolvedSubprocessSync } from '../../../src/shared/subprocess/command-invocation.js';
import { inspectStorageAccess } from '../../../src/shared/storage/access.js';
import { assertNoSymlinkPath } from '../../../src/shared/contained-file.js';
import { isPathWithinRoot } from '../../../src/shared/file-paths.js';

const mode = process.env.PAIROFCLEATS_TEST_ID?.split('tooling/lsp/managed-runtime-lease-deduplication/')[1];
const scope = path.resolve('.tmp/tasks/managed-runtime-lease-sharing'); await fsp.mkdir(scope, { recursive: true });
const temporary = await fsp.mkdtemp(path.join(scope, 'case-')), marker = randomUUID();
await fsp.writeFile(path.join(temporary, '.owned-fixture'), marker);
const originalOpen = fs.openSync;
try {
  await withTemporaryEnv({ PAIROFCLEATS_HOME: path.join(temporary, 'home') }, async () => {
    const quoted = value => "'" + value.replaceAll("'", "'\"'\"'") + "'";
    const sdk = await createManagedCommandFixture(temporary, { toolId: 'dotnet-sdk', commandRelative: process.platform === 'win32' ? 'dotnet.cmd' : 'dotnet',
      commandContent: process.platform === 'win32' ? `@echo off\r\n"${process.execPath}" "%~dp0host.mjs" %*\r\n`
        : `#!/bin/sh\nexec ${quoted(process.execPath)} "$(dirname "$0")/host.mjs" "$@"\n`,
      additionalFiles: [{ path: 'host.mjs', content: `if(process.argv.includes('--version'))console.log('explicit runtime fixture');else await import(${JSON.stringify(new URL('../../fixtures/lsp/stub-lsp-server.js', import.meta.url).href)});` },
        { path: 'owned-library.dat', content: 'the original full immutable inventory still verifies this dependency' }] });
    if (process.platform !== 'win32') await fsp.chmod(sdk.command, 0o755);
    const selected = { toolId: sdk.toolId, command: sdk.command, descriptorId: sdk.descriptorId, installId: sdk.installId };
    const options = { toolingRoot: sdk.toolingRoot, command: sdk.command, managedRuntimeCommands: [selected] };
    const witness = path.join(sdk.root, 'owned-library.dat'); let inventoryReads = 0;
    fs.openSync = (...args) => {
      if (typeof args[0] === 'string' && path.resolve(args[0]) === witness) inventoryReads++;
      return originalOpen(...args);
    };
    const coordinationRoot = path.join(temporary, 'home/state/storage-access');
    if (mode === 'synchronous-original-owner') {
      const result = runWithManagedCommandInstallationSync(options, () => spawnResolvedSubprocessSync(sdk.command, ['--version'], {
        cwd: temporary, stdio: ['ignore', 'pipe', 'pipe'], rejectOnNonZeroExit: false, timeoutMs: 4000
      }));
      assert.equal(result.exitCode, 0); assert.equal(inventoryReads, 2, 'the original two full byte inspections run once, not again for the identical runtime');
      assert.equal(await sdk.protected(), false);
    } else if (mode === 'retained-client-original-owner') {
      const client = await createRetainedLspClient({ ...options, cmd: sdk.command, args: [], cwd: temporary });
      try {
        assert.equal(inventoryReads, 2);
        const before = await inspectStorageAccess(sdk.owner, { coordinationRoot });
        assert.equal(before.owners.filter(owner => owner.role === 'reader-or-writer').length, 1);
        assert.equal(client.managedRuntimeInstallations[0].installId, client.managedInstallation.installId);
        await client.initialize({ rootUri: pathToFileURL(temporary).href, capabilities: {}, timeoutMs: 4000 });
        assert.equal(await sdk.protected(), true);
      } finally { await client.shutdownAndExit(); assert.equal(await client.releaseManagedInstallation(), true); }
      assert.equal(await sdk.protected(), false);
    } else if (mode === 'changed-identity-and-lookalike-refusal') {
      let admitted = 0;
      assert.throws(() => runWithManagedCommandInstallationSync({ ...options,
        managedRuntimeCommands: [{ ...selected, descriptorId: 'e'.repeat(64) }] }, () => { admitted++; }), /changed after launch selection/);
      assert.equal(admitted, 0); assert.equal(await sdk.protected(), false);
      await assert.rejects(createRetainedLspClient({ cmd: sdk.command, toolingRoot: sdk.toolingRoot,
        managedRuntimeCommands: [{ ...selected, installId: 'f'.repeat(64) }] }), /changed after launch selection/);
      assert.equal(await sdk.protected(), false);
      assert.equal(reuseRetainedManagedCommandInstallation([{ ...selected, assertHeld: () => assert.fail('Copied handles have no authority') }],
        { toolingRoot: sdk.toolingRoot, command: sdk.command, expectedSelection: selected }), null);
    } else throw new Error(`Unknown runtime sharing case: ${mode}`);
  });
} finally {
  fs.openSync = originalOpen;
  assert.equal(isPathWithinRoot(temporary, scope), true); assertNoSymlinkPath(scope, temporary);
  assert.equal(await fsp.readFile(path.join(temporary, '.owned-fixture'), 'utf8'), marker);
  await fsp.rm(temporary, { recursive: true, force: true });
}
console.log(`managed runtime lease sharing passed: ${mode}`);
