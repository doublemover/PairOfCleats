// Real exclusion/lease owners and injected metadata unlink failure; UNVALIDATED.
import assert from 'node:assert/strict';
import fsSync from 'node:fs';
import path from 'node:path';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { acquireRepoCacheAccessLease, repoAccessPaths, withExclusiveRepoCacheCleanup } from '../../../src/shared/cache/repo-access.js';
import { getFailedRepoCacheAccessLease } from '../../../src/shared/cache/repo-access-reader.js';
import { acquireStorageSession } from '../../../src/shared/storage/session.js';
import { inspectStorageAccess } from '../../../src/shared/storage/access.js';

const temporary = await makeTempDir('refused-lease-admission-');
const asset = path.join(temporary, 'asset');
const coordinationRoot = path.join(temporary, 'state', 'access');
const leaseDirectory = repoAccessPaths(asset, { coordinationRoot }).leases;
const remove = fsSync.rmSync;
let deny = true;
const handles = new Set();
const sessions = new Set();
try {
  fsSync.rmSync = (target, ...args) => {
    if (deny && path.dirname(String(target)) === leaseDirectory && String(target).endsWith('.json')) {
      throw Object.assign(new Error('inert refused-admission lease unlink denied'), { code: 'EACCES' });
    }
    return remove(target, ...args);
  };
  await withExclusiveRepoCacheCleanup(asset, async () => {
    let direct;
    assert.throws(() => acquireRepoCacheAccessLease(asset, { coordinationRoot,
      scope: 'fixture-refused-admission', resourceId: 'direct-refusal', requireSettlement: true }), error => {
      direct = error; return error.code === 'ERR_REPO_CACHE_CLEANUP_BUSY' && error.cacheOwnershipPending === true;
    });
    const handle = getFailedRepoCacheAccessLease(direct);
    assert.equal(handle, direct.repoCacheAccessLease);
    handles.add(handle);
    assert.equal(getFailedRepoCacheAccessLease({ repoCacheAccessLease: handle }), null,
      'copied properties cannot reconstruct actual failed-admission ownership');
    assert.equal(getFailedRepoCacheAccessLease(JSON.parse(JSON.stringify(direct))), null);
    assert.equal(direct.cause.code, 'ERR_REPO_CACHE_CLEANUP_BUSY');
    assert.equal(direct.cacheOwnershipReleased(), false);
    assert.equal((await inspectStorageAccess(asset, { coordinationRoot })).owners
      .some(owner => owner.resourceId === 'direct-refusal' && owner.protected), true);
    assert.equal(handle.release(), false);
    assert.equal(handle.released, false);
    deny = false;
    assert.equal(handle.release(), true);
    assert.equal(handle.released, true);
    assert.equal(direct.cacheOwnershipReleased(), true);
    handles.delete(handle);

    deny = true;
    let failure;
    assert.throws(() => acquireStorageSession({ roots: [asset], coordinationRoot,
      authorizedRoots: [temporary], resourceId: 'outer-partial-refusal' }), error => {
      failure = error; return error.code === 'ERR_REPO_CACHE_CLEANUP_BUSY' && error.cacheOwnershipPending === true;
    });
    const refused = failure.repoCacheAccessLease;
    const session = failure.storageSession;
    assert.ok(refused); assert.ok(session);
    handles.add(refused); sessions.add(session);
    assert.equal(session.leaseIds.length, 2, 'partial owner adopts the actual final admission that failed before returning');
    assert.ok(session.leaseIds.includes(refused.leaseId));
    assert.equal((await inspectStorageAccess(temporary, { coordinationRoot })).protected, false,
      'earlier ancestor admission still rolls back while the final refused lease remains protected');
    assert.equal(failure.cacheOwnershipReleased(), false);
    deny = false;
    assert.equal(refused.release(), true);
    handles.delete(refused);
    assert.equal(failure.cacheOwnershipReleased(), false,
      'one metadata release cannot replace the outer session rollback confirmation');
    assert.equal(session.releaseAfterSettlement({ resourceId: session.resourceId, settled: true, pending: false }), true);
    sessions.delete(session);
    assert.equal(failure.cacheOwnershipReleased(), true);
  }, { coordinationRoot });
  const admitted = acquireRepoCacheAccessLease(asset, { coordinationRoot,
    scope: 'fixture-valid-admission', resourceId: 'normal-admission', requireSettlement: true });
  handles.add(admitted);
  assert.equal(admitted.release(), true);
  handles.delete(admitted);
  assert.equal((await inspectStorageAccess(asset, { coordinationRoot })).protected, false);
} finally {
  fsSync.rmSync = remove;
  for (const session of sessions) session.releaseAfterSettlement({ resourceId: session.resourceId, settled: true, pending: false });
  for (const handle of handles) handle.release();
  await rmDirRecursive(temporary);
}
console.log('Refused cache admission retains its exact lease and outer partial session can reconcile it.');
