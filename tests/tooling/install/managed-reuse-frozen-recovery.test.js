import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { withTemporaryEnv } from '../../helpers/test-env.js';
import { createManagedCommandFixture } from '../../helpers/managed-command-fixture.js';
import { installPinnedManagedTool } from '../../../tools/tooling/managed-install.js';
import { isStorageSessionReleaseFailure } from '../../../src/shared/storage/session.js';

// UNVALIDATED: actual reuse/receipt/file/category consumers; verifier is inert.
const temporary = await makeTempDir('poc-managed-reuse-recovery-');
try {
  await withTemporaryEnv({ PAIROFCLEATS_HOME: path.join(temporary, 'home') }, async () => {
    const fixture = await createManagedCommandFixture(temporary);
    const receipt = JSON.parse(await fs.readFile(path.join(fixture.owner, 'receipts', fixture.installId + '.json'), 'utf8'));
    const options = { toolingRoot: fixture.toolingRoot, descriptor: receipt.descriptor, approvedOrigins: ['https://fixture.invalid'],
      download: async () => { throw new Error('Existing-generation verification must perform zero downloads.'); } };
    const exact = session => ({ resourceId: session.resourceId, settled: true, pending: false });
    const successful = await installPinnedManagedTool({ ...options,
      verify: async ({ resourceId }) => ({ ok: true, settlement: { resourceId, settled: true, pending: false } }) });
    assert.equal(successful.reused, true);
    assert.equal(successful.downloadedBytes, 0);
    assert.equal(await fixture.protected(), false);
    await assert.rejects(installPinnedManagedTool({ ...options,
      verify: async ({ resourceId }) => ({ ok: false, settlement: { resourceId, settled: true, pending: false } }) }), /verification failed/);
    assert.equal(await fixture.protected(), false, 'a failed capability check with an exact settled child receipt retains no installation metadata');

    const frozen = Object.freeze(Object.assign(new Error('frozen verifier without its resource receipt'), { code: 'EIO' }));
    let unconfirmed;
    try { await installPinnedManagedTool({ ...options, verify: async () => { throw frozen; } }); }
    catch (error) { unconfirmed = error; }
    assert.equal(unconfirmed.cause, frozen);
    assert.equal(unconfirmed.code, 'EIO');
    assert.equal(unconfirmed.cacheOwnershipReleased(), false);
    const session = unconfirmed.managedInstallSession;
    assert.equal(await fixture.protected(), true);
    assert.throws(() => session.releaseAfterSettlement({ ...exact(session), pending: undefined }), /remains pending/);
    assert.throws(() => session.releaseAfterSettlement({ ...exact(session), resourceId: 'another-resource' }), /remains pending/);
    assert.throws(() => session.releaseAfterSettlement({ ...exact(session), unknownOwner: true }), /remains pending/);
    assert.equal(session.releaseAfterSettlement(exact(session)), true);
    assert.equal(unconfirmed.cacheOwnershipReleased(), true);
    assert.equal(session.releaseAfterSettlement(exact(session)), true);
    assert.throws(() => session.releaseAfterSettlement(), /remains pending/, 'each public reconciliation still requires the exact receipt');
    assert.equal(await fixture.protected(), false);

    const previousSession = Object.freeze({ resourceId: 'previous-inert-owner' });
    const nestedPrimary = new Error('readonly previous verification capability');
    Object.defineProperty(nestedPrimary, 'managedInstallSession', { value: previousSession });
    Object.freeze(nestedPrimary);
    let nested;
    try { await installPinnedManagedTool({ ...options, verify: async () => { throw nestedPrimary; } }); }
    catch (error) { nested = error; }
    assert.equal(nested.cause.managedInstallSession, previousSession, 'the earlier capability remains on the exact original cause chain');
    assert.equal(nested.cause.cause, nestedPrimary);
    assert.notEqual(nested.managedInstallSession, previousSession);
    assert.equal(nested.managedInstallSession.releaseAfterSettlement(exact(nested.managedInstallSession)), true);
    assert.equal(nested.cacheOwnershipReleased(), true);
    assert.equal(await fixture.protected(), false);

    const originalRemove = fsSync.rmSync;
    const coordinationRoot = path.join(temporary, 'home', 'state', 'storage-access');
    let deny = true;
    try {
      fsSync.rmSync = (target, removal) => {
        if (deny && String(target).startsWith(coordinationRoot + path.sep)) throw Object.assign(new Error('actual reused verification lease unlink denied'), { code: 'EACCES' });
        return originalRemove(target, removal);
      };
      let metadata;
      try { await installPinnedManagedTool({ ...options,
        verify: async ({ resourceId }) => ({ ok: true, settlement: { resourceId, settled: true, pending: false } }) }); }
      catch (error) { metadata = error; }
      assert.equal(isStorageSessionReleaseFailure(metadata, metadata.storageSession), true);
      assert.equal(metadata.cacheOwnershipReleased(), false);
      assert.equal(await fixture.protected(), true);
      deny = false;
      assert.equal(metadata.managedInstallSession.releaseAfterSettlement(exact(metadata.managedInstallSession)), true);
      assert.equal(metadata.cacheOwnershipReleased(), true);
      assert.equal(await fixture.protected(), false);

      deny = true;
      let primary, combined;
      try { await installPinnedManagedTool({ ...options, verify: async ({ resourceId }) => {
        primary = Object.freeze(Object.assign(new Error('frozen settled verifier failure'), { code: 'EIO',
          settlement: { resourceId, settled: true, pending: false } }));
        throw primary;
      } }); } catch (error) { combined = error; }
      assert.equal(combined.cause, primary);
      assert.equal(combined.code, 'EIO');
      assert.equal(isStorageSessionReleaseFailure(combined.managedCleanupError, combined.managedCleanupError.storageSession), true);
      assert.equal(combined.cacheOwnershipReleased(), false);
      deny = false;
      assert.equal(combined.managedInstallSession.releaseAfterSettlement(exact(combined.managedInstallSession)), true);
      assert.equal(combined.cacheOwnershipReleased(), true);
      assert.equal(await fixture.protected(), false);
    } finally { fsSync.rmSync = originalRemove; }

    const cancellation = new AbortController();
    const cancelled = Object.freeze(new Error('frozen cancellation after settled verifier'));
    await assert.rejects(installPinnedManagedTool({ ...options, signal: cancellation.signal, verify: async ({ resourceId }) => {
      cancellation.abort(cancelled);
      return { ok: true, settlement: { resourceId, settled: true, pending: false } };
    } }), error => error === cancelled);
    assert.equal(await fixture.protected(), false, 'known settled verifier cancellation still releases exact installation metadata');

    for (const observation of ['known', 'missing', 'throwing']) {
      let confirmed = false, primary, failure;
      try { await installPinnedManagedTool({ ...options, verify: async ({ resourceId }) => {
        primary = Object.freeze(Object.assign(new Error(`frozen ${observation} native owner`), {
          code: 'ERR_STORAGE_SESSION_LEASE_CHANGED', cacheOwnershipPending: true,
          settlement: { resourceId, settled: true, pending: false },
          ...(observation === 'known' ? { cacheOwnershipReleased() { return this === primary && confirmed; } }
            : observation === 'throwing' ? { cacheOwnershipReleased() { throw new Error('unknown native close'); } } : {})
        }));
        throw primary;
      } }); } catch (error) { failure = error; }
      assert.equal(failure.cause, primary);
      const owned = failure.managedInstallSession;
      assert.equal(failure.cacheOwnershipReleased(), false);
      assert.throws(() => owned.releaseAfterSettlement(exact(owned)), /remains pending/,
        'a contradictory explicit receipt cannot override the original pending native observer');
      assert.equal(await fixture.protected(), true);
      confirmed = true;
      if (observation === 'known') {
        assert.equal(owned.releaseAfterSettlement(exact(owned)), true);
        assert.equal(failure.cacheOwnershipReleased(), true, 'the original observer retains its exact receiver');
      } else {
        assert.throws(() => owned.releaseAfterSettlement(exact(owned)), /remains pending/);
        // This verifier owns no native resources. Keep its exact pending
        // evidence until final disposable-fixture cleanup; no production
        // resource settlement is claimed by that fixture cleanup.
        assert.equal(await fixture.protected(), true);
      }
    }
  });
} finally { await rmDirRecursive(temporary); }
console.log('Reused managed verification preserves frozen primary and independent native ownership.');
