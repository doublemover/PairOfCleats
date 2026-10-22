import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { probeStorageDestination } from '../../../src/shared/storage/destination.js';
import { inspectStorageAccess } from '../../../src/shared/storage/access.js';
import { repoAccessPaths } from '../../../src/shared/cache/repo-access.js';
import { isStorageSessionReleaseFailure } from '../../../src/shared/storage/session.js';

// UNVALIDATED: actual disposable file/lease owners with inert syscall faults.
const temporary = await makeTempDir('poc-destination-probe-recovery-');
const open = fs.open, unlink = fs.unlink, remove = fsSync.rmSync;
const contains = (error, expected) => {
  const pending = [error], seen = new Set();
  while (pending.length) {
    const current = pending.pop();
    if (current === expected) return true;
    if (!current || typeof current !== 'object' || seen.has(current)) continue;
    seen.add(current);
    pending.push(current.cause, ...(Array.isArray(current.errors) ? current.errors : []));
  }
  return false;
};
const makeCase = async name => {
  const base = path.join(temporary, name), destination = path.join(base, 'selected');
  const coordinationRoot = path.join(base, 'state', 'access');
  await fs.mkdir(destination, { recursive: true });
  return { destination, coordinationRoot, authorizedRoots: [base] };
};
const inspect = input => inspectStorageAccess(input.destination, { coordinationRoot: input.coordinationRoot });
const isProbe = target => path.basename(target).startsWith('.poc-storage-probe-');
const wrap = (owner, intercept) => new Proxy(owner, { get(handle, property) {
  const replacement = intercept(handle, property);
  if (replacement !== undefined) return replacement;
  const value = Reflect.get(handle, property, handle);
  return typeof value === 'function' ? value.bind(handle) : value;
} });
try {
  const closeCase = await makeCase('close');
  const closeError = Object.freeze(Object.assign(new Error('frozen close fault'), { code: 'EBUSY' }));
  let denyClose = true, replaceClose = false, closeAttempts = 0, closeReads = 0, unlinkAttempts = 0, proxy;
  fs.open = async (target, ...args) => {
    const handle = await open(target, ...args);
    if (!isProbe(target)) return handle;
    proxy = wrap(handle, (owner, property) => {
      if (property !== 'close') return undefined;
      closeReads++;
      if (replaceClose) return () => assert.fail('retry cannot adopt a replacement close method');
      return async function () {
        assert.equal(this, proxy, 'the captured close retains its exact receiver');
        closeAttempts++;
        if (denyClose) throw closeError;
        await owner.close();
      };
    });
    return proxy;
  };
  fs.unlink = async (target, ...args) => { if (isProbe(target)) unlinkAttempts++; return unlink(target, ...args); };
  const closeReceipt = await probeStorageDestination(closeCase);
  assert.equal(closeReceipt.writable, false);
  assert.equal(closeReceipt.cleanupPending, true);
  assert.equal(closeReceipt.cacheOwnershipReleased(), false);
  assert.equal(closeReceipt.cleanupFailures[0], closeError);
  assert.equal((await inspect(closeCase)).protected, true);
  assert.equal(unlinkAttempts, 0, 'an unconfirmed handle is not unlinked');
  assert.equal((await fs.readdir(closeCase.destination)).length, 1);
  assert.equal(Object.keys(closeReceipt).includes('storageDestinationProbeSession'), false);
  replaceClose = true;
  denyClose = false;
  const closeRecovery = closeReceipt.storageDestinationProbeSession;
  assert.deepEqual(await Promise.all([closeRecovery.releaseAfterClose(), closeRecovery.releaseAfterClose()]), [true, true]);
  assert.equal(closeAttempts, 2, 'concurrent retries share one actual close');
  assert.equal(closeReads, 1);
  assert.equal(unlinkAttempts, 1);
  assert.equal(closeReceipt.writable, true, 'the original structured receipt follows exact cleanup settlement');
  assert.equal(closeReceipt.cleanupPending, false);
  assert.equal(closeReceipt.cacheOwnershipReleased(), true);
  assert.equal(closeReceipt.cleanupError, null);
  assert.equal(closeReceipt.probeFileRemoved, true);
  assert.equal((await inspect(closeCase)).protected, false);
  assert.equal(await closeRecovery.releaseAfterClose(), true);
  assert.equal(closeAttempts, 2);
  fs.open = open; fs.unlink = unlink;

  const metadataCase = await makeCase('metadata');
  const unlinkError = Object.freeze(Object.assign(new Error('probe unlink denied'), { code: 'EACCES' }));
  let denyUnlink = true, denyMetadata = true, metadataUnlinks = 0;
  fs.unlink = async (target, ...args) => {
    if (isProbe(target)) { metadataUnlinks++; if (denyUnlink) throw unlinkError; }
    return unlink(target, ...args);
  };
  const leases = repoAccessPaths(metadataCase.destination, { coordinationRoot: metadataCase.coordinationRoot }).leases;
  fsSync.rmSync = (target, ...args) => {
    if (denyMetadata && path.dirname(target) === leases) throw Object.assign(new Error('exact metadata unlink denied'), { code: 'EACCES' });
    return remove(target, ...args);
  };
  const metadataReceipt = await probeStorageDestination(metadataCase);
  assert.equal(metadataReceipt.cleanupFailures[0], unlinkError);
  assert.equal((await inspect(metadataCase)).protected, true);
  denyUnlink = false;
  let metadataFailure;
  try { await metadataReceipt.storageDestinationProbeSession.releaseAfterClose(); } catch (error) { metadataFailure = error; }
  assert.equal(metadataFailure.storageDestinationProbeSession, metadataReceipt.storageDestinationProbeSession);
  assert.equal(metadataReceipt.probeFileRemoved, true);
  assert.equal(metadataReceipt.writable, false, 'successful file removal does not erase a failed category lease removal');
  assert.equal(isStorageSessionReleaseFailure(metadataReceipt.cleanupFailures.at(-1), metadataReceipt.storageSession), true);
  assert.equal(metadataReceipt.cacheOwnershipReleased(), false);
  assert.equal((await inspect(metadataCase)).protected, true);
  denyMetadata = false;
  assert.equal(await metadataFailure.storageDestinationProbeSession.releaseAfterClose(), true,
    'an exact metadata-release error cannot block the retry required to settle itself');
  assert.equal(metadataReceipt.writable, true);
  assert.equal(metadataFailure.cacheOwnershipReleased(), true);
  assert.equal(metadataUnlinks, 2, 'the already-removed exact probe is not unlinked again');
  assert.equal((await inspect(metadataCase)).protected, false);
  fs.unlink = unlink; fsSync.rmSync = remove;

  const frozenCase = await makeCase('frozen');
  const primary = Object.freeze(Object.assign(new Error('frozen write failure'), { code: 'EIO' }));
  let frozenDenied = true;
  fs.open = async (target, ...args) => {
    const handle = await open(target, ...args);
    if (!isProbe(target)) return handle;
    return wrap(handle, (owner, property) => {
      if (property === 'writeFile') return async () => { throw primary; };
      if (property === 'close') return async () => { if (frozenDenied) throw closeError; await owner.close(); };
      return undefined;
    });
  };
  const frozenReceipt = await probeStorageDestination(frozenCase);
  assert.equal(frozenReceipt.operationError, primary);
  assert.equal(frozenReceipt.error.code, 'EIO');
  let frozenFailure;
  try { await frozenReceipt.storageDestinationProbeSession.releaseAfterClose(); } catch (error) { frozenFailure = error; }
  assert.equal(contains(frozenFailure, primary), true);
  assert.equal(contains(frozenFailure, closeError), true);
  for (let attempt = 0; attempt < 70; attempt++) await assert.rejects(frozenReceipt.storageDestinationProbeSession.releaseAfterClose());
  assert.equal(frozenReceipt.cleanupFailures.length, 64, 'diagnostic retry history stays bounded');
  assert.equal(frozenReceipt.cleanupFailures[0], closeError);
  frozenDenied = false;
  await frozenFailure.storageDestinationProbeSession.releaseAfterClose();
  assert.equal(frozenReceipt.writable, false, 'cleanup cannot convert a failed round-trip into a successful probe');
  assert.equal(frozenReceipt.cacheOwnershipReleased(), true);
  fs.open = open;

  for (const known of [true, false]) {
    const pendingCase = await makeCase(`pending-${known}`);
    let confirmed = false;
    const pending = Object.freeze(Object.assign(new Error('independent original write owner'), { cacheOwnershipPending: true,
      ...(known ? { cacheOwnershipReleased() { return this === pending && confirmed; } } : {}) }));
    fs.open = async (target, ...args) => {
      const handle = await open(target, ...args);
      if (!isProbe(target)) return handle;
      return wrap(handle, (owner, property) => property === 'writeFile' ? async () => { throw pending; } : undefined);
    };
    const pendingReceipt = await probeStorageDestination(pendingCase);
    assert.equal(pendingReceipt.operationError, pending);
    assert.equal(pendingReceipt.probeFileRemoved, false, 'successful descriptor close cannot clear an independent pending owner');
    assert.equal((await inspect(pendingCase)).protected, true);
    await assert.rejects(pendingReceipt.storageDestinationProbeSession.releaseAfterClose(), error => contains(error, pending)
      && error.cacheOwnershipReleased() === false);
    confirmed = true;
    if (known) {
      await pendingReceipt.storageDestinationProbeSession.releaseAfterClose();
      assert.equal(pendingReceipt.cacheOwnershipReleased(), true, 'the original observer keeps its receiver');
      assert.equal((await inspect(pendingCase)).protected, false);
    } else {
      await assert.rejects(pendingReceipt.storageDestinationProbeSession.releaseAfterClose());
      assert.equal(pendingReceipt.cacheOwnershipReleased(), false, 'missing independent evidence remains unknown');
      // All real fixture handles closed. Dispose only disposable metadata; the
      // independent inert fixture observation remains unconfirmed throughout.
      pendingReceipt.storageSession.releaseAfterSettlement({ resourceId: pendingReceipt.storageSession.resourceId, settled: true, pending: false });
    }
    fs.open = open;
  }

  const changedCase = await makeCase('replacement');
  let preserve = true;
  fs.unlink = async (target, ...args) => {
    if (preserve && isProbe(target)) throw unlinkError;
    return unlink(target, ...args);
  };
  const changedReceipt = await probeStorageDestination(changedCase);
  const originalPath = changedReceipt.recoveryPath, retainedPath = `${originalPath}.original`;
  await fs.rename(originalPath, retainedPath);
  await fs.writeFile(originalPath, 'foreign replacement');
  preserve = false;
  await assert.rejects(changedReceipt.storageDestinationProbeSession.releaseAfterClose(), /Probe file changed/);
  assert.equal(await fs.readFile(originalPath, 'utf8'), 'foreign replacement');
  assert.equal((await inspect(changedCase)).protected, true);
  await unlink(originalPath);
  await fs.rename(retainedPath, originalPath);
  await changedReceipt.storageDestinationProbeSession.releaseAfterClose();
  assert.equal(changedReceipt.writable, true, 'restoring the exact original file permits its own cleanup');
  fs.unlink = unlink;

  const refusedCase = await makeCase('exclusive-open-refused');
  let foreignPath;
  fs.open = async (target, ...args) => {
    if (!isProbe(target)) return open(target, ...args);
    foreignPath = target;
    await fs.writeFile(target, 'unowned exclusive-open collision');
    throw Object.assign(new Error('exclusive open refused'), { code: 'EEXIST' });
  };
  const refused = await probeStorageDestination(refusedCase);
  assert.equal(refused.writable, false);
  assert.equal(refused.cleanupPending, false, 'an ordinary exclusive-open refusal creates no adopted descriptor or file');
  assert.equal(refused.probeFileRemoved, false);
  assert.equal(await fs.readFile(foreignPath, 'utf8'), 'unowned exclusive-open collision');
  assert.equal((await inspect(refusedCase)).protected, false);
} finally {
  fs.open = open; fs.unlink = unlink; fsSync.rmSync = remove;
  await rmDirRecursive(temporary);
}
console.log('Destination probe retains exact descriptor, file and category recovery.');
