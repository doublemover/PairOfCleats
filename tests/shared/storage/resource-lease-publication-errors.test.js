import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { acquireRepoCacheAccessLease, repoAccessPaths } from '../../../src/shared/cache/repo-access.js';
import { getFailedRepoCacheAccessLease } from '../../../src/shared/cache/repo-access-reader.js';
import { inspectStorageAccess } from '../../../src/shared/storage/access.js';

// Actual disposable lease descriptors; write/close failures are inert injection.
// No asset work starts, no child/native backend is acquired, and tests are unrun.
const temporary = await makeTempDir('lease-publication-errors-');
const asset = path.join(temporary, 'asset'), coordinationRoot = path.join(temporary, 'state', 'access');
const leaseDirectory = repoAccessPaths(asset, { coordinationRoot }).leases;
const original = { open: fs.openSync, write: fs.writeFileSync, sync: fs.fsyncSync, close: fs.closeSync };
const capability = Object.freeze({ id: 'original frozen failure capability' });
const primary = new Error('controlled frozen publication failure');
Object.defineProperties(primary, { code: { value: 'EIO' }, nativeOwner: { value: capability } }); Object.freeze(primary);
const closeFailure = Object.freeze(Object.assign(new Error('controlled close result unavailable'), { code: 'ECLOSE' }));
const openDescriptors = new Set();
try {
  for (const scenario of [{ write: true, close: true }, { write: true }, { sync: true }, { close: true }, { write: true, value: undefined }]) {
    let actualCloseObserved = false;
    fs.openSync = (target, ...args) => {
      const descriptor = original.open(target, ...args);
      if (path.dirname(String(target)) === leaseDirectory && args[0] === 'wx') openDescriptors.add(descriptor);
      return descriptor;
    };
    fs.writeFileSync = (target, ...args) => {
      if (openDescriptors.has(target) && scenario.write) throw Object.hasOwn(scenario, 'value') ? scenario.value : primary;
      return original.write(target, ...args);
    };
    fs.fsyncSync = descriptor => {
      if (openDescriptors.has(descriptor) && scenario.sync) throw primary;
      return original.sync(descriptor);
    };
    fs.closeSync = descriptor => {
      if (!openDescriptors.has(descriptor)) return original.close(descriptor);
      original.close(descriptor); openDescriptors.delete(descriptor); actualCloseObserved = true;
      if (scenario.close) throw closeFailure;
    };
    let failure;
    assert.throws(() => acquireRepoCacheAccessLease(asset, { coordinationRoot, resourceId: 'fixture-unconfirmed-publication',
      requireSettlement: true, scope: 'fixture-publication-errors' }), error => {
      failure = error; return error instanceof AggregateError && error.cacheOwnershipPending === true;
    });
    const publication = failure.repoCacheAccessPublication;
    const writeFailed = scenario.write || scenario.sync;
    const expectedPrimary = writeFailed ? Object.hasOwn(scenario, 'value') ? scenario.value : primary : closeFailure;
    assert.equal(failure.cause, expectedPrimary);
    assert.deepEqual(failure.errors, [...(writeFailed ? [expectedPrimary] : []), ...(scenario.close ? [closeFailure] : [])]);
    if (expectedPrimary === primary) {
      assert.equal(failure.nativeOwner, capability); assert.equal(failure.code, 'EIO');
      assert.equal(Object.getOwnPropertyDescriptor(failure, 'nativeOwner').enumerable, false);
    }
    assert.equal(primary.cacheOwnershipPending, undefined); assert.equal(closeFailure.cacheOwnershipPending, undefined);
    assert.equal(publication.sealed, !writeFailed); assert.equal(publication.descriptorCloseObserved, !scenario.close);
    assert.equal(publication.admission, 'unconfirmed'); assert.equal(actualCloseObserved, true);
    assert.equal(getFailedRepoCacheAccessLease(failure), null, 'unconfirmed publication cannot borrow a later refused-admission capability');
    assert.equal(failure.repoCacheAccessLease, undefined); assert.equal(publication.release, undefined);
    assert.equal(failure.cacheOwnershipReleased(), false, 'an ambiguous close or seal cannot become resource settlement');
    assert.equal((await inspectStorageAccess(asset, { coordinationRoot })).protected, true);

    // The inert fixture owner knows its real descriptor closed and started no
    // asset operation. Remove only that task-owned metadata after observations;
    // this is not a production recovery capability or native closure claim.
    assert.equal(path.dirname(publication.file), leaseDirectory);
    assert.ok(path.resolve(publication.file).startsWith(path.resolve(temporary) + path.sep));
    fs.rmSync(publication.file);
  }
  Object.assign(fs, { openSync: original.open, writeFileSync: original.write, fsyncSync: original.sync, closeSync: original.close });
  const healthy = acquireRepoCacheAccessLease(asset, { coordinationRoot, resourceId: 'fixture-healthy-publication',
    requireSettlement: true, scope: 'fixture-publication-errors' });
  assert.equal(healthy.release(), true);
  assert.equal((await inspectStorageAccess(asset, { coordinationRoot })).protected, false);
} finally {
  Object.assign(fs, { openSync: original.open, writeFileSync: original.write, fsyncSync: original.sync, closeSync: original.close });
  for (const descriptor of openDescriptors) original.close(descriptor);
  await rmDirRecursive(temporary);
}
console.log('Resource lease publication preserves frozen write/close failures and unconfirmed admission');
