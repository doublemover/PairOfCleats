import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { acquireStorageWriteReservation } from '../../../src/shared/storage/admission.js';
import { getContainedFileSession } from '../../../src/shared/contained-file-resource.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';

// UNVALIDATED: real reservation/current-record/FileHandle/coordinator owners.
const rejected = async action => {
  let failed = false, error;
  try { await action(); } catch (value) { failed = true; error = value; }
  assert.equal(failed, true); return error;
};
const contains = (value, expected) => {
  const queue = [value], seen = new Set();
  while (queue.length) {
    const current = queue.pop(); if (current === expected) return true;
    if (current === null || !['object', 'function'].includes(typeof current) || seen.has(current)) continue;
    seen.add(current);
    if (Object.hasOwn(current, 'cause')) queue.push(current.cause);
    if (Array.isArray(current.errors)) queue.push(...current.errors);
  }
  return false;
};
const root = await makeTempDir('poc-reservation-settlement-resource-');
const originalOpen = fs.open, originalUnlink = fs.unlink, originalRemove = fs.rm;
const disposal = new Map(), outstanding = new Set();
try {
  let sequence = 0;
  const create = async () => {
    const home = path.join(root, `case-${sequence++}`), destination = path.join(home, 'assets');
    const coordinationRoot = path.join(home, 'state', 'storage-access');
    await fs.mkdir(destination, { recursive: true });
    let probes = 0;
    const reservation = await acquireStorageWriteReservation({ root: destination, coordinationRoot,
      authorizedRoots: [home], resourceId: `resource-${sequence}`, requiredBytes: 1,
      freeSpaceOwner: async () => { probes += 1; return { complete: true, availableBytes: 1024 * 1024, observedPath: destination }; } });
    outstanding.add(reservation);
    return { reservation, receipt: { resourceId: reservation.resourceId, settled: true, pending: false },
      file: path.join(coordinationRoot, 'write-reservations', `${reservation.reservationId}.json`),
      lock: path.join(coordinationRoot, 'write-admission.lock'), probes: () => probes };
  };
  const owns = (failure, reservation) => {
    assert.deepEqual(failure.storageWriteReservations, [reservation]);
    assert.equal(failure.storageAdmissionSession, reservation);
    assert.equal(Object.getOwnPropertyDescriptor(failure, 'storageWriteReservations').enumerable, false);
    assert.equal(Object.getOwnPropertyDescriptor(failure, 'storageAdmissionSession').enumerable, false);
  };
  const finished = async entry => {
    await assert.rejects(fs.lstat(entry.file), { code: 'ENOENT' });
    await assert.rejects(fs.lstat(entry.lock), { code: 'ENOENT' });
    assert.equal(entry.probes(), 1); outstanding.delete(entry.reservation);
  };

  for (const primary of [undefined, null, false, 0, '', Object.freeze(Object.assign(new Error('readonly record removal rejected'), { code: 'EORIGINAL' }))]) {
    const entry = await create(); let denyUnlink = true, denyRemove = true, unlinks = 0, removals = 0;
    const secondary = Object.freeze(new Error('exact settlement coordinator removal rejected'));
    fs.unlink = async (file, ...args) => { if (file === entry.file) { unlinks += 1; if (denyUnlink) throw primary; } return originalUnlink(file, ...args); };
    fs.rm = async (file, ...args) => { if (file === entry.lock) { removals += 1; if (denyRemove) throw secondary; } return originalRemove(file, ...args); };
    const failure = await rejected(() => entry.reservation.releaseAfterSettlement(entry.receipt));
    owns(failure, entry.reservation); assert.equal(contains(failure, primary), true); assert.equal(contains(failure, secondary), true);
    assert.equal(unlinks, 1); assert.equal(removals, 1); assert.equal(failure.cacheOwnershipReleased(), false);
    denyUnlink = false; denyRemove = false;
    assert.deepEqual(await Promise.all([entry.reservation.releaseAfterSettlement(entry.receipt),
      entry.reservation.releaseAfterSettlement(entry.receipt)]), [true, true]);
    assert.equal(unlinks, 2); assert.equal(removals, 2); assert.equal(failure.cacheOwnershipReleased(), true);
    await finished(entry); fs.unlink = originalUnlink; fs.rm = originalRemove;
  }
  for (const secondary of [undefined, null, false, 0, '']) {
    const entry = await create(); let denyUnlink = true, denyRemove = true;
    const primary = Object.freeze(Object.defineProperties(new Error('frozen original settlement failure'), {
      code: { value: 'EORIGINAL', enumerable: true }, reason: { value: 'original-removal-failure' }
    }));
    fs.unlink = async (file, ...args) => { if (file === entry.file && denyUnlink) throw primary; return originalUnlink(file, ...args); };
    fs.rm = async (file, ...args) => { if (file === entry.lock && denyRemove) throw secondary; return originalRemove(file, ...args); };
    const failure = await rejected(() => entry.reservation.releaseAfterSettlement(entry.receipt));
    assert.equal(contains(failure, primary), true); assert.equal(contains(failure, secondary), true);
    assert.equal(failure.code, 'EORIGINAL'); assert.equal(failure.reason, 'original-removal-failure');
    assert.equal(Object.getOwnPropertyDescriptor(failure, 'code').writable, false);
    assert.throws(() => { failure.code = 'REPLACED'; }, TypeError); assert.equal(primary.code, 'EORIGINAL');
    denyUnlink = false; denyRemove = false; await entry.reservation.releaseAfterSettlement(entry.receipt);
    assert.equal(failure.cacheOwnershipReleased(), true); await finished(entry);
    fs.unlink = originalUnlink; fs.rm = originalRemove;
  }

  {
    const entry = await create(); let deny = true, closes = 0, recordOpens = 0, reads = 0, unlinks = 0, removals = 0;
    const primary = Object.freeze(new Error('actual current reservation FileHandle close rejected'));
    const handles = [];
    fs.open = async (file, ...args) => {
      const actual = await originalOpen(file, ...args); if (file !== entry.file) return actual;
      recordOpens += 1; handles.push(actual); const close = actual.close, read = actual.read;
      disposal.set(actual, () => close.call(actual));
      actual.read = function (...next) { reads += 1; return read.call(actual, ...next); };
      actual.close = function () {
        closes += 1; if (deny) throw primary;
        disposal.delete(actual); return close.call(actual);
      };
      return actual;
    };
    fs.unlink = async (file, ...args) => { if (file === entry.file) unlinks += 1; return originalUnlink(file, ...args); };
    fs.rm = async (file, ...args) => { if (file === entry.lock) removals += 1; return originalRemove(file, ...args); };
    const failure = await rejected(() => entry.reservation.releaseAfterSettlement(entry.receipt));
    owns(failure, entry.reservation); const descriptor = getContainedFileSession(failure);
    assert.ok(descriptor); assert.equal(contains(failure, primary), true);
    assert.equal(recordOpens, 1); assert.equal(closes, 1); assert.equal(unlinks, 0); assert.equal(removals, 0);
    assert.equal((await fs.lstat(entry.lock)).isFile(), true);
    handles[0].close = async () => { assert.fail('actual original FileHandle close must be captured'); };
    await rejected(() => entry.reservation.releaseAfterSettlement(entry.receipt));
    assert.equal(recordOpens, 1); assert.equal(unlinks, 0); assert.equal(removals, 0);
    const previousReads = reads; deny = false; await descriptor.releaseAfterClose();
    assert.equal(closes, 2); assert.equal(reads, previousReads); assert.equal(failure.cacheOwnershipReleased(), false);
    await entry.reservation.releaseAfterSettlement(entry.receipt);
    assert.equal(recordOpens, 2, 'explicit metadata reconciliation revalidates the still-owned record once');
    assert.equal(unlinks, 1); assert.equal(removals, 1); assert.equal(failure.cacheOwnershipReleased(), true);
    await finished(entry); fs.open = originalOpen; fs.unlink = originalUnlink; fs.rm = originalRemove;
  }

  for (const marker of [undefined, false, true]) {
    const entry = await create(); let settled = false, deny = true, unlinks = 0, removals = 0;
    const primary = Object.defineProperties(new Error('original native unlink work remains pending'), {
      ...(marker === undefined ? {} : { cacheOwnershipPending: { value: marker } }),
      cacheOwnershipReleased: { value() { assert.equal(this, primary); return settled; }, writable: true }
    });
    fs.unlink = async (file, ...args) => { if (file === entry.file) { unlinks += 1; if (deny) throw primary; } return originalUnlink(file, ...args); };
    fs.rm = async (file, ...args) => { if (file === entry.lock) removals += 1; return originalRemove(file, ...args); };
    const failure = await rejected(() => entry.reservation.releaseAfterSettlement(entry.receipt));
    owns(failure, entry.reservation); assert.equal(unlinks, 1); assert.equal(removals, 0);
    assert.equal(getContainedFileSession(failure), null, 'already closed read fd cannot become invented unlink authority');
    primary.cacheOwnershipReleased = () => true; deny = false;
    await rejected(() => entry.reservation.releaseAfterSettlement(entry.receipt));
    assert.equal(unlinks, 1); assert.equal(removals, 0);
    settled = true; await entry.reservation.releaseAfterSettlement(entry.receipt);
    assert.equal(unlinks, 2); assert.equal(removals, 1); assert.equal(failure.cacheOwnershipReleased(), true);
    await finished(entry); fs.unlink = originalUnlink; fs.rm = originalRemove;
  }

  {
    const entry = await create(); let deny = true, opens = 0, unlinks = 0, removals = 0;
    fs.open = async (file, ...args) => { if (file === entry.file) opens += 1; return originalOpen(file, ...args); };
    fs.unlink = async (file, ...args) => { if (file === entry.file) unlinks += 1; return originalUnlink(file, ...args); };
    fs.rm = async (file, ...args) => { if (file === entry.lock) { removals += 1; if (deny) throw null; } return originalRemove(file, ...args); };
    const failure = await rejected(() => entry.reservation.releaseAfterSettlement(entry.receipt));
    assert.equal(failure.code, 'ERR_FILE_LOCK_RELEASE_FAILED'); assert.equal(contains(failure, null), true);
    assert.equal(opens, 1); assert.equal(unlinks, 1); assert.equal(removals, 1);
    await assert.rejects(fs.lstat(entry.file), { code: 'ENOENT' });
    deny = false; await entry.reservation.releaseAfterSettlement(entry.receipt);
    assert.equal(opens, 1); assert.equal(unlinks, 1); assert.equal(removals, 2);
    assert.equal(failure.cacheOwnershipReleased(), true); await finished(entry);
    fs.open = originalOpen; fs.unlink = originalUnlink; fs.rm = originalRemove;
  }

  {
    const entry = await create(); let settled = false, unlinks = 0, removals = 0;
    const primary = Object.assign(new Error('original receipt inspection still owns work'), {
      cacheOwnershipPending: false, cacheOwnershipReleased() { assert.equal(this, primary); return settled; }
    });
    const badReceipt = Object.defineProperty({}, 'resourceId', { get() { throw primary; } });
    const failure = await rejected(() => entry.reservation.releaseAfterSettlement(badReceipt));
    owns(failure, entry.reservation); assert.equal(contains(failure, primary), true);
    fs.unlink = async (file, ...args) => { if (file === entry.file) { unlinks += 1; await originalUnlink(file, ...args); settled = false; return; } return originalUnlink(file, ...args); };
    fs.rm = async (file, ...args) => { if (file === entry.lock) removals += 1; return originalRemove(file, ...args); };
    primary.cacheOwnershipReleased = () => true;
    await rejected(() => entry.reservation.releaseAfterSettlement(entry.receipt));
    assert.equal(unlinks, 0); assert.equal(removals, 0);
    settled = true;
    const afterUnlink = await rejected(() => entry.reservation.releaseAfterSettlement(entry.receipt));
    assert.equal(unlinks, 1); assert.equal(removals, 0); assert.equal(afterUnlink.cacheOwnershipReleased(), false);
    await assert.rejects(fs.lstat(entry.file), { code: 'ENOENT' });
    settled = true; await entry.reservation.releaseAfterSettlement(entry.receipt);
    assert.equal(unlinks, 1); assert.equal(removals, 1); assert.equal(failure.cacheOwnershipReleased(), true);
    await finished(entry); fs.unlink = originalUnlink; fs.rm = originalRemove;
  }

  for (const value of [false, true, 0, null, 'removed']) {
    const entry = await create(); let deny = true, unlinks = 0;
    fs.unlink = async (file, ...args) => { if (file === entry.file) { unlinks += 1; if (deny) return value; } return originalUnlink(file, ...args); };
    const failure = await rejected(() => entry.reservation.releaseAfterSettlement(entry.receipt));
    assert.equal(failure.reason, 'reservation-removal-unconfirmed'); assert.equal((await fs.lstat(entry.file)).isFile(), true);
    deny = false; await entry.reservation.releaseAfterSettlement(entry.receipt);
    assert.equal(unlinks, 2); assert.equal(failure.cacheOwnershipReleased(), true);
    await finished(entry); fs.unlink = originalUnlink;
  }
} finally {
  fs.open = originalOpen; fs.unlink = originalUnlink; fs.rm = originalRemove;
  for (const dispose of disposal.values()) { try { await dispose(); } catch {} }
  for (const reservation of outstanding) {
    try { await reservation.releaseAfterSettlement({ resourceId: reservation.resourceId, settled: true, pending: false }); } catch {}
  }
  await rmDirRecursive(root);
}
console.log('write-reservation-settlement-resource passed');
