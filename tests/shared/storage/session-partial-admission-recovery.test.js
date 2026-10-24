// Actual disposable lease admission/rollback controls; source-only, UNVALIDATED.
import assert from 'node:assert/strict';
import fsSync from 'node:fs';
import path from 'node:path';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { acquireStorageSession } from '../../../src/shared/storage/session.js';
import { inspectStorageAccess } from '../../../src/shared/storage/access.js';
import { repoAccessPaths, withExclusiveRepoCacheCleanup } from '../../../src/shared/cache/repo-access.js';

const temporary = await makeTempDir('storage-partial-admission-');
const roots = ['a-first', 'b-later', 'z-denied'].map(name => path.join(temporary, name));
const coordinationRoot = path.join(temporary, 'state', 'access');
const input = { roots, coordinationRoot, authorizedRoots: [temporary], resourceId: 'exact-partial-session' };
const originalRm = fsSync.rmSync;
let retained;
let denyRemoval = true;
let failures = 0;
try {
  const failedLeaseDirectory = repoAccessPaths(roots[0], { coordinationRoot }).leases;
  fsSync.rmSync = (target, ...args) => {
    if (denyRemoval && path.dirname(String(target)) === failedLeaseDirectory && String(target).endsWith('.json')) {
      failures++;
      throw Object.assign(new Error('inert exact lease removal denied'), { code: 'EACCES' });
    }
    return originalRm(target, ...args);
  };
  await withExclusiveRepoCacheCleanup(roots[2], async () => {
    let failure;
    assert.throws(() => acquireStorageSession(input), error => {
      failure = error;
      return error.code === 'ERR_REPO_CACHE_CLEANUP_BUSY' && error.cacheOwnershipPending === true;
    });
    retained = failure.storageSession;
    assert.ok(retained);
    assert.equal(retained.resourceId, input.resourceId);
    assert.equal(retained.leaseIds.length, 3, 'parent and both earlier asset admissions remain represented by their exact handles');
    assert.ok(failures > 0);
    assert.equal(failure.cacheOwnershipReleased(), false);
    assert.equal((await inspectStorageAccess(roots[0], { coordinationRoot })).protected, true);
    assert.equal((await inspectStorageAccess(roots[1], { coordinationRoot })).protected, false,
      'failed rollback of an earlier lease cannot prevent later admitted cleanup');
    assert.equal((await inspectStorageAccess(temporary, { coordinationRoot })).protected, false);
    assert.throws(() => retained.releaseAfterSettlement({ resourceId: input.resourceId, settled: true }),
      { code: 'ERR_STORAGE_SESSION_PENDING' });
    assert.throws(() => retained.releaseAfterSettlement({ resourceId: 'other-owner', settled: true, pending: false }),
      { code: 'ERR_STORAGE_SESSION_PENDING' });
    assert.throws(() => retained.releaseAfterSettlement({ resourceId: input.resourceId, settled: true, pending: false }),
      { code: 'ERR_STORAGE_SESSION_LEASE_CHANGED' }, 'actual repeated release failure stays pending');
    denyRemoval = false;
    retained.releaseAfterSettlement({ resourceId: input.resourceId, settled: true, pending: false });
    assert.equal(failure.cacheOwnershipReleased(), true, 'only exact successful partial-owner reconciliation confirms rollback');
    assert.equal((await inspectStorageAccess(roots[0], { coordinationRoot })).protected, false);
    retained = null;
  }, { coordinationRoot });
  const next = acquireStorageSession({ ...input, resourceId: 'next-complete-admission' });
  next.releaseAfterSettlement({ resourceId: next.resourceId, settled: true, pending: false });
  assert.equal((await inspectStorageAccess(temporary, { coordinationRoot })).protected, false);
} finally {
  fsSync.rmSync = originalRm;
  retained?.releaseAfterSettlement({ resourceId: retained.resourceId, settled: true, pending: false });
  await rmDirRecursive(temporary);
}
console.log('Partial storage admission retains failed exact rollback owners and attempts remaining cleanup.');
