import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { acquireStorageWriteReservation } from '../../../src/shared/storage/admission.js';
import { acquireFileLock, releaseFileLockOrThrow } from '../../../src/shared/locks/file-lock.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
const { dir } = await prepareIsolatedTestCacheDir('write-settlement-contention');
const root = path.join(dir, 'payload'), coordinationRoot = path.join(dir, 'coordination');
const lockPath = path.join(coordinationRoot, 'write-admission.lock');
const open = fs.open, attempted = Promise.withResolvers();
let held = null, result;
try {
  await fs.mkdir(root);
  await fs.writeFile(path.join(root, 'sentinel'), 'unchanged original evidence');
  const reservation = await acquireStorageWriteReservation({ root, coordinationRoot, authorizedRoots: [dir],
    resourceId: 'original-writer', requiredBytes: 20, minimumFreeBytes: 0,
    freeSpaceOwner: async () => ({ complete: true, availableBytes: 100, observedPath: root }) });
  const record = path.join(coordinationRoot, 'write-reservations', `${reservation.reservationId}.json`);
  const before = await fs.readFile(record);
  held = await acquireFileLock({ lockPath, waitMs: 0 });
  assert.ok(held);
  fs.open = async (file, flags, ...args) => {
    if (path.resolve(String(file)) === lockPath && flags === 'wx') attempted.resolve();
    return open.call(fs, file, flags, ...args);
  };
  let outcome = null;
  result = reservation.releaseAfterSettlement({ resourceId: 'original-writer', settled: true, pending: false })
    .then(value => { outcome = 'fulfilled'; return value; }, error => { outcome = 'rejected'; throw error; });
  result.catch(() => {});
  await attempted.promise;
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(outcome, null, 'original release joins transient contention instead of failing or claiming early settlement');
  assert.deepEqual(await fs.readFile(record), before, 'pending release preserves the original reservation');
  await releaseFileLockOrThrow(held); held = null;
  assert.equal(await result, true);
  assert.equal(outcome, 'fulfilled');
  await assert.rejects(fs.access(record), { code: 'ENOENT' });
  assert.equal(await fs.readFile(path.join(root, 'sentinel'), 'utf8'), 'unchanged original evidence');
} finally {
  fs.open = open;
  if (held) await releaseFileLockOrThrow(held);
  await Promise.allSettled(result ? [result] : []);
  await fs.rm(dir, { recursive: true, force: true });
}
console.log('Original storage reservation waits for bounded metadata contention before exact settlement.');
