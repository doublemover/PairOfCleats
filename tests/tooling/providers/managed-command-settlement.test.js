import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { runWithManagedCommandInstallation, runWithManagedCommandInstallationSync } from '../../../src/index/tooling/managed-command-lifetime.js';
import { createManagedCommandFixture } from '../../helpers/managed-command-fixture.js';
import { withTemporaryEnv } from '../../helpers/test-env.js';

// UNVALIDATED. Exact callbacks model shared subprocess-owner settlement; no
// external binary, installer archive or operational JSONL provider is qualified.
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-provider-managed-settlement-'));
try {
  await withTemporaryEnv({ PAIROFCLEATS_HOME: path.join(root, 'home') }, async () => {
    const f = await createManagedCommandFixture(root);
    const options = { toolingRoot: f.toolingRoot, command: f.command };
    const normal = await runWithManagedCommandInstallation(options, async ({ onSpawn }) => {
      assert.equal(await f.protected(), true);
      const child = new EventEmitter(); onSpawn(child); child.emit('close', 0, null);
      return { exitCode: 0 };
    });
    assert.equal(normal.exitCode, 0);
    assert.equal(await f.protected(), false);
    let child, observed = false, pendingError;
    await assert.rejects(runWithManagedCommandInstallation(options, async ({ onSpawn }) => {
      child = new EventEmitter(); onSpawn(child);
      pendingError = Object.assign(new Error('cancelled with close pending'), { code: 'ABORT_ERR', cacheOwnershipPending: true });
      Object.defineProperty(pendingError, 'cacheOwnershipReleased', { value: () => observed });
      throw pendingError;
    }), error => error === pendingError);
    assert.equal(pendingError.managedCommandInstallation.installId, f.installId);
    assert.equal(await f.protected(), true, 'cancelled invocation is still owned');
    observed = true; child.emit('close', null, 'SIGTERM');
    assert.equal(await f.protected(), false, 'delayed exact close reconciles retained lease');
    assert.equal(runWithManagedCommandInstallationSync(options, () => ({ exitCode: 1, signal: null })).exitCode, 1);
    assert.equal(await f.protected(), false);
    const timeout = Object.assign(new Error('sync tree cleanup unconfirmed'), { code: 'SUBPROCESS_TIMEOUT',
      result: { pid: 123, exitCode: null, signal: 'SIGTERM' } });
    assert.throws(() => runWithManagedCommandInstallationSync(options, () => { throw timeout; }), error => error === timeout);
    assert.equal(timeout.cacheOwnershipPending, true);
    assert.equal(await f.protected(), true, 'sync timeout signal is not child-tree settlement');
  });
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('Managed provider leases follow exact subprocess closure and retain unresolved sync timeout');
