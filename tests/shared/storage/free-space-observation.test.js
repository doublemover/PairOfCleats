import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { inspectStorageFreeSpace, probeStorageDestination } from '../../../src/shared/storage/destination.js';
import { acquireStorageWriteReservation } from '../../../src/shared/storage/admission.js';
import { addStorageFailureContext } from '../../../src/shared/storage/operation-error.js';
import { prepareIsolatedTestCacheDir, resolveTestCachePath } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';

// UNVALIDATED: original disposable file/lease owners; injected observations are inert.
applyTestEnv();
const selected = process.env.PAIROFCLEATS_TEST_ID?.split('/').at(-1);
const cases = ['exact', 'settled-error', 'pending-error', 'pending-ancestor', 'pending-result',
  'diagnostic-owner', 'exact-field-rejections', 'pending-admission', 'mutable-admission',
  'admission-getter-owner', 'callable-probe-owner'];
assert.ok(cases.includes(selected), 'runner must select one bounded case');
const { dir: fixtureRoot } = await prepareIsolatedTestCacheDir('storage-free-space-' + selected);
const root = path.join(fixtureRoot, 'selected'), coordinationRoot = path.join(fixtureRoot, 'state', 'access');
const original = { statfs: fs.statfs, lstat: fs.lstat, open: fs.open, unlink: fs.unlink };
const acknowledgements = [], recoveries = [];
let workError;
const contains = (value, expected, seen = new Set()) => {
  if (value === expected) return true;
  if (value === null || !['object', 'function'].includes(typeof value) || seen.has(value)) return false;
  seen.add(value);
  return contains(value.cause, expected, seen)
    || (Array.isArray(value.errors) && value.errors.some(error => contains(error, expected, seen)));
};
const failed = async work => {
  try { await work(); } catch (error) { return error; }
  assert.fail('operation must fail');
};
const pending = (value = new Error('Original native observation remains pending.')) => {
  let ready = false;
  Object.defineProperties(value, {
    cacheOwnershipPending: { value: true },
    cacheOwnershipReleased: { value() { assert.equal(this, value); return ready; } }
  });
  const acknowledge = () => { ready = true; };
  acknowledgements.push(acknowledge);
  return { value: Object.freeze(value), acknowledge };
};
const rememberAdmission = error => {
  const session = error.storageAdmissionSession;
  assert.ok(session, 'pending provider retains the actual admission coordinator');
  recoveries.push(() => session.releaseAfterSettlement({ resourceId: session.resourceId, settled: true, pending: false }));
  return session;
};
const inspect = () => inspectStorageFreeSpace({ destination: root, requiredBytes: 4096, minimumFreeBytes: 4096 });
const acquire = freeSpaceOwner => acquireStorageWriteReservation({ root, coordinationRoot,
  authorizedRoots: [fixtureRoot], requiredBytes: 200, resourceId: selected, freeSpaceOwner });

try {
  await fs.mkdir(root);
  if (selected === 'exact') {
    let calls = 0;
    fs.statfs = async (file, options) => {
      calls++; assert.equal(file, root); assert.deepEqual(options, { bigint: true });
      return { bsize: 4096n, bavail: 2048n };
    };
    const receipt = await inspect();
    assert.equal(receipt.complete, true); assert.equal(receipt.availableBytes, 8388608);
    assert.equal(receipt.reserveSatisfied, true); assert.equal(receipt.mutationPerformed, false);
    assert.deepEqual(await fs.readdir(root), []); assert.equal(calls, 1);
    fs.statfs = async () => ({ bsize: 1n, bavail: BigInt(Number.MAX_SAFE_INTEGER) });
    const boundary = await inspectStorageFreeSpace({ destination: root,
      requiredBytes: Number.MAX_SAFE_INTEGER, minimumFreeBytes: Number.MAX_SAFE_INTEGER });
    assert.equal(boundary.complete, true); assert.equal(boundary.reserveSatisfied, false);
  } else if (selected === 'settled-error') {
    const primary = Object.freeze(Object.assign(new Error('ordinary access denial'), { code: 'EACCES' }));
    fs.statfs = async () => { throw primary; };
    const receipt = await inspect();
    assert.equal(receipt.complete, false); assert.equal(receipt.availableBytes, null);
    assert.deepEqual(receipt.error, { code: 'EACCES', message: 'ordinary access denial' });
    assert.equal(receipt.mutationPerformed, false);
  } else if (selected === 'pending-error') {
    const owner = pending(Object.assign(new Error('statfs owns work'), { code: 'EIO' })); let calls = 0;
    fs.statfs = async () => { calls++; throw owner.value; };
    const error = await failed(inspect);
    assert.equal(contains(error, owner.value), true); assert.equal(error.cacheOwnershipReleased(), false);
    owner.acknowledge(); assert.equal(error.cacheOwnershipReleased(), true); assert.equal(calls, 1);
  } else if (selected === 'pending-ancestor') {
    const destination = path.join(root, 'missing', 'deep');
    const owner = pending(Object.assign(new Error('missing path with unsettled work'), { code: 'ENOENT' }));
    let calls = 0, ancestors = 0;
    fs.lstat = async (file, ...args) => {
      if (file === destination) throw owner.value;
      ancestors++; return original.lstat(file, ...args);
    };
    fs.statfs = async () => { calls++; return { bsize: 1n, bavail: 1000n }; };
    const error = await failed(() => inspectStorageFreeSpace({ destination }));
    assert.equal(contains(error, owner.value), true); assert.equal(error.cacheOwnershipReleased(), false);
    assert.equal(calls, 0); assert.equal(ancestors, 0, 'pending ENOENT cannot authorize ancestor fallback');
    owner.acknowledge(); assert.equal(error.cacheOwnershipReleased(), true);
  } else if (selected === 'pending-result') {
    let fields = 0, calls = 0;
    const owner = pending(Object.defineProperties({}, {
      bavail: { get() { fields++; return 1000n; } }, bsize: { value: 1n }
    }));
    fs.statfs = async () => { calls++; return owner.value; };
    const error = await failed(inspect);
    assert.equal(contains(error, owner.value), true); assert.equal(error.cacheOwnershipReleased(), false);
    assert.equal(fields, 0); owner.acknowledge(); assert.equal(error.cacheOwnershipReleased(), true);
    assert.equal(calls, 1);
  } else if (selected === 'diagnostic-owner') {
    const owner = pending(new Error('independent diagnostic work'));
    const primary = Object.freeze(Object.defineProperty(new Error('original failure'), 'code', { get() { throw owner.value; } }));
    fs.statfs = async () => { throw primary; };
    const error = await failed(inspect);
    assert.equal(contains(error, primary), true); assert.equal(contains(error, owner.value), true);
    assert.equal(error.cacheOwnershipReleased(), false);
    owner.acknowledge(); assert.equal(error.cacheOwnershipReleased(), true);
  } else if (selected === 'exact-field-rejections') {
    for (const value of [{ bsize: 0n, bavail: 1n }, { bsize: -1n, bavail: -1n },
      { bsize: 1n, bavail: -1n }, { bsize: 2n, bavail: BigInt(Number.MAX_SAFE_INTEGER) },
      { bsize: 1, bavail: 1000 }, { bsize: 1n, bavail: 1000 }]) {
      fs.statfs = async () => value;
      const receipt = await inspect();
      assert.equal(receipt.complete, false); assert.equal(receipt.availableBytes, null);
      assert.equal(receipt.reserveSatisfied, false); assert.equal(receipt.mutationPerformed, false);
    }
  } else if (selected === 'pending-admission' || selected === 'admission-getter-owner') {
    let calls = 0;
    const owner = pending(selected === 'pending-admission'
      ? { complete: true, availableBytes: 10000, observedPath: root } : new Error('independent capacity getter work'));
    const response = selected === 'pending-admission' ? owner.value
      : Object.freeze(Object.defineProperties({ complete: true, observedPath: root }, {
        availableBytes: { get() { throw owner.value; } }
      }));
    const provider = async () => { calls++; return response; };
    const error = await failed(async () => {
        const reservation = await acquire(provider);
        recoveries.push(() => reservation.releaseAfterSettlement({ resourceId: selected, settled: true, pending: false }));
      }), session = rememberAdmission(error);
    assert.equal(contains(error, owner.value), true); assert.equal(error.cacheOwnershipReleased(), false);
    assert.deepEqual(error.storageWriteReservations, []);
    assert.equal((await original.lstat(path.join(coordinationRoot, 'write-admission.lock'))).isFile(), true);
    const busy = await failed(() => acquire(provider));
    assert.equal(busy.reason, 'admission-owner-busy'); assert.equal(calls, 1);
    await assert.rejects(session.releaseAfterSettlement({ resourceId: selected, settled: true, pending: false }));
    owner.acknowledge();
    assert.equal(await session.releaseAfterSettlement({ resourceId: selected, settled: true, pending: false }), true);
    assert.equal(error.cacheOwnershipReleased(), true); assert.equal(calls, 1);
    await assert.rejects(original.lstat(path.join(coordinationRoot, 'write-admission.lock')), { code: 'ENOENT' });
  } else if (selected === 'mutable-admission') {
    const response = { complete: true, availableBytes: 100, observedPath: root };
    let mutations = 0;
    fs.lstat = async (file, options) => {
      const result = await original.lstat(file, options);
      if (file === root && options?.bigint === true) { response.availableBytes = 10000; mutations++; }
      return result;
    };
    let reservation;
    const error = await failed(async () => {
      reservation = await acquire(async () => response);
      recoveries.push(() => reservation.releaseAfterSettlement({ resourceId: selected, settled: true, pending: false }));
    });
    assert.equal(error.reason, 'minimum-free-space-or-pending-reservations');
    assert.equal(error.availableBytes, 100); assert.equal(mutations, 1);
    assert.equal(reservation, undefined);
    await assert.rejects(original.lstat(path.join(coordinationRoot, 'write-admission.lock')), { code: 'ENOENT' });
  } else if (selected === 'callable-probe-owner') {
    const owner = pending(Object.assign(function originalWriteFailure() {}, { code: 'EIO' }));
    let writes = 0, closes = 0, unlinks = 0;
    const isProbe = file => path.basename(file).startsWith('.poc-storage-probe-');
    fs.open = async (file, ...args) => {
      const native = await original.open(file, ...args);
      if (!isProbe(file)) return native;
      return new Proxy(native, { get(handle, property) {
        if (property === 'writeFile') return async () => { writes++; throw owner.value; };
        if (property === 'close') return async () => { closes++; return native.close(); };
        const value = Reflect.get(handle, property, handle);
        return typeof value === 'function' ? value.bind(handle) : value;
      } });
    };
    fs.unlink = async (file, ...args) => { if (isProbe(file)) unlinks++; return original.unlink(file, ...args); };
    const receipt = await probeStorageDestination({ destination: root, coordinationRoot, authorizedRoots: [fixtureRoot] });
    assert.ok(receipt.storageDestinationProbeSession);
    recoveries.push(() => receipt.storageDestinationProbeSession.releaseAfterClose());
    assert.equal(receipt.operationError, owner.value); assert.equal(receipt.writable, false);
    assert.equal(receipt.cleanupPending, true); assert.equal(receipt.cacheOwnershipReleased(), false);
    assert.equal(writes, 1); assert.equal(closes, 1); assert.equal(unlinks, 0);
    assert.equal((await fs.readdir(root)).length, 1);
    owner.acknowledge(); await receipt.storageDestinationProbeSession.releaseAfterClose();
    assert.equal(receipt.cacheOwnershipReleased(), true); assert.equal(receipt.writable, false);
    assert.equal(closes, 1); assert.equal(writes, 1); assert.equal(unlinks, 1);
    assert.deepEqual(await fs.readdir(root), []);
  }
} catch (error) { workError = error; }
finally {
  Object.assign(fs, original);
  for (const acknowledge of acknowledgements) acknowledge();
  let cleanupError;
  for (const recover of recoveries) {
    try { await recover(); }
    catch (error) { cleanupError = cleanupError ? addStorageFailureContext(cleanupError, {}, error) : error; }
  }
  if (!cleanupError) {
    try {
      const absolute = path.resolve(fixtureRoot), parent = path.resolve(resolveTestCachePath());
      assert.equal(path.dirname(absolute), parent);
      assert.ok(path.basename(absolute).startsWith('storage-free-space-'));
      await fs.rm(absolute, { recursive: true, force: true });
    } catch (error) { cleanupError = error; }
  }
  if (cleanupError) workError = workError ? addStorageFailureContext(workError, {}, cleanupError) : cleanupError;
}
if (workError) throw workError;
console.log('storage free-space observation ' + selected + ' passed');
