// Source regression authored for the development batch; UNVALIDATED.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { withTemporaryEnv } from '../../helpers/test-env.js';
import { acquireStorageWriteReservation } from '../../../src/shared/storage/admission.js';
import { inspectStorageAccess } from '../../../src/shared/storage/access.js';
import { runInstallWithStorageAdmission } from '../../../tools/tooling/install-storage.js';

const root = await makeTempDir('storage-reservation-creation-');
const originalRm = fs.rm;
const held = [];
try {
  const destination = path.join(root, 'assets');
  const coordinationRoot = path.join(root, 'state', 'storage-access');
  const lockPath = path.join(coordinationRoot, 'write-admission.lock');
  await fs.mkdir(destination);
  let failRelease = true;
  fs.rm = async (target, ...args) => {
    if (target === lockPath && failRelease) throw Object.assign(new Error('inert initial coordinator release failed'), { code: 'EACCES' });
    return originalRm(target, ...args);
  };
  let pending;
  await assert.rejects(acquireStorageWriteReservation({ root: destination, coordinationRoot, authorizedRoots: [root],
    resourceId: 'failed-acquisition-return', requiredBytes: 1,
    freeSpaceOwner: async () => ({ complete: true, availableBytes: 1024, observedPath: destination }) }), error => {
    pending = error;
    return error.reason === 'admission-lock-release-unconfirmed' && error.cacheOwnershipPending === true;
  });
  const receipt = { resourceId: 'failed-acquisition-return', settled: true, pending: false };
  held.push(() => pending.storageAdmissionSession.releaseAfterSettlement(receipt));
  assert.equal(pending.storageWriteReservations.length, 1, 'failed acquisition returns the already sealed actual owner through recovery evidence');
  const reservation = pending.storageWriteReservations[0];
  const file = path.join(coordinationRoot, 'write-reservations', reservation.reservationId + '.json');
  assert.equal((await fs.stat(file)).isFile(), true);
  assert.equal((await fs.stat(lockPath)).isFile(), true);
  assert.equal(pending.cacheOwnershipReleased(), false);
  await assert.rejects(pending.storageAdmissionSession.releaseAfterSettlement({ ...receipt, pending: undefined }),
    error => error.reason === 'resource-settlement-unconfirmed');
  await assert.rejects(pending.storageAdmissionSession.releaseAfterSettlement(receipt), { code: 'ERR_FILE_LOCK_RELEASE_FAILED' });
  assert.equal(pending.cacheOwnershipReleased(), false);
  failRelease = false;
  await pending.storageAdmissionSession.releaseAfterSettlement(receipt);
  held.pop();
  assert.equal(pending.cacheOwnershipReleased(), true);
  await assert.rejects(fs.stat(lockPath), { code: 'ENOENT' });
  await assert.rejects(fs.stat(file), { code: 'ENOENT' });

  fs.rm = originalRm;
  const home = path.join(root, 'home');
  await withTemporaryEnv({ PAIROFCLEATS_HOME: home, PAIROFCLEATS_TESTING: '1', PAIROFCLEATS_CACHE_ROOT: '' }, async () => {
    const toolingRoot = path.join(root, 'tools');
    const installCoordinator = path.join(home, 'state', 'storage-access');
    const installLock = path.join(installCoordinator, 'write-admission.lock');
    let failInstallRelease = true;
    fs.rm = async (target, ...args) => {
      if (target === installLock && failInstallRelease) throw Object.assign(new Error('inert install admission release failed'), { code: 'EACCES' });
      return originalRm(target, ...args);
    };
    let writes = 0, installation;
    await assert.rejects(runInstallWithStorageAdmission({ toolingRoot,
      storageEstimate: { complete: true, writes: [{ destination: 'artifacts', requiredBytes: 1024 }] } }, async () => { writes++; }),
    error => { installation = error; return error.cacheOwnershipPending === true && Boolean(error.installAdmissionSession); });
    const recover = () => installation.installAdmissionSession.releaseAfterClosure();
    held.push(recover);
    assert.equal(writes, 0, 'an uncertain reservation return never admits actual installation writes');
    assert.equal(installation.storageWriteReservations.length, 1, 'outer owner retains acquisition-time reservation evidence');
    assert.equal((await inspectStorageAccess(toolingRoot, { coordinationRoot: installCoordinator })).protected, true);
    await assert.rejects(recover(), { code: 'ERR_FILE_LOCK_RELEASE_FAILED' });
    failInstallRelease = false;
    await recover();
    held.pop();
    assert.equal((await inspectStorageAccess(toolingRoot, { coordinationRoot: installCoordinator })).protected, false);
    assert.equal((await fs.readdir(path.join(installCoordinator, 'write-reservations'))).length, 0);
  });
} finally {
  fs.rm = originalRm;
  for (const release of held) await release();
  await rmDirRecursive(root);
}
console.log('Sealed reservation acquisition failures retain exact coordinator and install storage recovery owners.');
