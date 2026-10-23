import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { acquireStorageWriteReservation } from '../../../src/shared/storage/admission.js';
import { getStorageDirectorySession } from '../../../src/shared/storage/directory.js';
import { getContainedFileSession } from '../../../src/shared/contained-file-resource.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';

// UNVALIDATED: actual reservation, Dir, FileHandle and coordinator owners only.
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
const root = await makeTempDir('poc-write-admission-inventory-');
const originalDirectory = fs.opendir, originalOpen = fs.open, originalRemove = fs.rm;
const disposal = new Map();
let seed;
try {
  const destination = path.join(root, 'assets'), coordinationRoot = path.join(root, 'state', 'storage-access');
  const inventory = path.join(coordinationRoot, 'write-reservations'), lockPath = path.join(coordinationRoot, 'write-admission.lock');
  await fs.mkdir(destination);
  let sequence = 0, freeCalls = 0, removals = 0, denyRemoval = false, removalError;
  const free = async () => { freeCalls += 1; return { complete: true, availableBytes: 1024 * 1024, observedPath: destination }; };
  const acquire = (freeSpaceOwner = free) => acquireStorageWriteReservation({ root: destination, coordinationRoot,
    authorizedRoots: [root], resourceId: `inventory-resource-${sequence++}`, requiredBytes: 1, freeSpaceOwner });
  seed = await acquire();
  const seedFile = path.join(inventory, `${seed.reservationId}.json`), seedBytes = await fs.readFile(seedFile);
  fs.rm = async (file, ...args) => {
    if (file === lockPath) { removals += 1; if (denyRemoval) throw removalError; }
    return originalRemove(file, ...args);
  };
  const reset = () => { freeCalls = 0; removals = 0; denyRemoval = false; fs.opendir = originalDirectory; fs.open = originalOpen; };
  const installDirectory = ({ read = null, close = null } = {}) => {
    const states = [];
    fs.opendir = async (file, ...args) => {
      const actual = await originalDirectory(file, ...args);
      if (file !== inventory) return actual;
      const originalRead = actual.read, originalClose = actual.close;
      const state = { actual, reads: 0, closes: 0 }; states.push(state);
      disposal.set(actual, () => originalClose.call(actual));
      actual.read = function () {
        assert.equal(this, actual); state.reads += 1;
        return read ? read(state, () => originalRead.call(actual)) : originalRead.call(actual);
      };
      actual.close = function () {
        assert.equal(this, actual); state.closes += 1;
        const native = async () => { const result = await originalClose.call(actual); disposal.delete(actual); return result; };
        return close ? close(state, native) : native();
      };
      return actual;
    };
    return states;
  };
  const recoverAdmission = async failure => {
    assert.equal(failure.reason, 'admission-lock-release-unconfirmed');
    assert.equal(Object.getOwnPropertyDescriptor(failure, 'storageAdmissionSession').enumerable, false);
    assert.equal(Object.getOwnPropertyDescriptor(failure, 'storageWriteReservations').enumerable, false);
    assert.deepEqual(failure.storageWriteReservations, []);
    const session = failure.storageAdmissionSession;
    const receipt = { resourceId: session.resourceId, settled: true, pending: false };
    await rejected(() => session.releaseAfterSettlement({ ...receipt, resourceId: 'different-resource' }));
    await rejected(() => session.releaseAfterSettlement({ ...receipt, pending: undefined }));
    await session.releaseAfterSettlement(receipt);
    assert.equal(failure.cacheOwnershipReleased(), true);
    await assert.rejects(fs.lstat(lockPath), { code: 'ENOENT' });
    assert.deepEqual(await fs.readFile(seedFile), seedBytes);
    assert.deepEqual(await fs.readdir(inventory), [path.basename(seedFile)]);
  };

  for (const marker of [undefined, false, true]) {
    reset(); let settled = false, replacements = 0;
    const primary = Object.defineProperties(new Error('original inventory read owns native work'), {
      ...(marker === undefined ? {} : { cacheOwnershipPending: { value: marker } }),
      cacheOwnershipReleased: { value() { assert.equal(this, primary); return settled; }, writable: true }
    });
    const states = installDirectory({ read: () => { throw primary; } });
    const failure = await rejected(() => acquire()), directory = getStorageDirectorySession(failure);
    assert.ok(directory); assert.equal(contains(failure, primary), true);
    assert.equal(states[0].closes, 0); assert.equal(removals, 0); assert.equal(freeCalls, 0);
    primary.cacheOwnershipReleased = () => true;
    states[0].actual.close = async () => { replacements += 1; };
    const receipt = { resourceId: failure.storageAdmissionSession.resourceId, settled: true, pending: false };
    await rejected(() => failure.storageAdmissionSession.releaseAfterSettlement(receipt));
    await rejected(() => directory.releaseAfterClose());
    assert.equal(states[0].closes, 0); assert.equal(removals, 0); assert.equal(failure.cacheOwnershipReleased(), false);
    settled = true; await directory.releaseAfterClose();
    assert.equal(states[0].closes, 1); assert.equal(replacements, 0); assert.equal(removals, 0);
    await recoverAdmission(failure); assert.equal(removals, 1); assert.equal(freeCalls, 0);
  }

  for (const primary of [undefined, null, false, 0, '', Object.freeze(new Error('original inventory read rejected'))]) {
    reset(); let denyClose = true;
    const secondary = Object.freeze(new Error('original directory close rejected independently'));
    const states = installDirectory({ read: () => { throw primary; },
      close: (_state, native) => { if (denyClose) throw secondary; return native(); } });
    const failure = await rejected(() => acquire()), directory = getStorageDirectorySession(failure);
    assert.ok(directory); assert.equal(contains(failure, primary), true); assert.equal(contains(failure, secondary), true);
    assert.equal(states[0].closes, 1); assert.equal(removals, 0); assert.equal(freeCalls, 0);
    denyClose = false; await directory.releaseAfterClose();
    assert.equal(states[0].closes, 2); assert.equal(states[0].reads, 1);
    await recoverAdmission(failure); assert.equal(removals, 1);
  }

  for (const secondary of [undefined, null, false, 0, '', Object.freeze(new Error('successful inventory final close rejected'))]) {
    reset(); let denyClose = true;
    const states = installDirectory({ close: (_state, native) => { if (denyClose) throw secondary; return native(); } });
    const failure = await rejected(() => acquire()), directory = getStorageDirectorySession(failure);
    assert.ok(directory); assert.equal(contains(failure, secondary), true);
    const reads = states[0].reads;
    assert.equal(states[0].closes, 1); assert.equal(removals, 0); assert.equal(freeCalls, 0);
    denyClose = false; await directory.releaseAfterClose();
    await recoverAdmission(failure); assert.equal(states[0].reads, reads); assert.equal(removals, 1);
  }

  for (const marker of [undefined, false, true]) {
    reset(); let settled = false, codeReads = 0;
    const primary = Object.defineProperties(new Error('opendir has unconfirmed original work'), {
      ...(marker === undefined ? {} : { cacheOwnershipPending: { value: marker } }),
      cacheOwnershipReleased: { value() { assert.equal(this, primary); return settled; }, writable: true },
      code: { get() { codeReads += 1; return 'ENOENT'; } }
    });
    fs.opendir = async (file, ...args) => { if (file === inventory) throw primary; return originalDirectory(file, ...args); };
    const failure = await rejected(() => acquire());
    assert.equal(getStorageDirectorySession(failure), null);
    assert.equal(codeReads, 0); assert.equal(freeCalls, 0); assert.equal(removals, 0);
    primary.cacheOwnershipReleased = () => true;
    const receipt = { resourceId: failure.storageAdmissionSession.resourceId, settled: true, pending: false };
    await rejected(() => failure.storageAdmissionSession.releaseAfterSettlement(receipt));
    assert.equal(removals, 0); settled = true;
    await recoverAdmission(failure); assert.equal(codeReads, 0); assert.equal(removals, 1);
  }

  reset();
  let inspectionSettled = false;
  const inspection = Object.assign(new Error('independent reservation diagnostic remains pending'), {
    cacheOwnershipPending: false,
    cacheOwnershipReleased() { assert.equal(this, inspection); return inspectionSettled; }
  });
  const readonly = Object.freeze(Object.defineProperty(new Error('readonly initial directory error'), 'code', {
    get() { throw inspection; }
  }));
  fs.opendir = async (file, ...args) => { if (file === inventory) throw readonly; return originalDirectory(file, ...args); };
  const inspected = await rejected(() => acquire());
  assert.equal(contains(inspected, readonly), true); assert.equal(contains(inspected, inspection), true);
  assert.equal(removals, 0); inspection.cacheOwnershipReleased = () => true;
  await rejected(() => inspected.storageAdmissionSession.releaseAfterSettlement({
    resourceId: inspected.storageAdmissionSession.resourceId, settled: true, pending: false }));
  inspectionSettled = true; await recoverAdmission(inspected); assert.equal(removals, 1);

  for (const marker of [undefined, false, true]) {
    reset(); let settled = false;
    const primary = Object.defineProperties(new Error('free-space owner still has original work'), {
      ...(marker === undefined ? {} : { cacheOwnershipPending: { value: marker } }),
      cacheOwnershipReleased: { value() { assert.equal(this, primary); return settled; }, writable: true }
    });
    const states = installDirectory();
    const failure = await rejected(() => acquire(async () => { freeCalls += 1; throw primary; }));
    assert.equal(states[0].closes, 1); assert.equal(removals, 0); assert.equal(freeCalls, 1);
    primary.cacheOwnershipReleased = () => true;
    await rejected(() => failure.storageAdmissionSession.releaseAfterSettlement({
      resourceId: failure.storageAdmissionSession.resourceId, settled: true, pending: false }));
    settled = true; await recoverAdmission(failure); assert.equal(removals, 1); assert.equal(freeCalls, 1);
  }

  for (const primary of [undefined, null, false, 0, '', Object.freeze(new Error('readonly free-space observation rejected'))]) {
    reset(); denyRemoval = true; removalError = Object.freeze(new Error('exact admission coordinator removal rejected'));
    const failure = await rejected(() => acquire(async () => { freeCalls += 1; throw primary; }));
    assert.equal(contains(failure, primary), true); assert.equal(contains(failure, removalError), true);
    assert.equal(removals, 1); denyRemoval = false;
    await recoverAdmission(failure); assert.equal(removals, 2); assert.equal(freeCalls, 1);
  }

  for (const cleanup of [undefined, null, false, 0, '']) {
    reset(); denyRemoval = true; removalError = cleanup;
    const primary = Object.freeze(Object.assign(new Error('original readonly accounting failure'), { code: 'EORIGINAL' }));
    const failure = await rejected(() => acquire(async () => { freeCalls += 1; throw primary; }));
    assert.equal(contains(failure, primary), true); assert.equal(contains(failure, cleanup), true);
    assert.equal(primary.code, 'EORIGINAL'); assert.equal(removals, 1); denyRemoval = false;
    await recoverAdmission(failure); assert.equal(removals, 2); assert.equal(freeCalls, 1);
  }

  {
    reset(); let settled = false, fakeCalls = 0;
    const fake = Object.freeze({ resourceId: 'invented-resource', isSettled: () => true,
      releaseAfterClose: async () => { fakeCalls += 1; return { settled: true, pending: false }; } });
    const primary = Object.assign(new Error('counterfeit resource fields do not authorize reconciliation'), {
      containedFileSession: fake, storageDirectorySession: fake, cacheOwnershipPending: false,
      cacheOwnershipReleased() { return settled; }
    });
    const failure = await rejected(() => acquire(async () => { throw primary; }));
    assert.equal(getStorageDirectorySession(failure), null); assert.equal(getContainedFileSession(failure), null);
    assert.equal(Object.hasOwn(failure, 'containedFileSession'), false);
    assert.equal(Object.hasOwn(failure, 'storageDirectorySession'), false);
    assert.equal(fakeCalls, 0); assert.equal(removals, 0);
    settled = true; await recoverAdmission(failure); assert.equal(fakeCalls, 0); assert.equal(removals, 1);
  }

  {
    reset(); let denyClose = true, fileCloses = 0, fileReads = 0;
    const secondary = Object.freeze(new Error('actual canonical reservation FileHandle close rejected'));
    fs.open = async (file, ...args) => {
      const actual = await originalOpen(file, ...args); if (file !== seedFile) return actual;
      const close = actual.close, read = actual.read;
      disposal.set(actual, () => close.call(actual));
      actual.read = function (...next) { fileReads += 1; return read.call(actual, ...next); };
      actual.close = function () {
        fileCloses += 1; if (denyClose) throw secondary;
        disposal.delete(actual); return close.call(actual);
      };
      return actual;
    };
    const states = installDirectory();
    const failure = await rejected(() => acquire());
    const fileSession = getContainedFileSession(failure), directory = getStorageDirectorySession(failure);
    assert.ok(fileSession); assert.ok(directory); assert.equal(contains(failure, secondary), true);
    assert.equal(fileCloses, 1); assert.equal(states[0].closes, 0); assert.equal(removals, 0); assert.equal(freeCalls, 0);
    await rejected(() => directory.releaseAfterClose()); assert.equal(states[0].closes, 0);
    const reads = fileReads;
    denyClose = false; await fileSession.releaseAfterClose(); await directory.releaseAfterClose();
    await recoverAdmission(failure);
    assert.equal(fileCloses, 2); assert.equal(states[0].closes, 1); assert.equal(fileReads, reads); assert.equal(removals, 1);
  }

  reset();
  const primary = Object.freeze(new Error('ordinary settled free-space failure'));
  const ordinary = await rejected(() => acquire(async () => { throw primary; }));
  assert.equal(ordinary, primary); assert.equal(ordinary.storageAdmissionSession, undefined); assert.equal(removals, 1);
  reset();
  const denied = await rejected(() => acquire(async () => ({ complete: true, availableBytes: 0, observedPath: destination })));
  assert.equal(denied.reason, 'minimum-free-space-or-pending-reservations');
  assert.equal(denied.cacheOwnershipPending, undefined); assert.equal(denied.storageAdmissionSession, undefined);
  assert.equal(removals, 1);
  reset();
  const next = await acquire();
  assert.equal(next.admission, 'admitted-declared-write-estimate');
  await next.releaseAfterSettlement({ resourceId: next.resourceId, settled: true, pending: false });
  assert.deepEqual(await fs.readFile(seedFile), seedBytes);
} finally {
  fs.opendir = originalDirectory; fs.open = originalOpen; fs.rm = originalRemove;
  for (const dispose of disposal.values()) { try { await dispose(); } catch {} }
  if (seed) await seed.releaseAfterSettlement({ resourceId: seed.resourceId, settled: true, pending: false });
  await rmDirRecursive(root);
}
console.log('write-admission-inventory-resource passed');
