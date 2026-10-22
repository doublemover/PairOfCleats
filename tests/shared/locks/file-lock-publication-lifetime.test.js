#!/usr/bin/env node
// Authored source regression; execution/qualification deferred by task scope.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  acquireFileLock, isFileLockPublicationPending, isFileLockPublicationSession,
  readLockInfo, removeLockFileSyncIfOwned
} from '../../../src/shared/locks/file-lock.js';
import { removeLockFileIfOwned } from '../../../src/shared/locks/file-lock-owner.js';
import { removeStaleLockFile, shouldCleanupStaleLock } from '../../../src/shared/locks/file-lock-stale.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';

const { dir: tempRoot } = await prepareIsolatedTestCacheDir('file-lock-publication-lifetime', { root: process.cwd() });
const open = fs.open, rm = fs.rm;
const handles = [];
let sequence = 0;
const nextPath = () => path.join(tempRoot, `publication-${sequence++}.lock`);
const rejected = async action => {
  let failed = false, failure;
  try { await action(); } catch (value) { failed = true; failure = value; }
  assert.equal(failed, true);
  return failure;
};
const intercept = (lockPath, decorate) => {
  let calls = 0;
  fs.open = async function (file, ...args) {
    const handle = await open.call(fs, file, ...args);
    if (file !== lockPath) return handle;
    calls += 1;
    handles.push(handle);
    const wrapper = {
      stat(options) { assert.equal(this, wrapper); return handle.stat(options); },
      writeFile(contents) { assert.equal(this, wrapper); return handle.writeFile(contents); },
      close() { assert.equal(this, wrapper); return handle.close(); }
    };
    decorate(wrapper, handle);
    return wrapper;
  };
  return () => calls;
};
const receipt = (session, actual) => assert.deepEqual(actual, { resourceId: session.resourceId, settled: true, pending: false });

try {
  // Both original failures survive. A known failed close is retried only by
  // the returned actual capability, even after its property is replaced.
  {
    const lockPath = nextPath();
    const writeError = Object.freeze(new Error('write failed before bytes'));
    const closeError = Object.freeze(new Error('native close refused'));
    const cleanupError = Object.freeze(new Error('metadata removal refused'));
    let closeAllowed = false, removalAllowed = false, closeCalls = 0, removeCalls = 0;
    let wrapper;
    intercept(lockPath, (owned, handle) => {
      wrapper = owned;
      owned.writeFile = function () { assert.equal(this, owned); throw writeError; };
      owned.close = async function () {
        assert.equal(this, owned); closeCalls += 1;
        if (!closeAllowed) throw closeError;
        await handle.close();
      };
    });
    const failure = await rejected(() => acquireFileLock({ lockPath }));
    assert.equal(failure.cause, writeError);
    assert.ok(failure.errors.includes(closeError));
    const session = failure.fileLockPublicationSession;
    assert.equal(isFileLockPublicationSession(session), true);
    assert.equal(isFileLockPublicationSession({ ...session }), false);
    assert.equal(Object.keys(failure).includes('fileLockPublicationSession'), false);
    assert.equal(closeCalls, 1);
    assert.equal(failure.cacheOwnershipReleased(), false);
    assert.equal(await fs.readFile(lockPath, 'utf8'), '');
    Object.defineProperty(wrapper, 'close', { get() { assert.fail('must keep original close method'); } });
    closeAllowed = true;
    fs.rm = async function (file, options) {
      if (file === lockPath) { removeCalls += 1; if (!removalAllowed) throw cleanupError; }
      return rm.call(fs, file, options);
    };
    const failures = await Promise.all([
      rejected(() => session.releaseAfterClose()), rejected(() => session.releaseAfterClose())
    ]);
    assert.equal(closeCalls, 2, 'coalesced recovery closes the original handle once');
    assert.equal(removeCalls, 1);
    for (const latest of failures) {
      assert.equal(latest.cause, writeError);
      assert.ok(latest.errors.includes(cleanupError));
      assert.equal(latest.fileLockPublicationSession, session);
    }
    removalAllowed = true;
    receipt(session, await session.releaseAfterClose());
    receipt(session, await session.releaseAfterClose());
    assert.equal(closeCalls, 2);
    assert.equal(removeCalls, 2);
    assert.equal(failure.cacheOwnershipReleased(), true);
    assert.equal(isFileLockPublicationPending(lockPath), false);
    fs.rm = rm;
  }

  // Falsey rejection values are present failures, with exact causes.
  for (const value of [undefined, null, false, 0, '']) {
    const lockPath = nextPath();
    let closeCalls = 0;
    intercept(lockPath, (owned, handle) => {
      owned.writeFile = () => { throw value; };
      owned.close = async () => { closeCalls += 1; await handle.close(); };
    });
    const failure = await rejected(() => acquireFileLock({ lockPath }));
    assert.equal(Object.hasOwn(failure, 'cause'), true);
    assert.equal(failure.cause, value);
    assert.ok(failure.errors.includes(value));
    assert.equal(closeCalls, 1);
    assert.equal(isFileLockPublicationPending(lockPath), true);
    receipt(failure.fileLockPublicationSession, await failure.fileLockPublicationSession.releaseAfterClose());
    assert.equal(closeCalls, 1);
  }
  for (const value of [undefined, null, false, 0, '']) {
    const lockPath = nextPath();
    let allowed = false, calls = 0;
    intercept(lockPath, (owned, handle) => {
      owned.close = async () => { calls += 1; if (!allowed) throw value; await handle.close(); };
    });
    const failure = await rejected(() => acquireFileLock({ lockPath }));
    assert.equal(failure.cause, value);
    assert.equal(calls, 1);
    allowed = true;
    // Native timestamp changes at close may conservatively prevent rollback;
    // no changed record is adopted. Absence still permits exact completion.
    try { await failure.fileLockPublicationSession.releaseAfterClose(); }
    catch { await rm(lockPath, { force: true }); }
    receipt(failure.fileLockPublicationSession, await failure.fileLockPublicationSession.releaseAfterClose());
    assert.equal(calls, 2);
  }
  {
    const lockPath = nextPath();
    let allowed = false, calls = 0;
    intercept(lockPath, (owned, handle) => {
      owned.close = async () => { calls += 1; if (!allowed) return false; await handle.close(); };
    });
    const failure = await rejected(() => acquireFileLock({ lockPath }));
    assert.equal(calls, 1);
    assert.equal(failure.cacheOwnershipReleased(), false);
    allowed = true;
    try { await failure.fileLockPublicationSession.releaseAfterClose(); }
    catch { await rm(lockPath, { force: true }); }
    receipt(failure.fileLockPublicationSession, await failure.fileLockPublicationSession.releaseAfterClose());
    assert.equal(calls, 2);
  }
  for (const secondary of [undefined, null, false, 0, '', Object.freeze(new Error('frozen message inspection'))]) {
    const lockPath = nextPath();
    let reads = 0;
    const original = Object.freeze(Object.defineProperties(new Error('replaced'), {
      message: { get() { reads += 1; throw secondary; } }, code: { value: 'EREADONLY', writable: false }
    }));
    intercept(lockPath, owned => { owned.writeFile = () => { throw original; }; });
    const failure = await rejected(() => acquireFileLock({ lockPath }));
    assert.equal(failure.cause, original);
    assert.ok(failure.errors.includes(secondary));
    assert.ok(failure.fileLockPublicationErrors.includes(secondary));
    assert.equal(failure.code, 'EREADONLY');
    assert.equal(Object.getOwnPropertyDescriptor(failure, 'code').writable, false);
    receipt(failure.fileLockPublicationSession, await failure.fileLockPublicationSession.releaseAfterClose());
    assert.equal(reads, 1, 'capture the original message once without retry/replacement');
  }
  {
    const lockPath = nextPath();
    let reads = 0, settled = false;
    const secondary = Object.freeze(Object.assign(new Error('message getter resource'), {
      cacheOwnershipReleased() { assert.equal(this, secondary); return settled; }
    }));
    const original = Object.defineProperty(new Error('replaced'), 'message', {
      configurable: true, get() { reads += 1; throw secondary; }
    });
    intercept(lockPath, owned => { owned.writeFile = () => { throw original; }; });
    const failure = await rejected(() => acquireFileLock({ lockPath }));
    Object.defineProperty(original, 'message', { get() { assert.fail('must not read replacement diagnostic'); } });
    const latest = await rejected(() => failure.fileLockPublicationSession.releaseAfterClose());
    assert.ok(latest.errors.includes(secondary));
    assert.equal(latest.cause, original);
    assert.equal(reads, 1);
    assert.equal(failure.cacheOwnershipReleased(), false);
    settled = true;
    receipt(failure.fileLockPublicationSession, await failure.fileLockPublicationSession.releaseAfterClose());
    assert.equal(reads, 1);
  }

  // Filesystem-looking failures after exclusive open are publication failures,
  // never parent recovery, stale removal, or a second open attempt.
  for (const code of ['ENOENT', 'EEXIST', 'EPERM']) {
    const lockPath = nextPath();
    const original = Object.freeze(Object.assign(new Error(`post-open ${code}`), { code, syscall: 'open' }));
    const calls = intercept(lockPath, owned => { owned.writeFile = () => { throw original; }; });
    const failure = await rejected(() => acquireFileLock({
      lockPath, waitMs: 100, staleRemovalImpl: () => assert.fail('no stale retry after admission')
    }));
    assert.equal(failure.cause, original);
    assert.equal(calls(), 1);
    receipt(failure.fileLockPublicationSession, await failure.fileLockPublicationSession.releaseAfterClose());
  }
  {
    const lockPath = nextPath();
    let stats = 0, writes = 0;
    intercept(lockPath, (owned, handle) => {
      owned.stat = async function (options) {
        assert.equal(this, owned); stats += 1;
        owned.stat = () => assert.fail('must retain original stat method');
        owned.writeFile = () => assert.fail('must capture write before the first await');
        return handle.stat(options);
      };
      owned.writeFile = async function (contents) { assert.equal(this, owned); writes += 1; await handle.writeFile(contents); };
    });
    const lock = await acquireFileLock({ lockPath });
    assert.equal(stats, 2);
    assert.equal(writes, 1);
    assert.equal(await lock.release(), true);
  }

  // Capture an independent original observer even without a true flag. Its
  // method receiver and function remain authoritative after replacement.
  for (const flag of [undefined, false, true]) {
    const lockPath = nextPath();
    let settled = false;
    const original = new Error('independent write owner');
    if (flag !== undefined) original.cacheOwnershipPending = flag;
    original.cacheOwnershipReleased = function () { assert.equal(this, original); return settled; };
    intercept(lockPath, owned => { owned.writeFile = () => { throw original; }; });
    const failure = await rejected(() => acquireFileLock({ lockPath }));
    original.cacheOwnershipReleased = () => true;
    const latest = await rejected(() => failure.fileLockPublicationSession.releaseAfterClose());
    assert.equal(latest.cause, original);
    assert.equal(await fs.readFile(lockPath, 'utf8'), '');
    settled = true;
    receipt(failure.fileLockPublicationSession, await failure.fileLockPublicationSession.releaseAfterClose());
  }
  {
    const lockPath = nextPath();
    let secondarySettled = false;
    const inspection = Object.freeze(Object.assign(new Error('observer getter failed'), {
      cacheOwnershipPending: true,
      cacheOwnershipReleased() { assert.equal(this, inspection); return secondarySettled; }
    }));
    const original = Object.freeze(Object.defineProperty(new Error('frozen primary'), 'cacheOwnershipReleased', {
      get() { throw inspection; }
    }));
    intercept(lockPath, owned => { owned.writeFile = () => { throw original; }; });
    const failure = await rejected(() => acquireFileLock({ lockPath }));
    assert.equal(failure.cause, original);
    assert.ok(failure.errors.includes(inspection));
    secondarySettled = true;
    await rejected(() => failure.fileLockPublicationSession.releaseAfterClose());
    assert.equal(failure.cacheOwnershipReleased(), false, 'unreadable original owner remains unknown');
    assert.equal(await fs.readFile(lockPath, 'utf8'), '');
  }
  {
    const lockPath = nextPath();
    const original = Object.freeze(Object.assign(new Error('missing original observer'), { cacheOwnershipPending: true }));
    intercept(lockPath, owned => { owned.writeFile = () => { throw original; }; });
    const failure = await rejected(() => acquireFileLock({ lockPath }));
    await rejected(() => failure.fileLockPublicationSession.releaseAfterClose());
    assert.equal(failure.cacheOwnershipReleased(), false);
  }

  // No path-only adoption when descriptor identity never became known.
  for (const shape of ['unknown-inode', 'multiple-links', 'link-shaped']) {
    const lockPath = nextPath();
    intercept(lockPath, (owned, handle) => {
      owned.stat = async options => {
        const actual = await handle.stat(options);
        return { ...actual, isFile: () => true, isSymbolicLink: () => shape === 'link-shaped',
          ino: shape === 'unknown-inode' ? 0n : actual.ino, nlink: shape === 'multiple-links' ? 2n : actual.nlink };
      };
    });
    const failure = await rejected(() => acquireFileLock({ lockPath }));
    await rejected(() => failure.fileLockPublicationSession.releaseAfterClose());
    assert.equal(await fs.readFile(lockPath, 'utf8'), '');
    await rm(lockPath);
    receipt(failure.fileLockPublicationSession, await failure.fileLockPublicationSession.releaseAfterClose());
  }
  {
    const lockPath = nextPath();
    const statFailure = Object.freeze(new Error('original stat refused'));
    let closes = 0, stats = 0;
    intercept(lockPath, (owned, handle) => {
      owned.stat = () => { stats += 1; throw statFailure; };
      owned.close = async () => { closes += 1; await handle.close(); };
    });
    const failure = await rejected(() => acquireFileLock({ lockPath }));
    await rejected(() => failure.fileLockPublicationSession.releaseAfterClose());
    assert.equal(failure.cause, statFailure);
    assert.equal(stats, 1);
    assert.equal(closes, 1);
    assert.equal(await fs.readFile(lockPath, 'utf8'), '');
    await rm(lockPath);
    receipt(failure.fileLockPublicationSession, await failure.fileLockPublicationSession.releaseAfterClose());
  }
  {
    const lockPath = nextPath();
    const closeFailure = Object.freeze(new Error('original close getter refused'));
    let reads = 0;
    intercept(lockPath, owned => Object.defineProperty(owned, 'close', { get() { reads += 1; throw closeFailure; } }));
    const failure = await rejected(() => acquireFileLock({ lockPath }));
    await rejected(() => failure.fileLockPublicationSession.releaseAfterClose());
    assert.equal(failure.cause, closeFailure);
    assert.equal(reads, 1, 'never replace an unavailable original native owner');
    assert.equal(failure.cacheOwnershipReleased(), false);
  }

  // All existing in-process deletion owners refuse an unsettled publication,
  // including force and exact logical owner requests, before PID probing.
  {
    const lockPath = nextPath();
    let entered, continueWrite;
    const started = new Promise(resolve => { entered = resolve; });
    const gate = new Promise(resolve => { continueWrite = resolve; });
    intercept(lockPath, (owned, handle) => {
      owned.writeFile = async contents => { await handle.writeFile(contents); entered(); await gate; };
    });
    const admission = acquireFileLock({ lockPath });
    await started;
    const info = await readLockInfo(lockPath);
    assert.equal(isFileLockPublicationPending(lockPath), true);
    assert.equal(await acquireFileLock({ lockPath, forceStaleCleanup: true }), null);
    assert.equal(await removeLockFileIfOwned(lockPath, info, { force: true }), false);
    assert.equal(removeLockFileSyncIfOwned(lockPath, info, { force: true }), false);
    assert.equal((await removeStaleLockFile({ lockPath, info, staleMs: 1 })).removed, false);
    assert.equal((await shouldCleanupStaleLock({ lockPath, info, staleMs: 1, forceStaleCleanup: true, invalidLockGraceMs: 0 })).shouldCleanup, false);
    continueWrite();
    const lock = await admission;
    assert.equal(isFileLockPublicationPending(lockPath), false);
    assert.equal(await lock.release(), true);
    assert.equal(await lock.release(), false);
  }

  // A new physical file at the same name does not inherit rollback authority.
  {
    const lockPath = nextPath(), retained = `${lockPath}.retained`;
    const original = Object.freeze(new Error('failed original publication'));
    intercept(lockPath, owned => { owned.writeFile = () => { throw original; }; });
    const failure = await rejected(() => acquireFileLock({ lockPath }));
    await fs.rename(lockPath, retained);
    await fs.writeFile(lockPath, 'foreign evidence', { flag: 'wx' });
    await rejected(() => failure.fileLockPublicationSession.releaseAfterClose());
    assert.equal(await fs.readFile(lockPath, 'utf8'), 'foreign evidence');
    assert.equal(await fs.readFile(retained, 'utf8'), '');
    await rm(lockPath);
    receipt(failure.fileLockPublicationSession, await failure.fileLockPublicationSession.releaseAfterClose());
    assert.equal(await fs.readFile(retained, 'utf8'), '', 'no discovery/removal of renamed metadata');
  }
  fs.open = open;
  {
    const lockPath = nextPath(), retained = `${lockPath}.retained`;
    const lock = await acquireFileLock({ lockPath, metadata: { label: '日本語 byte extent' } });
    const contents = await fs.readFile(lockPath, 'utf8');
    await fs.rename(lockPath, retained);
    await fs.writeFile(lockPath, contents, { flag: 'wx' });
    await rejected(() => lock.release({ force: true }));
    assert.equal(await fs.readFile(lockPath, 'utf8'), contents, 'copied logical ID is not physical identity');
  }

  // Serialization happens before native admission and cannot replace the
  // generated identity by mutating the object from its toJSON hook.
  {
    const lockPath = nextPath();
    const calls = intercept(lockPath, () => assert.fail('no native admission for invalid serialization'));
    await rejected(() => acquireFileLock({ lockPath, metadata: {
      toJSON() { this.pid = 12; this.lockId = 'replacement'; return this; }
    } }));
    assert.equal(calls(), 0);
    await assert.rejects(fs.lstat(lockPath), { code: 'ENOENT' });
    for (const value of [undefined, null, false, 0, '']) {
      const raw = await rejected(() => acquireFileLock({ lockPath, metadata: { toJSON() { throw value; } } }));
      assert.equal(raw, value);
      assert.equal(calls(), 0);
    }
  }
} finally {
  fs.open = open;
  fs.rm = rm;
  // Fixture disposal is not a resource settlement receipt for unknown owners.
  for (const handle of handles) { try { await handle.close(); } catch {} }
  await rm(tempRoot, { recursive: true, force: true });
}
console.log('file lock publication lifetime controls passed');
