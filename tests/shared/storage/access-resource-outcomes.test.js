import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { inspectStorageAccess } from '../../../src/shared/storage/access.js';
import { repoAccessPaths } from '../../../src/shared/cache/repo-access.js';
import { repoDelegationPath, inspectRepoCacheDelegation } from '../../../src/shared/cache/repo-access-delegation-guard.js';
import { getContainedFileSession } from '../../../src/shared/contained-file.js';
import { getStorageDirectorySession } from '../../../src/shared/storage/directory.js';
import { readStorageFailureContext } from '../../../src/shared/storage/operation-error.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';

// UNVALIDATED: actual disposable diagnosis/Dir/FileHandle consumers, no reap/admission/apply.
const root = await makeTempDir('poc-access-resource-outcomes-');
const original = { open: fsp.open, opendir: fsp.opendir, openSync: fs.openSync, closeSync: fs.closeSync };
const disposal = new Map(), syncDisposal = new Set();
const restore = () => { fsp.open = original.open; fsp.opendir = original.opendir;
  fs.openSync = original.openSync; fs.closeSync = original.closeSync; };
const rejected = async action => {
  let failed = false, failure;
  try { await action(); } catch (error) { failed = true; failure = error; }
  assert.equal(failed, true); return failure;
};
const contains = (failure, expected) => {
  const queue = [failure], seen = new Set();
  while (queue.length) {
    const current = queue.pop(); if (current === expected) return true;
    if (current === null || !['object', 'function'].includes(typeof current) || seen.has(current)) continue;
    seen.add(current);
    for (const field of ['cause', 'errors']) {
      const descriptor = Object.getOwnPropertyDescriptor(current, field);
      if (!descriptor || !('value' in descriptor)) continue;
      if (field === 'errors' && Array.isArray(descriptor.value)) queue.push(...descriptor.value);
      else if (field === 'cause') queue.push(descriptor.value);
    }
    queue.push(...(readStorageFailureContext(current)?.inspectionErrors || []));
  }
  return false;
};
const pending = flag => {
  const state = { ready: false, codeReads: 0 };
  const error = Object.defineProperties(new Error('original diagnosis resource'), {
    ...(flag === undefined ? {} : { cacheOwnershipPending: { value: flag } }),
    cacheOwnershipReleased: { value() { assert.equal(this, error); return state.ready; }, writable: true },
    code: { get() { state.codeReads++; return 'ENOENT'; } }
  });
  return { state, error };
};
try {
  const asset = path.join(root, 'asset'), coordinationRoot = path.join(root, 'state', 'storage-access');
  const options = { coordinationRoot }, paths = repoAccessPaths(asset, options), delegation = repoDelegationPath(paths);
  const inspect = () => inspectStorageAccess(asset, options);
  assert.deepEqual(await fsp.readdir(root), []);
  const absent = await inspect(); assert.equal(absent.complete, true); assert.equal(absent.protected, false);
  assert.deepEqual(await fsp.readdir(root), [], 'diagnosis must not create its namespace');
  await fsp.mkdir(paths.leases, { recursive: true });
  const lease = path.join(paths.leases, 'fixture-resource.json');
  const leaseText = JSON.stringify({ scope: 'fixture-resource', hostname: os.hostname(), pid: process.pid,
    lockId: 'fixture-resource', startedAt: new Date().toISOString(), resourceId: 'actual-fixture-resource', resourceSettlementVersion: 1 });
  await fsp.writeFile(lease, leaseText);
  let report = await inspect(); assert.equal(report.complete, true); assert.equal(report.protected, true);
  assert.equal(report.owners[0].status, 'resource-settlement-unconfirmed');
  await fsp.writeFile(paths.lockPath, '{'); report = await inspect();
  assert.equal(report.complete, false); assert.equal(report.owners[0].status, 'unreadable-owner');
  await fsp.unlink(paths.lockPath);
  await fsp.writeFile(delegation, '{');
  assert.equal(inspectRepoCacheDelegation(paths).protected, true);
  await fsp.unlink(delegation);

  for (const target of [delegation, paths.lockPath, lease]) {
    if (target !== lease) await fsp.writeFile(target, '{}');
    for (const flag of [undefined, false, true]) {
      const resource = pending(flag); let directories = 0;
      fs.openSync = (file, ...args) => { if (file === delegation && target === delegation) throw resource.error;
        return original.openSync(file, ...args); };
      fsp.open = async (file, ...args) => { if (file === target) throw resource.error; return original.open(file, ...args); };
      fsp.opendir = async (...args) => {
        directories++;
        const directory = await original.opendir(...args), close = directory.close;
        disposal.set(directory, () => close.call(directory));
        directory.close = async () => { const result = await close.call(directory); disposal.delete(directory); return result; };
        return directory;
      };
      const failure = await rejected(inspect); assert.equal(contains(failure, resource.error), true);
      assert.equal(resource.state.codeReads, 0); assert.equal(directories, target === lease ? 1 : 0);
      resource.error.cacheOwnershipReleased = () => true; assert.equal(failure.cacheOwnershipReleased(), false);
      resource.state.ready = true;
      const directorySession = getStorageDirectorySession(failure);
      if (target === lease) { assert.ok(directorySession); await directorySession.releaseAfterClose(); }
      assert.equal(failure.cacheOwnershipReleased(), true); restore();
    }
    if (target !== lease) await fsp.unlink(target);
  }
  await fsp.writeFile(paths.lockPath, '{}');
  for (const primitive of [undefined, null, false, 0, '']) {
    fsp.open = async (file, ...args) => { if (file === paths.lockPath) throw primitive; return original.open(file, ...args); };
    report = await inspect(); assert.equal(report.complete, false); assert.equal(report.protected, true);
    assert.equal(report.owners[0].code, 'ERR_STORAGE_LEASE'); restore();
  }
  {
    const resource = pending(false), primary = Object.freeze(Object.defineProperty(new Error('unreadable diagnosis code'), 'code',
      { get() { throw resource.error; } }));
    fsp.open = async (file, ...args) => { if (file === paths.lockPath) throw primary; return original.open(file, ...args); };
    const failure = await rejected(inspect);
    assert.equal(contains(failure, primary), true); assert.equal(contains(failure, resource.error), true);
    resource.error.cacheOwnershipReleased = () => true; assert.equal(failure.cacheOwnershipReleased(), false);
    resource.state.ready = true; assert.equal(failure.cacheOwnershipReleased(), true); restore();
  }
  {
    const primary = Object.freeze(Object.defineProperty(new Error('unreadable diagnosis lifecycle'), 'cacheOwnershipReleased',
      { get() { throw false; } }));
    fsp.open = async (file, ...args) => { if (file === paths.lockPath) throw primary; return original.open(file, ...args); };
    const failure = await rejected(inspect); assert.equal(contains(failure, primary), true);
    assert.equal(contains(failure, false), true); assert.equal(failure.cacheOwnershipReleased(), false); restore();
  }
  await fsp.unlink(paths.lockPath);

  for (const target of [paths.lockPath, lease]) {
    for (const mode of ['read', 'close']) {
      const resource = pending(undefined), closeFailure = Object.freeze(new Error('actual lease descriptor close failed'));
      let closes = 0, reads = 0, allowClose = false;
      if (target === paths.lockPath) await fsp.writeFile(target, '{}');
      fsp.open = async (file, ...args) => {
        // A cleanup-file case needs an actual readable object before interception.
        const handle = await original.open(file, ...args); if (file !== target) return handle;
        const close = handle.close, read = handle.read;
        disposal.set(handle, () => close.call(handle));
        handle.read = async function (...values) { assert.equal(this, handle); reads++;
          if (mode === 'read') throw resource.error; return read.call(handle, ...values); };
        handle.close = async function () { assert.equal(this, handle); closes++;
          if (mode === 'close' && !allowClose) throw closeFailure;
          const result = await close.call(handle); disposal.delete(handle); return result; };
        return handle;
      };
      const failure = await rejected(inspect), session = getContainedFileSession(failure);
      assert.ok(session); assert.equal(contains(failure, mode === 'read' ? resource.error : closeFailure), true);
      assert.equal(closes, mode === 'read' ? 0 : 1); assert.equal(reads, 1);
      const directorySession = getStorageDirectorySession(failure);
      assert.equal(Boolean(directorySession), target === lease);
      if (mode === 'read') {
        resource.error.cacheOwnershipReleased = () => true;
        await rejected(() => session.releaseAfterClose()); assert.equal(closes, 0);
        resource.state.ready = true;
      }
      allowClose = true; await session.releaseAfterClose();
      if (directorySession) {
        assert.equal(directorySession.isSettled(), false, 'FD settlement cannot acknowledge its parent Dir');
        await directorySession.releaseAfterClose();
      }
      assert.equal(closes, mode === 'read' ? 1 : 2); assert.equal(reads, 1);
      assert.equal(failure.cacheOwnershipReleased(), true); restore();
      if (target === paths.lockPath) await fsp.unlink(target);
    }
  }
  for (const mode of ['open', 'read', 'close']) {
    const resource = pending(false), closeFailure = Object.freeze(Object.assign(new Error('actual directory close failed'), { code: 'ENOENT' }));
    let closes = 0, reads = 0, allowClose = false;
    fsp.opendir = async (...args) => {
      if (mode === 'open') throw resource.error;
      const directory = await original.opendir(...args), close = directory.close, read = directory.read;
      disposal.set(directory, () => close.call(directory));
      directory.read = async function () { assert.equal(this, directory); reads++;
        directory.read = () => assert.fail('replacement directory read must not run');
        directory.close = () => assert.fail('replacement directory close must not run');
        if (mode === 'read') throw resource.error; return read.call(directory); };
      directory.close = async function () { assert.equal(this, directory); closes++;
        if (mode === 'close' && !allowClose) throw closeFailure;
        const result = await close.call(directory); disposal.delete(directory); return result; };
      return directory;
    };
    const failure = await rejected(inspect); assert.equal(contains(failure, mode === 'close' ? closeFailure : resource.error), true);
    assert.equal(closes, mode === 'close' ? 1 : 0);
    const session = getStorageDirectorySession(failure); assert.equal(Boolean(session), mode !== 'open');
    if (mode !== 'close') {
      resource.error.cacheOwnershipReleased = () => true; assert.equal(failure.cacheOwnershipReleased(), false);
      resource.state.ready = true;
    }
    if (session) { allowClose = true; await session.releaseAfterClose(); }
    assert.equal(closes, mode === 'close' ? 2 : mode === 'read' ? 1 : 0);
    assert.equal(failure.cacheOwnershipReleased(), true); assert.equal(reads, mode === 'open' ? 0 : mode === 'read' ? 1 : 2); restore();
  }
  {
    let closes = 0;
    fsp.opendir = async (...args) => {
      const directory = await original.opendir(...args), close = directory.close;
      directory.read = async () => { throw Object.assign(new Error('settled read failure'), { code: 'ENOENT' }); };
      directory.close = async () => { closes++; return close.call(directory); }; return directory;
    };
    report = await inspect(); assert.equal(report.complete, false); assert.equal(report.protected, true);
    assert.equal(report.owners.at(-1).status, 'unreadable-leases'); assert.equal(closes, 1); restore();
  }
  {
    let descriptor, closes = 0, asyncOpens = 0;
    await fsp.writeFile(delegation, '{}');
    fs.openSync = (file, ...args) => { const fd = original.openSync(file, ...args);
      if (file === delegation) { descriptor = fd; syncDisposal.add(fd); } return fd; };
    fs.closeSync = fd => { if (fd === descriptor) { closes++; throw Object.freeze(new Error('actual delegation numeric close failed')); }
      return original.closeSync(fd); };
    fsp.open = (...args) => { asyncOpens++; return original.open(...args); };
    const failure = await rejected(inspect); assert.ok(getContainedFileSession(failure));
    assert.equal(closes, 1); assert.equal(asyncOpens, 0);
    await rejected(() => getContainedFileSession(failure).releaseAfterClose()); assert.equal(closes, 1);
    assert.equal(failure.cacheOwnershipReleased(), false); restore(); await fsp.unlink(delegation);
  }
  assert.equal(await fsp.readFile(lease, 'utf8'), leaseText);
  report = await inspect(); assert.equal(report.complete, true); assert.equal(report.protected, true);
} finally {
  restore();
  for (const dispose of disposal.values()) await dispose();
  // Only authored disposable cleanup; failed numeric close still conveys no production witness.
  for (const fd of syncDisposal) original.closeSync(fd);
  await rmDirRecursive(root);
}
console.log('Storage access diagnosis preserves original lease/delegation/Dir resource outcomes.');
