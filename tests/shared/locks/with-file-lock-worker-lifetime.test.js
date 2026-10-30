import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  withFileLock, releaseFileLockOrThrow, isFileLockPublicationPending, removeLockFileSyncIfOwned
} from '../../../src/shared/locks/file-lock.js';
import { withContainedFile } from '../../../src/shared/contained-file.js';
import { getContainedFileSession } from '../../../src/shared/contained-file-resource.js';
import { removeLockFileIfOwned } from '../../../src/shared/locks/file-lock-owner.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';

// UNVALIDATED: actual withFileLock worker, descriptor and metadata lifetimes.
const root = await makeTempDir('poc-with-file-lock-worker-'), remove = fs.rm, open = fs.open;
const disposal = new Map(); let sequence = 0;
const rejected = async action => {
  let failed = false, failure;
  try { await action(); } catch (value) { failed = true; failure = value; }
  assert.equal(failed, true); return failure;
};
try {
  for (const marker of [undefined, false, true]) {
    const file = path.join(root, `${sequence++}.lock`); let ready = false, getters = 0, workers = 0, removals = 0, held;
    const primary = new Error('original worker native work');
    if (marker !== undefined) primary.cacheOwnershipPending = marker;
    primary.cacheOwnershipReleased = function () { assert.equal(this, primary); return ready; };
    fs.rm = async (name, options) => { if (name === file) removals += 1; return remove(name, options); };
    const failure = await rejected(() => withFileLock({ lockPath: file }, async lock => {
      held = lock; workers += 1; const release = lock.release;
      Object.defineProperty(lock, 'release', { get() { getters += 1; return release; } });
      throw primary;
    }));
    assert.equal(failure.code, 'ERR_FILE_LOCK_RELEASE_FAILED'); assert.equal(failure.workerError, primary);
    assert.equal(failure.releaseAttempted, false); assert.equal(Object.hasOwn(failure, 'cause'), false);
    assert.equal(getters, 0); assert.equal(workers, 1); assert.equal(removals, 0);
    assert.equal(isFileLockPublicationPending(file), true); assert.equal((await fs.lstat(file)).isFile(), true);
    assert.equal(await removeLockFileIfOwned(file, held.payload, { force: true }), false);
    assert.equal(removeLockFileSyncIfOwned(file, held.payload, { force: true }), false);
    primary.cacheOwnershipReleased = () => true;
    await rejected(() => held.fileLockPublicationSession.releaseAfterClose()); assert.equal(removals, 0);
    ready = true;
    const session = failure.fileLockPublicationSession;
    assert.deepEqual(await session.releaseAfterClose(), { resourceId: session.resourceId, settled: true, pending: false });
    assert.equal(removals, 1); assert.equal(workers, 1); assert.equal(getters, 0);
    assert.equal(await held.release(), true); assert.equal(removals, 1); assert.equal(getters, 1);
    assert.equal(isFileLockPublicationPending(file), false); assert.equal(failure.cacheOwnershipReleased(), true); fs.rm = remove;
  }
  {
    const file = path.join(root, `${sequence++}.lock`); let secondaryReady = false, observed = false, held, removes = 0;
    const secondary = Object.freeze(Object.assign(new Error('first worker observer rejection owns native work'), {
      cacheOwnershipReleased() { assert.equal(this, secondary); return secondaryReady; }
    }));
    const primary = Object.freeze(Object.assign(new Error('worker primary later confirms'), {
      cacheOwnershipReleased() { assert.equal(this, primary); if (!observed) { observed = true; throw secondary; } return true; }
    }));
    fs.rm = async (name, options) => { if (name === file) removes += 1; return remove(name, options); };
    const failure = await rejected(() => withFileLock({ lockPath: file }, lock => { held = lock; throw primary; }));
    assert.equal(failure.workerError, primary); assert.equal(failure.releaseAttempted, false);
    await rejected(() => held.release()); assert.equal(removes, 0, 'sealed first observer rejection cannot disappear on next observation');
    secondaryReady = true; await failure.fileLockPublicationSession.releaseAfterClose();
    assert.equal(await held.release(), true); assert.equal(removes, 1); fs.rm = remove;
  }
  {
    const source = path.join(root, 'source.txt'), file = path.join(root, `${sequence++}.lock`); await fs.writeFile(source, 'original');
    let allow = false, closes = 0, reads = 0, workers = 0, removes = 0, held;
    const primary = Object.freeze(new Error('actual worker descriptor close failed'));
    fs.open = async (name, ...args) => {
      const actual = await open(name, ...args); if (name !== source) return actual;
      const close = actual.close, read = actual.read; disposal.set(actual, () => close.call(actual));
      actual.read = function (...next) { reads += 1; return read.call(actual, ...next); };
      actual.close = function () { closes += 1; if (!allow) throw primary; disposal.delete(actual); return close.call(actual); };
      return actual;
    };
    fs.rm = async (name, options) => { if (name === file) removes += 1; return remove(name, options); };
    const failure = await rejected(() => withFileLock({ lockPath: file }, async lock => {
      held = lock; workers += 1; return withContainedFile(root, source, async descriptor => {
        const bytes = Buffer.alloc(8); await descriptor.read(bytes, 0, 8, 0); return bytes.toString();
      });
    }));
    const child = getContainedFileSession(failure.workerError); assert.ok(child);
    assert.equal(failure.releaseAttempted, false); assert.equal(removes, 0); assert.equal(reads, 1); assert.equal(closes, 1);
    await rejected(() => held.release()); assert.equal(removes, 0);
    allow = true; await child.releaseAfterClose(); assert.equal(closes, 2); assert.equal(reads, 1);
    await failure.fileLockPublicationSession.releaseAfterClose(); assert.equal(await held.release(), true);
    assert.equal(removes, 1); assert.equal(workers, 1); assert.equal(reads, 1);
    fs.open = open; fs.rm = remove;
  }

  // Capture before release-options/method getters; recheck before invocation.
  {
    let ready = true, calls = 0, getters = 0;
    const primary = Object.assign(new Error('worker originally confirms'), {
      cacheOwnershipReleased() { assert.equal(this, primary); return ready; }
    });
    const lock = { get release() {
      getters += 1; ready = false; primary.cacheOwnershipReleased = () => true;
      return () => { calls += 1; return true; };
    } };
    const failure = await rejected(() => releaseFileLockOrThrow(lock, { workerError: primary }));
    assert.equal(failure.releaseAttempted, false); assert.equal(failure.workerError, primary);
    assert.equal(failure.cacheOwnershipReleased(), false); assert.equal(getters, 1); assert.equal(calls, 0);
    ready = true; assert.equal(failure.cacheOwnershipReleased(), true);
  }
  {
    let ready = true, calls = 0;
    const primary = Object.assign(new Error('same worker and release rejection'), {
      cacheOwnershipReleased() { assert.equal(this, primary); return ready; }
    });
    const failure = await rejected(() => releaseFileLockOrThrow({ release() {
      calls += 1; ready = false; primary.cacheOwnershipReleased = () => true; throw primary;
    } }, { workerError: primary }));
    assert.equal(failure.cause, primary); assert.equal(failure.workerError, primary); assert.equal(failure.releaseAttempted, true);
    assert.equal(calls, 1); assert.equal(failure.cacheOwnershipReleased(), false);
    ready = true; assert.equal(failure.cacheOwnershipReleased(), true);
  }
  for (const value of [undefined, null, false, 0, '', Object.freeze(new Error('ordinary frozen worker error'))]) {
    const file = path.join(root, `${sequence++}.lock`);
    assert.equal(await rejected(() => withFileLock({ lockPath: file }, () => { throw value; })), value);
    await assert.rejects(fs.lstat(file), { code: 'ENOENT' });
    assert.equal(isFileLockPublicationPending(file), false);
  }
  for (const producer of ['wrapper', 'publication']) {
    const file = path.join(root, `${sequence++}.lock`); let removals = 0, workerError;
    const primary = Object.freeze(new Error('exact same-owner metadata cleanup failed'));
    fs.rm = async (name, options) => { if (name === file) { removals += 1; if (removals === 1) throw primary; } return remove(name, options); };
    const failure = await rejected(() => withFileLock({ lockPath: file }, async lock => {
      workerError = await rejected(() => producer === 'wrapper'
        ? releaseFileLockOrThrow(lock) : lock.fileLockPublicationSession.releaseAfterClose());
      throw workerError;
    }));
    assert.equal(failure, workerError, 'same-owner worker failure does not feed metadata predicate back into its retry');
    assert.equal(removals, 2); assert.equal(isFileLockPublicationPending(file), false);
    await assert.rejects(fs.lstat(file), { code: 'ENOENT' }); fs.rm = remove;
  }
  {
    const file = path.join(root, `${sequence++}.lock`); let held, removals = 0;
    const primary = Object.freeze(new Error('ordinary worker failed after explicit confirmed release'));
    fs.rm = async (name, options) => { if (name === file) removals += 1; return remove(name, options); };
    const failure = await rejected(() => withFileLock({ lockPath: file }, async lock => {
      held = lock; assert.equal(await lock.release(), true); throw primary;
    }));
    assert.equal(failure.workerError, primary); assert.equal(failure.releaseResult, false);
    assert.equal(failure.releaseAttempted, true); assert.equal(Object.hasOwn(failure, 'cause'), false);
    assert.equal(removals, 1); assert.equal(held.fileLockPublicationSession.isSettled(), true);
    assert.equal(isFileLockPublicationPending(file), false, 'ordinary later error cannot reopen a fully settled removed owner');
    const again = await rejected(() => releaseFileLockOrThrow(held));
    assert.equal(again.releaseResult, false); assert.equal(isFileLockPublicationPending(file), false);
    assert.equal(removals, 1); await assert.rejects(fs.lstat(file), { code: 'ENOENT' }); fs.rm = remove;
  }
  {
    const file = path.join(root, `${sequence++}.lock`); let ready = false, held, removals = 0;
    const primary = Object.assign(new Error('new independent worker work after acknowledged removal'), {
      cacheOwnershipReleased() { assert.equal(this, primary); return ready; }
    });
    fs.rm = async (name, options) => { if (name === file) removals += 1; return remove(name, options); };
    const failure = await rejected(() => withFileLock({ lockPath: file }, async lock => {
      held = lock; assert.equal(await lock.release(), true); throw primary;
    }));
    assert.equal(failure.releaseAttempted, false); assert.equal(removals, 1);
    assert.equal(isFileLockPublicationPending(file), true, 'removed metadata cannot clear newly reported pending native work');
    const again = await rejected(() => releaseFileLockOrThrow(held));
    assert.equal(again.releaseResult, false); assert.equal(again.cacheOwnershipReleased(), false);
    assert.equal(isFileLockPublicationPending(file), true); assert.equal(removals, 1);
    primary.cacheOwnershipReleased = () => true;
    await rejected(() => held.fileLockPublicationSession.releaseAfterClose()); assert.equal(removals, 1);
    ready = true;
    // A later actual wrapper can drop the now-confirmed fence without requiring
    // an otherwise unnecessary metadata session call or a duplicate unlink.
    const settled = await rejected(() => releaseFileLockOrThrow(held));
    assert.equal(settled.releaseResult, false); assert.equal(isFileLockPublicationPending(file), false);
    assert.equal(held.fileLockPublicationSession.isSettled(), true); assert.equal(removals, 1); fs.rm = remove;
  }
  {
    const file = path.join(root, `${sequence++}.lock`); let ready = false, held;
    const secondary = Object.freeze(Object.assign(new Error('unreadable worker ownership'), { cacheOwnershipReleased() { return ready; } }));
    const primary = Object.freeze(Object.defineProperty(new Error('unknown worker'), 'cacheOwnershipReleased', { get() { throw secondary; } }));
    const failure = await rejected(() => withFileLock({ lockPath: file }, lock => { held = lock; throw primary; }));
    ready = true; await rejected(() => held.release()); assert.equal(failure.cacheOwnershipReleased(), false);
    assert.equal(held.fileLockPublicationSession.isSettled(), false);
    // Disposable metadata cleanup below cannot settle this unreadable owner.
  }
} finally {
  fs.open = open; fs.rm = remove; for (const close of disposal.values()) { try { await close(); } catch {} }
  await rmDirRecursive(root);
}
