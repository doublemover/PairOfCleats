import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { acquireStorageWriteReservation } from '../../../src/shared/storage/admission.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { errorGraphIncludes } from '../../helpers/error-graph.js';

const mode = process.env.PAIROFCLEATS_TEST_ID?.split('shared/storage/write-reservation-receipt-observation/')[1];
assert.ok(['original-before-fields', 'revoked-resource-id', 'pending-field-value', 'independent-callback-inspection',
  'revoked-after-record-close', 'guarded-positive-and-invalid'].includes(mode));
const temporary = await makeTempDir('poc-reservation-receipt-'), destination = path.join(temporary, 'assets'), coordinationRoot = path.join(temporary, 'state', 'storage-access');
await fs.mkdir(destination, { recursive: true });
const open = fs.open, unlink = fs.unlink;
let ready = true, independentReady = false, unlinks = 0, reads = 0, intercepted = false, original, reservation;
try {
  reservation = await acquireStorageWriteReservation({ root: destination, coordinationRoot, authorizedRoots: [temporary],
    resourceId: 'original-receipt-resource', requiredBytes: 1,
    freeSpaceOwner: async () => ({ complete: true, availableBytes: 1024 * 1024, observedPath: destination }) });
  const file = path.join(coordinationRoot, 'write-reservations', reservation.reservationId + '.json'), lock = path.join(coordinationRoot, 'write-admission.lock');
  const receipt = { resourceId: reservation.resourceId, settled: true, pending: false };
  fs.unlink = async (filename, ...args) => { if (filename === file) unlinks++; return unlink(filename, ...args); };
  const independent = Object.freeze(Object.assign(new Error('original receipt callback inspection'), {
    cacheOwnershipPending: true, cacheOwnershipReleased: () => independentReady
  }));
  if (mode === 'original-before-fields') {
    ready = false;
    original = Object.defineProperties({}, { cacheOwnershipPending: { value: true }, cacheOwnershipReleased: { value: () => ready },
      ...Object.fromEntries(Object.entries(receipt).map(([key, value]) => [key, { get() { reads++; ready = true; return value; } }])) });
  } else if (mode === 'revoked-resource-id') {
    original = { ...receipt, cacheOwnershipReleased: () => ready };
    Object.defineProperties(original, { resourceId: { get() { reads++; ready = false; return receipt.resourceId; } },
      settled: { get() { reads++; ready = true; return true; } } });
  } else if (mode === 'pending-field-value') {
    ready = false;
    original = Object.freeze({ cacheOwnershipPending: true, cacheOwnershipReleased: () => ready });
    original = Object.freeze({ resourceId: original, get settled() { reads++; ready = true; return true; }, pending: false });
  } else if (mode === 'independent-callback-inspection') {
    original = Object.freeze({ ...receipt, cacheOwnershipReleased() { if (!intercepted) { intercepted = true; throw independent; } return true; },
      get message() { reads++; throw new Error('pending receipt diagnostics must not execute'); } });
  } else {
    original = Object.freeze({ ...receipt, cacheOwnershipReleased: () => ready });
    if (mode === 'revoked-after-record-close') fs.open = async (filename, ...args) => {
      const handle = await open(filename, ...args);
      if (filename === file && !intercepted) {
        intercepted = true; const close = handle.close;
        handle.close = async function () { assert.equal(this, handle); const result = await close.call(handle); ready = false; return result; };
      }
      return handle;
    };
  }
  if (mode === 'guarded-positive-and-invalid') {
    for (const invalid of [{ ...receipt, resourceId: 'another-owner' }, { ...receipt, settled: false }, { ...receipt, pending: true }]) {
      await assert.rejects(reservation.releaseAfterSettlement(invalid)); assert.equal(unlinks, 0);
    }
    assert.deepEqual(await Promise.all([reservation.releaseAfterSettlement(original), reservation.releaseAfterSettlement(original)]), [true, true]);
    assert.equal(unlinks, 1); assert.equal(await reservation.releaseAfterSettlement(receipt), true); assert.equal(unlinks, 1);
  } else {
    let failure;
    try { await reservation.releaseAfterSettlement(original); } catch (error) { failure = error; }
    assert.ok(failure); assert.equal(unlinks, 0); assert.equal(reads, mode === 'revoked-resource-id' ? 1 : 0);
    assert.equal(errorGraphIncludes(failure, original), true);
    if (mode === 'independent-callback-inspection') assert.equal(errorGraphIncludes(failure, independent), true);
    assert.equal(failure.storageAdmissionSession, reservation); assert.equal((await fs.stat(file)).isFile(), true);
    // Neither a later plain receipt nor replacement of the original callback
    // erases the captured original or its independent inspection prerequisite.
    if (mode === 'revoked-resource-id') original.cacheOwnershipReleased = () => true;
    await assert.rejects(reservation.releaseAfterSettlement(receipt)); assert.equal(unlinks, 0);
    ready = true;
    if (mode === 'independent-callback-inspection') {
      await assert.rejects(reservation.releaseAfterSettlement(receipt)); assert.equal(unlinks, 0); independentReady = true;
    }
    assert.deepEqual(await Promise.all([reservation.releaseAfterSettlement(receipt), reservation.releaseAfterSettlement(receipt)]), [true, true]);
    assert.equal(unlinks, 1); assert.equal(failure.cacheOwnershipReleased(), true);
  }
  await assert.rejects(fs.stat(file), { code: 'ENOENT' }); await assert.rejects(fs.stat(lock), { code: 'ENOENT' });
} finally {
  ready = true; independentReady = true; fs.open = open; fs.unlink = unlink;
  if (reservation) await reservation.releaseAfterSettlement({ resourceId: reservation.resourceId, settled: true, pending: false });
  await rmDirRecursive(temporary, { retries: 0 });
}
console.log('Original settlement receipt/field/inspection observations guard actual reservation reads, unlink and coordinator retirement.');
