import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { acquireStorageWriteReservation } from '../../../src/shared/storage/admission.js';

const temporary = await makeTempDir('poc-storage-write-admission-');
try {
  const root = path.join(temporary, 'owned-child-cache');
  const coordinationRoot = path.join(temporary, 'state', 'access');
  await fs.mkdir(root);
  await fs.writeFile(path.join(root, 'saved-unknown-report'), 'evidence');
  const evidence = await fs.readFile(path.join(root, 'saved-unknown-report'));
  const common = { root, coordinationRoot, authorizedRoots: [temporary], requiredBytes: 20, minimumFreeBytes: 10,
    freeSpaceOwner: async () => ({ complete: true, availableBytes: 50, observedPath: root }) };
  const reservation = await acquireStorageWriteReservation({ ...common, resourceId: 'first-child' });
  await assert.rejects(acquireStorageWriteReservation({ ...common, resourceId: 'second-child', requiredBytes: 30 }),
    error => error.reason === 'minimum-free-space-or-pending-reservations');
  await assert.rejects(reservation.releaseAfterSettlement({ resourceId: 'wrong-child', settled: true, pending: false }),
    error => error.reason === 'resource-settlement-unconfirmed');
  await assert.rejects(reservation.releaseAfterSettlement({ resourceId: 'first-child', settled: true, pending: true }),
    error => error.reason === 'resource-settlement-unconfirmed');
  assert.equal((await fs.readdir(path.join(coordinationRoot, 'write-reservations'))).length, 1);
  assert.deepEqual(await fs.readFile(path.join(root, 'saved-unknown-report')), evidence);
  await reservation.releaseAfterSettlement({ resourceId: 'first-child', settled: true, pending: false });
  await assert.rejects(acquireStorageWriteReservation({ ...common, resourceId: 'hard-budget', hardBytes: evidence.length + 19 }),
    error => error.reason === 'hard-logical-budget-would-be-exceeded');
  await assert.rejects(acquireStorageWriteReservation({ ...common, resourceId: 'unknown-estimate', requiredBytes: null }),
    /exact nonnegative requiredBytes/);
  await assert.rejects(acquireStorageWriteReservation({ ...common, resourceId: 'unknown-space',
    freeSpaceOwner: async () => ({ complete: false, availableBytes: null }) }), error => error.reason === 'free-space-accounting-unknown');
  await fs.writeFile(path.join(coordinationRoot, 'write-reservations', 'unknown-reference.json'), 'retained evidence');
  await assert.rejects(acquireStorageWriteReservation({ ...common, resourceId: 'unknown-owner' }),
    error => error.reason === 'unknown-or-incomplete-reservation-inventory');
  assert.deepEqual(await fs.readFile(path.join(root, 'saved-unknown-report')), evidence);
} finally { await rmDirRecursive(temporary); }
console.log('storage write admission retains pending ownership passed');
