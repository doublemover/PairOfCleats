import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createRetainedLspClient } from '../../../src/integrations/tooling/lsp/managed-client.js';
import { withLspSession, drainLspSessionPool } from '../../../src/integrations/tooling/providers/lsp/session-pool.js';
import { resolveManagedCommandSelection } from '../../../src/index/tooling/managed-command-lifetime.js';
import { createManagedCommandFixture } from '../../helpers/managed-command-fixture.js';
import { withTemporaryEnv } from '../../helpers/test-env.js';

// UNVALIDATED. A synthetic transport proves the real runtime lease boundary;
// it does not establish executable/protocol/platform compatibility.
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-lsp-managed-lifetime-'));
try {
  await withTemporaryEnv({ PAIROFCLEATS_HOME: path.join(root, 'home') }, async () => {
    const f = await createManagedCommandFixture(root);
    const options = { repoRoot: root, providerId: 'fixture-lsp', workspaceKey: root,
      toolingRoot: f.toolingRoot, cmd: f.command, args: [], cwd: root, env: {},
      timeoutMs: 1000, retries: 0, breakerThreshold: 1, sessionIdleTimeoutMs: 60000 };
    let reused;
    await withLspSession(options, async lease => {
      assert.equal(await f.protected(), true);
      assert.equal(lease.client.managedInstallation.installId, f.installId);
    });
    assert.equal(await f.protected(), true, 'idle pool keeps the selected generation');
    await withLspSession(options, async lease => { reused = lease.reused; });
    assert.equal(reused, true);
    assert.equal((await drainLspSessionPool()).status, 'ok');
    assert.equal(await f.protected(), false, 'unstarted pool disposal releases after no-resource evidence');
    const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(),
      stderr: new PassThrough(), exitCode: null, signalCode: null, killed: false, unref() {} });
    let spawns = 0;
    const client = await createRetainedLspClient({ ...options, spawnProcess(input) {
      assert.equal(input.rawCmd, f.command); spawns++; return child;
    } });
    assert.equal(await f.protected(), true);
    client.start();
    child.exitCode = 0;
    child.emit('exit', 0, null);
    assert.equal(client.getTerminationEvidence().exitObserved, true);
    assert.equal(client.getTerminationEvidence().settled, false);
    assert.equal(await f.protected(), true, 'exit before stdio close retains installation');
    const releasing = client.releaseManagedInstallation();
    await Promise.resolve();
    assert.equal(await f.protected(), true);
    child.emit('close', 0, null);
    assert.equal(await releasing, true);
    assert.equal(await f.protected(), false);
    assert.throws(() => client.start(), { code: 'ERR_TOOLING_MANAGED_INSTALLATION' });
    assert.equal(spawns, 1, 'released physical generation cannot restart');
    assert.throws(() => resolveManagedCommandSelection({ toolingRoot: f.toolingRoot,
      command: f.command.replace(f.installId, 'b'.repeat(64)) }), /stale|selected/);
    await fs.writeFile(f.command, 'drifted inert file');
    await assert.rejects(createRetainedLspClient(options), /stale|damaged/);
  });
} finally { await drainLspSessionPool(); await fs.rm(root, { recursive: true, force: true }); }
console.log('Managed LSP selection remains leased through idle retention and child resource close');
