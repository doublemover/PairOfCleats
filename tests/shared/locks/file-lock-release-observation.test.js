import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { acquireFileLock, releaseFileLockOrThrow } from '../../../src/shared/locks/file-lock.js';
import { readStorageFailureContext } from '../../../src/shared/storage/operation-error.js';
import { acquireStorageWriteReservation } from '../../../src/shared/storage/admission.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';

// UNVALIDATED: actual lock/reservation consumers and inert diagnostic seams.
const root = await makeTempDir('poc-lock-release-observation-'), remove = fs.rm, unlink = fs.unlink, open = fs.open;
const rejected = async action => {
  let failed = false, failure;
  try { await action(); } catch (value) { failed = true; failure = value; }
  assert.equal(failed, true); return failure;
};
const contains = (value, expected) => {
  const queue = [value], seen = new Set();
  while (queue.length) {
    const current = queue.pop(); if (current === expected) return true;
    if (current === null || !['object', 'function'].includes(typeof current) || seen.has(current)) continue;
    seen.add(current);
    const cause = Object.getOwnPropertyDescriptor(current, 'cause'), errors = Object.getOwnPropertyDescriptor(current, 'errors');
    if (cause && 'value' in cause) queue.push(cause.value);
    if (Array.isArray(errors?.value)) queue.push(...errors.value);
  }
  return false;
};
const inspected = (failure, expected) => readStorageFailureContext(failure).inspectionErrors.some(error => contains(error, expected));
try {
  let sequence = 0;
  for (const marker of [undefined, false, true]) {
    const file = path.join(root, `actual-${sequence++}.lock`), owner = await acquireFileLock({ lockPath: file });
    let ready = false, deny = true, removals = 0, codes = 0;
    const primary = new Error('original native metadata removal remains pending');
    if (marker !== undefined) primary.cacheOwnershipPending = marker;
    primary.cacheOwnershipReleased = function () { assert.equal(this, primary); return ready; };
    Object.defineProperty(primary, 'code', { get() {
      codes += 1; primary.cacheOwnershipReleased = () => true; return 'ENATIVE';
    } });
    fs.rm = async (target, options) => {
      if (target === file) { removals += 1; if (deny) throw primary; } return remove(target, options);
    };
    const failure = await rejected(() => releaseFileLockOrThrow(owner));
    assert.equal(failure.code, 'ERR_FILE_LOCK_RELEASE_FAILED'); assert.equal(failure.cause, primary);
    assert.equal(failure.causeCode, 'ENATIVE'); assert.equal(codes, 1); assert.equal(removals, 1);
    assert.equal(failure.cacheOwnershipReleased(), false); assert.equal((await fs.lstat(file)).isFile(), true);
    assert.throws(() => { failure.cacheOwnershipReleased = () => true; }, TypeError);
    ready = true; assert.equal(failure.cacheOwnershipReleased(), true,
      'this observation confirms only independent native work, not metadata removal');
    assert.equal((await fs.lstat(file)).isFile(), true);
    deny = false; assert.equal(await releaseFileLockOrThrow(owner), true); assert.equal(removals, 2);
    fs.rm = remove;
  }

  // Diagnostic rejection cannot replace the original release cause, including
  // falsey/frozen throws. It is preserved in actual bounded context history.
  for (const secondary of [undefined, null, false, 0, '', Object.freeze(new Error('frozen diagnostic rejection'))]) {
    let codes = 0, paths = 0, calls = 0;
    const primary = Object.freeze(Object.defineProperty(new Error('original release rejected'), 'code', {
      get() { codes += 1; throw secondary; }
    }));
    const lock = { get lockPath() { paths += 1; throw secondary; }, release() { calls += 1; throw primary; } };
    const failure = await rejected(() => releaseFileLockOrThrow(lock, { workerError: undefined }));
    assert.equal(failure.cause, primary); assert.equal(failure.workerError, undefined);
    assert.equal(failure.code, 'ERR_FILE_LOCK_RELEASE_FAILED'); assert.equal(failure.lockPath, '<unknown-lock>');
    assert.equal(inspected(failure, secondary) || contains(failure, secondary), true);
    assert.equal(codes, 1); assert.equal(paths, 1); assert.equal(calls, 1);
  }
  {
    let ready = false, reads = 0;
    const secondary = Object.freeze(Object.assign(new Error('diagnostic native owner'), {
      cacheOwnershipReleased() { assert.equal(this, secondary); return ready; }
    }));
    const primary = Object.freeze(Object.defineProperty(new Error('frozen primary'), 'code', {
      get() { reads += 1; throw secondary; }
    }));
    const failure = await rejected(() => releaseFileLockOrThrow({ release() { throw primary; } }));
    assert.equal(failure.cause, primary); assert.equal(failure.cacheOwnershipReleased(), false);
    ready = true; assert.equal(failure.cacheOwnershipReleased(), true); assert.equal(reads, 1);
  }
  {
    let primaryReady = false, secondaryReady = false;
    const secondary = Object.freeze(Object.assign(new Error('observer rejection owns native work'), {
      cacheOwnershipReleased() { assert.equal(this, secondary); return secondaryReady; }
    }));
    const primary = Object.assign(new Error('release owner'), {
      cacheOwnershipReleased() { assert.equal(this, primary); if (!primaryReady) throw secondary; return true; }
    });
    const failure = await rejected(() => releaseFileLockOrThrow({ release() { throw primary; } }));
    primary.cacheOwnershipReleased = () => true;
    assert.equal(failure.cacheOwnershipReleased(), false); assert.equal(inspected(failure, secondary), true);
    primaryReady = true; assert.equal(failure.cacheOwnershipReleased(), false);
    secondaryReady = true; assert.equal(failure.cacheOwnershipReleased(), true);
  }
  {
    let ready = false;
    const secondary = Object.freeze(Object.assign(new Error('unreadable owner secondary'), {
      cacheOwnershipReleased() { return ready; }
    }));
    const primary = Object.freeze(Object.defineProperty(new Error('unknown original owner'), 'cacheOwnershipReleased', {
      get() { throw secondary; }
    }));
    const failure = await rejected(() => releaseFileLockOrThrow({ release() { throw primary; } }));
    ready = true; assert.equal(failure.cacheOwnershipReleased(), false, 'unreadable originals remain unknown');
    assert.equal(inspected(failure, secondary), true);
  }
  {
    let ready = false, paths = 0;
    const worker = Object.freeze(Object.assign(new Error('independent worker owner'), {
      cacheOwnershipReleased() { assert.equal(this, worker); return ready; }
    }));
    const failure = await rejected(() => releaseFileLockOrThrow({
      get lockPath() { paths += 1; return 'inert'; }, release() { return false; }
    }, { workerError: worker }));
    assert.equal(Object.hasOwn(failure, 'cause'), false); assert.equal(failure.workerError, worker);
    assert.equal(failure.releaseResult, false); assert.equal(failure.cacheOwnershipReleased(), false); assert.equal(paths, 1);
    ready = true; assert.equal(failure.cacheOwnershipReleased(), true);
  }
  for (const value of [undefined, null, false, 0, '']) {
    const failure = await rejected(() => releaseFileLockOrThrow({ release() { throw value; } }, { workerError: value }));
    assert.equal(Object.hasOwn(failure, 'cause'), true); assert.equal(failure.cause, value); assert.equal(failure.workerError, value);
  }
  {
    let getters = 0, calls = 0; const options = Object.freeze({ force: false });
    const lock = { get release() {
      getters += 1; return function (received) { assert.equal(this, lock); assert.equal(received, options); calls += 1; return true; };
    } };
    assert.equal(await releaseFileLockOrThrow(lock, { releaseOptions: options }), true);
    assert.equal(getters, 1); assert.equal(calls, 1);
    const primary = Object.freeze(new Error('original release getter rejected'));
    const failure = await rejected(() => releaseFileLockOrThrow({ get release() { throw primary; } }));
    assert.equal(failure.cause, primary);
    await assert.rejects(releaseFileLockOrThrow({ release: 12 }), TypeError);
    const malformedCode = Object.freeze({ toString() { assert.fail('diagnostic objects are not coerced'); } });
    const error = Object.freeze(Object.assign(new Error('diagnostic type guard'), { code: malformedCode }));
    const guarded = await rejected(() => releaseFileLockOrThrow({ release() { throw error; } }));
    assert.equal(guarded.causeCode, 'Error');
  }

  // The real reservation owner must see through the release wrapper, retain
  // its exact existing coordinator and refuse a second native rm until the
  // original independent observer confirms. No record/free-space replay.
  for (const marker of [undefined, false, true]) {
    const home = path.join(root, `reservation-${sequence++}`), target = path.join(home, 'assets');
    const coordinationRoot = path.join(home, 'state', 'storage-access'); await fs.mkdir(target, { recursive: true });
    let probes = 0;
    const reservation = await acquireStorageWriteReservation({ root: target, coordinationRoot, authorizedRoots: [home],
      resourceId: `resource-${sequence}`, requiredBytes: 1,
      freeSpaceOwner: async () => { probes += 1; return { complete: true, availableBytes: 1024 * 1024, observedPath: target }; } });
    const record = path.join(coordinationRoot, 'write-reservations', `${reservation.reservationId}.json`);
    const lockPath = path.join(coordinationRoot, 'write-admission.lock');
    let ready = false, diagnosticReady = marker !== true, deny = true, removes = 0, reads = 0, unlinks = 0;
    const diagnostic = Object.freeze(Object.assign(new Error('coordinator diagnostic native work'), {
      cacheOwnershipReleased() { assert.equal(this, diagnostic); return diagnosticReady; }
    }));
    const primary = new Error('actual coordinator native rm remains pending');
    if (marker !== undefined) primary.cacheOwnershipPending = marker;
    primary.cacheOwnershipReleased = function () { assert.equal(this, primary); return ready; };
    Object.defineProperty(primary, 'code', { get() {
      primary.cacheOwnershipReleased = () => true; if (marker === true) throw diagnostic; return 'EPENDING';
    } });
    fs.open = async (file, ...args) => { if (file === record) reads += 1; return open(file, ...args); };
    fs.unlink = async (file, ...args) => { if (file === record) unlinks += 1; return unlink(file, ...args); };
    fs.rm = async (file, ...args) => { if (file === lockPath) { removes += 1; if (deny) throw primary; } return remove(file, ...args); };
    const receipt = { resourceId: reservation.resourceId, settled: true, pending: false };
    const failure = await rejected(() => reservation.releaseAfterSettlement(receipt));
    assert.equal(contains(failure, primary), true); assert.equal(failure.storageAdmissionSession, reservation);
    assert.equal(failure.cacheOwnershipReleased(), false); assert.equal(reads, 1); assert.equal(unlinks, 1); assert.equal(removes, 1);
    deny = false; await rejected(() => reservation.releaseAfterSettlement(receipt));
    assert.equal(removes, 1, 'replacement true observer cannot authorize a second actual metadata rm');
    assert.equal((await fs.lstat(lockPath)).isFile(), true);
    ready = true;
    if (marker === true) {
      await rejected(() => reservation.releaseAfterSettlement(receipt));
      assert.equal(removes, 1, 'settled primary cannot erase the independent diagnostic owner');
      diagnosticReady = true;
    }
    assert.equal(await reservation.releaseAfterSettlement(receipt), true);
    assert.equal(removes, 2); assert.equal(reads, 1); assert.equal(unlinks, 1); assert.equal(probes, 1);
    assert.equal(failure.cacheOwnershipReleased(), true);
    await assert.rejects(fs.lstat(lockPath), { code: 'ENOENT' });
    fs.rm = remove; fs.unlink = unlink; fs.open = open;
  }
} finally { fs.rm = remove; fs.unlink = unlink; fs.open = open; await rmDirRecursive(root); }
