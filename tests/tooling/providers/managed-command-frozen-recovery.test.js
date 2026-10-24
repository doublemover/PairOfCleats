import assert from 'node:assert/strict';
import { errorGraphMatches } from '../../helpers/error-graph.js';
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { createManagedCommandFixture } from '../../helpers/managed-command-fixture.js';
import { withTemporaryEnv } from '../../helpers/test-env.js';
import { repoAccessPaths } from '../../../src/shared/cache/repo-access.js';
import { runWithManagedCommandInstallation } from '../../../src/index/tooling/managed-command-lifetime.js';
import { createRetainedLspClient } from '../../../src/integrations/tooling/lsp/managed-client.js';

// Canonical actual retained installation plus inert direct-child events. Unrun.
const root = await makeTempDir('managed-command-frozen-recovery-');
const remove = fs.rmSync;
const retained = new Set();
try {
  await withTemporaryEnv({ PAIROFCLEATS_HOME: path.join(root, 'home') }, async () => {
    const f = await createManagedCommandFixture(root);
    const options = { toolingRoot: f.toolingRoot, command: f.command };
    let child, observed = false;
    const capability = Object.freeze({ id: 'original child owner' });
    const primary = new Error('frozen child cleanup remains pending');
    Object.defineProperties(primary, { code: { value: 'EIO' }, nativeOwner: { value: capability },
      cacheOwnershipPending: { value: true }, cacheOwnershipReleased: { value() { return this === primary && observed; } } });
    Object.freeze(primary);
    let pending;
    await assert.rejects(runWithManagedCommandInstallation(options, async ({ onSpawn }) => {
      child = new EventEmitter(); onSpawn(child); throw primary;
    }), error => { pending = error; return error.cause === primary; });
    retained.add(pending.managedCommandLease);
    assert.equal(pending.nativeOwner, capability); assert.equal(pending.code, 'EIO');
    assert.equal(pending.cacheOwnershipReleased(), false); assert.equal(await f.protected(), true);
    child.emit('close', null, 'SIGTERM');
    assert.equal(await f.protected(), true, 'exact close alone cannot erase an independent native owner');
    assert.throws(() => pending.managedCommandSession.releaseAfterClosure(), error => errorGraphMatches(error, /pending|unconfirmed/));
    observed = true;
    assert.equal(pending.managedCommandSession.releaseAfterClosure(), true,
      'the original observer retains its original receiver and exact metadata owner');
    assert.equal(pending.cacheOwnershipReleased(), true); assert.equal(await f.protected(), false);
    retained.delete(pending.managedCommandLease);

    const coordinationRoot = path.join(root, 'home', 'state', 'storage-access');
    const categoryLeases = repoAccessPaths(f.toolingRoot, { coordinationRoot }).leases;
    let deny = true, removals = 0;
    fs.rmSync = (target, ...args) => {
      if (deny && path.dirname(String(target)) === categoryLeases && String(target).endsWith('.json')) {
        removals++; throw Object.freeze(Object.assign(new Error('inert exact lease unlink denied'), { code: 'EACCES' }));
      }
      return remove(target, ...args);
    };
    let metadataPending;
    await assert.rejects(runWithManagedCommandInstallation(options, async ({ onSpawn }) => {
      const completed = new EventEmitter(); onSpawn(completed); completed.emit('close', 0, null);
      return { exitCode: 0 };
    }), error => { metadataPending = error; return error.cacheOwnershipPending === true; });
    retained.add(metadataPending.managedCommandLease);
    assert.equal(removals, 1, 'failed own metadata is retained for explicit retry, not immediately attempted again');
    assert.equal(metadataPending.cacheOwnershipReleased(), false);
    deny = false; fs.rmSync = remove;
    assert.equal(metadataPending.managedCommandSession.releaseAfterClosure(), true,
      'its own failed metadata observer cannot block the exact retry that settles it');
    assert.equal(metadataPending.cacheOwnershipReleased(), true);
    assert.equal(await f.protected(), false); retained.delete(metadataPending.managedCommandLease);

    const lspOptions = { repoRoot: root, providerId: 'fixture-lsp', workspaceKey: root,
      toolingRoot: f.toolingRoot, cmd: f.command, args: [], cwd: root, env: {}, timeoutMs: 1000, retries: 0 };
    const unstarted = await createRetainedLspClient(lspOptions);
    deny = true;
    fs.rmSync = (target, ...args) => {
      if (deny && path.dirname(String(target)) === categoryLeases && String(target).endsWith('.json')) {
        throw new Error('controlled unstarted LSP lease removal failure');
      }
      return remove(target, ...args);
    };
    let lspPending;
    await assert.rejects(unstarted.releaseManagedInstallation(), error => {
      lspPending = error; return error.cacheOwnershipPending === true && Boolean(error.managedCommandLease);
    });
    retained.add(lspPending.managedCommandLease);
    deny = false;
    assert.equal(await unstarted.releaseManagedInstallation(), true);
    assert.equal(lspPending.cacheOwnershipReleased(), true); retained.delete(lspPending.managedCommandLease);

    const constructionFailure = Object.freeze(new Error('controlled frozen LSP constructor input failure'));
    const brokenOptions = Object.defineProperty({ ...lspOptions }, 'controlledConstructorInput', {
      enumerable: true, get() { throw constructionFailure; }
    });
    deny = true;
    let constructionPending;
    await assert.rejects(createRetainedLspClient(brokenOptions), error => {
      constructionPending = error; return error.cause === constructionFailure && error.cacheOwnershipPending === true;
    });
    retained.add(constructionPending.managedCommandLease);
    assert.ok(constructionPending.managedCommandReleaseError);
    deny = false; fs.rmSync = remove;
    constructionPending.managedCommandLease.releaseAfterSettlement({ settled: true, pending: false });
    assert.equal(constructionPending.cacheOwnershipReleased(), true);
    retained.delete(constructionPending.managedCommandLease);

    const unknown = Object.freeze(Object.assign(new Error('unobserved native ownership'), { cacheOwnershipPending: true }));
    let unconfirmed;
    await assert.rejects(runWithManagedCommandInstallation(options, async ({ onSpawn }) => {
      const completed = new EventEmitter(); onSpawn(completed); completed.emit('close', 0, null); throw unknown;
    }), error => { unconfirmed = error; return error.cause === unknown; });
    retained.add(unconfirmed.managedCommandLease);
    assert.equal(unconfirmed.cacheOwnershipReleased(), false);
    assert.throws(() => unconfirmed.managedCommandSession.releaseAfterClosure(), error =>
      error.cacheOwnershipPending === true && error.cause === unknown);
    assert.equal(await f.protected(), true);
    // Inert fixture callback created no native resources; release only its exact
    // lease for teardown after the unknown-owner rejection has been asserted.
    unconfirmed.managedCommandLease.releaseAfterSettlement({ settled: true, pending: false });
    retained.delete(unconfirmed.managedCommandLease);
    assert.equal(unconfirmed.cacheOwnershipReleased(), false, 'unknown original ownership is never relabeled confirmed');
  });
} finally {
  fs.rmSync = remove;
  for (const lease of retained) lease.releaseAfterSettlement({ settled: true, pending: false });
  await rmDirRecursive(root);
}
console.log('Managed command frozen failures, exact close, strict native observers and metadata retries passed');
