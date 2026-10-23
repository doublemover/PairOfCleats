import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { runWithManagedCommandInstallation, runWithManagedCommandInstallationSync, resolveManagedCommandSelection,
  retainManagedCommandInstallation } from '../../../src/index/tooling/managed-command-lifetime.js';
import { createManagedCommandFixture } from '../../helpers/managed-command-fixture.js';
import { withTemporaryEnv } from '../../helpers/test-env.js';

// UNVALIDATED. Exact callbacks model shared subprocess-owner settlement; no
// external binary, installer archive or operational JSONL provider is qualified.
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-provider-managed-settlement-'));
try {
  await withTemporaryEnv({ PAIROFCLEATS_HOME: path.join(root, 'home') }, async () => {
    const f = await createManagedCommandFixture(root);
    const options = { toolingRoot: f.toolingRoot, command: f.command };
    await withTemporaryEnv({ PAIROFCLEATS_TOOLING_DIR: f.toolingRoot }, async () => {
      assert.equal(resolveManagedCommandSelection({ command: f.command }).installId, f.installId,
        'default canonical tooling selection is retained even when the caller omits an explicit root');
    });
    const exactLease = await retainManagedCommandInstallation(options);
    assert.equal(exactLease.releaseAfterSettlement({ settled: true }), false,
      'missing pending flag is not exact owner settlement');
    assert.equal(exactLease.releaseAfterSettlement({ settled: true, pending: null }), false);
    assert.equal(exactLease.releaseAfterSettlement({ settled: true, pending: true }), false);
    assert.equal(await f.protected(), true, 'incomplete evidence keeps the physical generation leased');
    assert.equal(exactLease.releaseAfterSettlement({ settled: true, pending: false }), true);
    assert.equal(await f.protected(), false);
    let deniedRuns = 0;
    const deniedLaunch = Object.assign(new Error('launch authority revoked during lease acquisition'), { code: 'ERR_FIXTURE_DENIED' });
    await assert.rejects(runWithManagedCommandInstallation({ ...options, beforeSpawn: () => { throw deniedLaunch; } }, () => {
      deniedRuns += 1;
    }), error => error === deniedLaunch);
    assert.equal(deniedRuns, 0, 'denied launch never enters the process owner');
    assert.equal(await f.protected(), false, 'no-child denial releases the exact acquisition');
    const admissionCancellation = new AbortController();
    await assert.rejects(runWithManagedCommandInstallation({ ...options, signal: admissionCancellation.signal,
      beforeSpawn: () => admissionCancellation.abort() }, () => { deniedRuns += 1; }), { code: 'ABORT_ERR' });
    assert.equal(deniedRuns, 0);
    assert.equal(await f.protected(), false, 'cancellation before invocation cannot leave an orphan lease');
    const normal = await runWithManagedCommandInstallation(options, async ({ onSpawn }) => {
      assert.equal(await f.protected(), true);
      const child = new EventEmitter(); onSpawn(child); child.emit('close', 0, null);
      return { exitCode: 0 };
    });
    assert.equal(normal.exitCode, 0);
    assert.equal(await f.protected(), false);
    let child, observed = false, pendingError, retained;
    await assert.rejects(runWithManagedCommandInstallation(options, async ({ onSpawn }) => {
      child = new EventEmitter(); onSpawn(child);
      pendingError = Object.assign(new Error('cancelled with close pending'), { code: 'ABORT_ERR', cacheOwnershipPending: true });
      Object.defineProperty(pendingError, 'cacheOwnershipReleased', { value: () => observed });
      throw pendingError;
    }), error => { retained = error; return error.cause === pendingError; });
    assert.equal(retained.managedCommandInstallation.installId, f.installId);
    assert.equal(retained.cacheOwnershipReleased(), false);
    assert.equal(await f.protected(), true, 'cancelled invocation is still owned');
    observed = true; child.emit('close', null, 'SIGTERM');
    assert.equal(await f.protected(), false, 'delayed exact close reconciles retained lease');
    assert.equal(retained.cacheOwnershipReleased(), true);
    assert.equal(runWithManagedCommandInstallationSync(options, () => ({ exitCode: 1, signal: null })).exitCode, 1);
    assert.equal(await f.protected(), false);
    const timeout = Object.assign(new Error('sync tree cleanup unconfirmed'), { code: 'SUBPROCESS_TIMEOUT',
      result: { pid: 123, exitCode: null, signal: 'SIGTERM' } });
    let syncPending;
    assert.throws(() => runWithManagedCommandInstallationSync(options, () => { throw timeout; }), error => {
      syncPending = error; return error.cause === timeout;
    });
    assert.equal(syncPending.cacheOwnershipPending, true);
    assert.equal(await f.protected(), true, 'sync timeout signal is not child-tree settlement');
    // This callback spawned no process; explicit fixture owner confirmation
    // cleans its exact metadata after the unconfirmed-tree negative above.
    syncPending.managedCommandLease.releaseAfterSettlement({ settled: true, pending: false });
    assert.equal(await f.protected(), false);
  });
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('Managed provider leases follow exact subprocess closure and retain unresolved sync timeout');
