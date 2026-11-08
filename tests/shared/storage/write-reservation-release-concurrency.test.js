// Source regression authored for the development batch; UNVALIDATED.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { acquireStorageWriteReservation } from '../../../src/shared/storage/admission.js';

const root = await makeTempDir('storage-reservation-release-');
const originalUnlink = fs.unlink;
const originalRm = fs.rm;
let allowUnlink;
let releases = [];
try {
  const destination = path.join(root, 'assets');
  const coordinationRoot = path.join(root, 'state', 'storage-access');
  await fs.mkdir(destination);
  const input = { root: destination, coordinationRoot, authorizedRoots: [root], requiredBytes: 1,
    freeSpaceOwner: async () => ({ complete: true, availableBytes: 1024, observedPath: destination }) };
  const reservation = await acquireStorageWriteReservation({ ...input, resourceId: 'concurrent-release' });
  const file = path.join(coordinationRoot, 'write-reservations', reservation.reservationId + '.json');
  const receipt = { resourceId: reservation.resourceId, settled: true, pending: false };
  let entered;
  const unlinkStarted = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { allowUnlink = resolve; });
  let unlinks = 0;
  fs.unlink = async target => {
    if (target === file) { unlinks++; entered(); await gate; }
    return originalUnlink(target);
  };
  releases = [reservation.releaseAfterSettlement(receipt)];
  await unlinkStarted;
  releases.push(reservation.releaseAfterSettlement(receipt));
  allowUnlink();
  assert.deepEqual(await Promise.all(releases), [true, true]);
  assert.equal(unlinks, 1, 'duplicate settled callers share the one actual removal and coordinator release');
  fs.unlink = originalUnlink;

  const retry = await acquireStorageWriteReservation({ ...input, resourceId: 'failed-lock-release' });
  const retryFile = path.join(coordinationRoot, 'write-reservations', retry.reservationId + '.json');
  const lockPath = path.join(coordinationRoot, 'write-admission.lock');
  let failRelease = true;
  fs.rm = async (target, ...args) => {
    if (target === lockPath && failRelease) { failRelease = false; throw Object.assign(new Error('inert coordinator release denied'), { code: 'EACCES' }); }
    return originalRm(target, ...args);
  };
  const retryReceipt = { resourceId: retry.resourceId, settled: true, pending: false };
  await assert.rejects(retry.releaseAfterSettlement(retryReceipt), error => error.code === 'ERR_FILE_LOCK_RELEASE_FAILED' && error.cacheOwnershipPending === true);
  await assert.rejects(fs.stat(retryFile), { code: 'ENOENT' });
  assert.equal((await fs.stat(lockPath)).isFile(), true);
  assert.equal(await retry.releaseAfterSettlement(retryReceipt), true, 'retry settles the retained exact lock after reservation removal');
  await assert.rejects(fs.stat(lockPath), { code: 'ENOENT' });
  assert.equal(await retry.releaseAfterSettlement(retryReceipt), true);
  const next = await acquireStorageWriteReservation({ ...input, resourceId: 'next-writer' });
  await next.releaseAfterSettlement({ resourceId: next.resourceId, settled: true, pending: false });
} finally {
  allowUnlink?.();
  await Promise.allSettled(releases);
  fs.unlink = originalUnlink; fs.rm = originalRm;
  await rmDirRecursive(root);
}
console.log('Storage reservation releases coalesce and retain failed coordinator release for retry.');
