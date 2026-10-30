import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { withTemporaryEnv } from '../../helpers/test-env.js';
import { runInstallWithStorageAdmission } from '../../../tools/tooling/install-storage.js';
import { inspectStorageAccess } from '../../../src/shared/storage/access.js';
import { isStorageSessionReleaseFailure } from '../../../src/shared/storage/session.js';

// UNVALIDATED: actual outer admission/reservation/lease owners; inert actions.
const temporary = await makeTempDir('poc-install-admission-frozen-');
const contains = (error, original) => {
  const pending = [error], seen = new Set();
  while (pending.length) { const current = pending.pop(); if (!current || seen.has(current)) continue;
    if (current === original) return true;
    seen.add(current); pending.push(current.cause, ...(Array.isArray(current.errors) ? current.errors : [])); }
  return false;
};
try {
  const home = path.join(temporary, 'home'), toolingRoot = path.join(temporary, 'tools');
  const coordinationRoot = path.join(home, 'state', 'storage-access');
  await fs.mkdir(toolingRoot, { recursive: true });
  await withTemporaryEnv({ PAIROFCLEATS_HOME: home }, async () => {
    const input = { toolingRoot, storageEstimate: { complete: true, writes: [{ destination: 'artifacts', requiredBytes: 1 }] } };
    const inspect = () => inspectStorageAccess(toolingRoot, { coordinationRoot });
    const primary = Object.freeze(Object.assign(new Error('frozen settled install action failed'), { code: 'EIO' }));
    let plain;
    try { await runInstallWithStorageAdmission(input, async () => { throw primary; }); }
    catch (error) { plain = error; }
    assert.equal(contains(plain, primary), true);
    assert.equal(plain.code, 'EIO');
    assert.equal(plain.storageWriteReservations.length, 1);
    assert.equal(Object.keys(plain).includes('storageWriteReservations'), false);
    assert.equal((await inspect()).protected, false);

    const childSession = Object.freeze({ resourceId: 'earlier-inert-child' });
    const nested = new Error('frozen nested child diagnostics');
    Object.defineProperties(nested, { storageSession: { value: childSession },
      installChildStorageSessions: { value: 'earlier non-array diagnostic' },
      storageWriteReservations: { value: [] }, installChildWriteReservations: { value: 'earlier non-array diagnostic' } });
    Object.freeze(nested);
    let contextual;
    try { await runInstallWithStorageAdmission(input, async () => { throw nested; }); }
    catch (error) { contextual = error; }
    assert.equal(contains(contextual, nested), true);
    assert.deepEqual(contextual.installChildStorageSessions, [childSession]);
    assert.deepEqual(contextual.installChildWriteReservations, []);
    assert.equal(contextual.storageSession, childSession, 'earlier child capabilities retain their exact identities');
    assert.equal(nested.installChildStorageSessions, 'earlier non-array diagnostic');
    assert.equal(Object.keys(contextual).includes('installChildStorageSessions'), false);
    assert.equal((await inspect()).protected, false);

    const originalRemove = fsSync.rmSync;
    let deny = true;
    try {
      fsSync.rmSync = (target, options) => {
        if (deny && String(target).startsWith(coordinationRoot + path.sep)) throw Object.assign(new Error('actual outer installation lease unlink denied'), { code: 'EACCES' });
        return originalRemove(target, options);
      };
      let metadata;
      try { await runInstallWithStorageAdmission(input, async () => { throw primary; }); }
      catch (error) { metadata = error; }
      assert.equal(contains(metadata, primary), true);
      assert.equal(isStorageSessionReleaseFailure(metadata.storageSettlementError, metadata.storageSession), true);
      assert.equal(metadata.cacheOwnershipReleased(), false);
      const held = metadata.installStorageMetadataSession;
      const receipt = { resourceId: held.resourceId, settled: true, pending: false };
      assert.equal(Object.keys(metadata).includes('installStorageMetadataSession'), false);
      await assert.rejects(held.releaseAfterSettlement({ ...receipt, pending: undefined }), /exact resource receipt/);
      await assert.rejects(held.releaseAfterSettlement({ ...receipt, unknownOwner: true }), /exact resource receipt/);
      assert.equal((await inspect()).protected, true);
      let retried;
      try { await held.releaseAfterSettlement(receipt); } catch (error) { retried = error; }
      assert.equal(retried.installStorageMetadataSession, held, 'the latest failed retry retains the complete exact outer capability');
      assert.equal(retried.storageSession, metadata.storageSession);
      assert.equal(Object.keys(retried).includes('installStorageMetadataSession'), false);
      deny = false;
      assert.deepEqual(await Promise.all([retried.installStorageMetadataSession.releaseAfterSettlement(receipt), held.releaseAfterSettlement(receipt)]), [true, true]);
      assert.equal(metadata.cacheOwnershipReleased(), true);
      assert.equal((await inspect()).protected, false);
    } finally { fsSync.rmSync = originalRemove; }

    let childClosed = false, innerRelease = false, calls = 0;
    const owned = Object.freeze({ resourceId: 'inert-inner-install', releaseAfterSettlement: async () => { calls++; return innerRelease; } });
    const pending = Object.freeze(Object.assign(new Error('frozen inner install owner'), { cacheOwnershipPending: true,
      cacheOwnershipReleased: () => childClosed, managedInstallSession: owned }));
    let failure;
    try { await runInstallWithStorageAdmission(input, async () => { throw pending; }); }
    catch (error) { failure = error; }
    const receipt = { resourceId: owned.resourceId, settled: true, pending: false };
    let latest;
    try { await failure.managedInstallSession.releaseAfterSettlement(receipt); } catch (error) { latest = error; }
    assert.match(latest.message, /did not confirm/);
    assert.equal(latest.managedInstallSession, failure.managedInstallSession);
    assert.equal(latest.storageSession, failure.storageSession);
    innerRelease = undefined;
    try { await latest.managedInstallSession.releaseAfterSettlement(receipt); } catch (error) { latest = error; }
    assert.match(latest.message, /did not confirm/);
    assert.equal((await inspect()).protected, true, 'false or missing inner release evidence cannot release outer admission');
    innerRelease = true;
    await assert.rejects(latest.managedInstallSession.releaseAfterSettlement(receipt), /resource observer remains pending/,
      'an inner positive cannot override the independently captured original resource observer');
    assert.equal((await inspect()).protected, true);
    childClosed = true; innerRelease = true;
    assert.equal(await latest.managedInstallSession.releaseAfterSettlement(receipt), true);
    assert.equal(calls, 4);
    assert.equal(failure.cacheOwnershipReleased(), true);
    assert.equal((await inspect()).protected, false);
  });
} finally { await rmDirRecursive(temporary); }
console.log('Installer outer admission preserves frozen causes and exact metadata recovery.');
