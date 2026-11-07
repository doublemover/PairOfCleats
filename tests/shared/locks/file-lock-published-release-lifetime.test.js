import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  acquireFileLock, releaseFileLockOrThrow, isFileLockPublicationPending,
  isFileLockPublicationSession, removeLockFileSyncIfOwned
} from '../../../src/shared/locks/file-lock.js';
import { getPublishedFileLockReleaseObservation } from '../../../src/shared/locks/file-lock-producer-observations.js';
import { removeLockFileIfOwned } from '../../../src/shared/locks/file-lock-owner.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';

// UNVALIDATED: real successful lock publication and exact metadata retries.
const root = await makeTempDir('poc-lock-published-release-');
const remove = fs.rm, lstat = fs.lstat, readFile = fs.readFile;
let sequence = 0;
const rejected = async action => {
  let failed = false, failure;
  try { await action(); } catch (value) { failed = true; failure = value; }
  assert.equal(failed, true); return failure;
};
const receipt = (session, result) => assert.deepEqual(result, { resourceId: session.resourceId, settled: true, pending: false });
const create = async () => {
  const file = path.join(root, `${sequence++}.lock`), lock = await acquireFileLock({ lockPath: file });
  const session = lock.fileLockPublicationSession;
  assert.equal(isFileLockPublicationSession(session), true);
  assert.equal(Object.keys(lock).includes('fileLockPublicationSession'), false);
  assert.equal(session.isSettled(), false);
  return { file, lock, session };
};
try {
  for (const marker of [undefined, false, true]) {
    const { file, lock, session } = await create();
    let ready = false, allow = false, removals = 0, lookups = 0, reads = 0, messages = 0;
    const primary = new Error('original native metadata operation');
    if (marker !== undefined) primary.cacheOwnershipPending = marker;
    primary.cacheOwnershipReleased = function () { assert.equal(this, primary); return ready; };
    Object.defineProperty(primary, 'message', { get() {
      messages += 1; primary.cacheOwnershipReleased = () => true; return 'original metadata failure';
    } });
    fs.lstat = async (name, ...args) => { if (name === file) lookups += 1; return lstat(name, ...args); };
    fs.readFile = async (name, ...args) => { if (name === file) reads += 1; return readFile(name, ...args); };
    fs.rm = async (name, options) => { if (name === file) { removals += 1; if (!allow) throw primary; } return remove(name, options); };
    const failure = await rejected(() => releaseFileLockOrThrow(lock));
    assert.equal(failure.cause, primary, 'the actual direct-release rejection remains unchanged');
    assert.equal(failure.fileLockPublicationSession, session); assert.equal(failure.cacheOwnershipReleased(), false);
    assert.equal(messages, 1); assert.equal(removals, 1); assert.equal(isFileLockPublicationPending(file), true);
    const before = { lookups, reads };
    allow = true;
    await rejected(() => lock.release()); await rejected(() => session.releaseAfterClose());
    assert.equal(lookups, before.lookups); assert.equal(reads, before.reads); assert.equal(removals, 1);
    assert.equal(await removeLockFileIfOwned(file, lock.payload, { force: true }), false);
    assert.equal(removeLockFileSyncIfOwned(file, lock.payload, { force: true }), false);
    ready = true;
    assert.equal(failure.cacheOwnershipReleased(), false, 'retained metadata remains owned after independent native work settles');
    assert.equal(session.isSettled(), false);
    assert.equal(await lock.release(), true); assert.equal(await lock.release(), false);
    assert.equal(session.isSettled(), true); assert.equal(removals, 2); assert.equal(messages, 1);
    assert.equal(failure.cacheOwnershipReleased(), true);
    assert.equal(isFileLockPublicationPending(file), false);
    fs.rm = remove; fs.lstat = lstat; fs.readFile = readFile;
  }

  for (const value of [undefined, null, false, 0, '', Object.freeze(new Error('frozen removal failure'))]) {
    const { file, lock, session } = await create(); let allow = false, removals = 0;
    fs.rm = async (name, options) => { if (name === file) { removals += 1; if (!allow) throw value; } return remove(name, options); };
    assert.equal(await rejected(() => lock.release()), value);
    assert.equal(isFileLockPublicationPending(file), true);
    allow = true; receipt(session, await session.releaseAfterClose());
    assert.equal(await lock.release(), true, 'the exact owner acknowledges recovery without another unlink');
    assert.equal(await lock.release(), false); assert.equal(removals, 2); fs.rm = remove;
  }
  {
    const { file, lock, session } = await create(); let allow = false, removals = 0;
    const primary = Object.freeze(new Error('first metadata removal failed'));
    fs.rm = async (name, options) => { if (name === file) { removals += 1; if (!allow) throw primary; } return remove(name, options); };
    assert.equal(await rejected(() => lock.release()), primary); allow = true;
    const [settlement, released] = await Promise.all([session.releaseAfterClose(), lock.release()]);
    receipt(session, settlement); assert.equal(released, true); assert.equal(removals, 2);
    assert.equal(await lock.release(), false); fs.rm = remove;
  }
  {
    const { file, lock, session } = await create(); let primaryReady = false, secondaryReady = false, removes = 0;
    const secondary = Object.freeze(Object.assign(new Error('original observer owns secondary work'), {
      cacheOwnershipReleased() { assert.equal(this, secondary); return secondaryReady; }
    }));
    const primary = Object.assign(new Error('metadata native failure'), {
      cacheOwnershipReleased() { assert.equal(this, primary); if (!primaryReady) throw secondary; return true; }
    });
    fs.rm = async (name, options) => { if (name === file) { removes += 1; if (removes === 1) throw primary; } return remove(name, options); };
    const failure = await rejected(() => releaseFileLockOrThrow(lock));
    assert.equal(failure.cause, primary); assert.equal(failure.cacheOwnershipReleased(), false);
    primary.cacheOwnershipReleased = () => true; primaryReady = true;
    await rejected(() => lock.release()); assert.equal(removes, 1);
    secondaryReady = true; receipt(session, await session.releaseAfterClose());
    assert.equal(await lock.release(), true); assert.equal(removes, 2); fs.rm = remove;
  }

  // Lookup failures are retained before ENOENT classification and cannot be
  // retried by replacing the error's public observer.
  for (const marker of [undefined, false, true]) {
    const { file, lock, session } = await create(); let ready = false, allow = false, lookups = 0, codes = 0;
    const primary = new Error('pending original lookup');
    if (marker !== undefined) primary.cacheOwnershipPending = marker;
    primary.cacheOwnershipReleased = function () { assert.equal(this, primary); return ready; };
    Object.defineProperty(primary, 'code', { get() { codes += 1; return 'ENOENT'; } });
    fs.lstat = async (name, ...args) => {
      if (name === file) { lookups += 1; if (!allow) throw primary; } return lstat(name, ...args);
    };
    assert.equal(await rejected(() => lock.release()), primary); assert.equal(codes, 0); assert.equal(lookups, 1);
    primary.cacheOwnershipReleased = () => true; allow = true;
    await rejected(() => lock.release()); assert.equal(lookups, 1);
    ready = true; receipt(session, await session.releaseAfterClose()); assert.equal(await lock.release(), true);
    fs.lstat = lstat;
  }
  {
    const { file, lock, session } = await create(); let ready = true, removals = 0;
    const primary = Object.assign(new Error('remember original metadata resource'), {
      cacheOwnershipReleased() { assert.equal(this, primary); return ready; }
    });
    fs.rm = async (name, options) => { if (name === file) { removals += 1; if (removals === 1) throw primary; } return remove(name, options); };
    assert.equal(await rejected(() => lock.release()), primary); primary.cacheOwnershipReleased = () => true;
    fs.lstat = async (name, ...args) => { const value = await lstat(name, ...args); if (name === file) ready = false; return value; };
    await rejected(() => lock.release()); assert.equal(removals, 1);
    fs.lstat = lstat; ready = true;
    fs.rm = async (name, options) => { const result = await remove(name, options); if (name === file) { removals += 1; ready = false; } return result; };
    await rejected(() => lock.release()); assert.equal(removals, 2); assert.equal(isFileLockPublicationPending(file), true);
    assert.equal(session.isSettled(), false); await rejected(() => lock.release()); assert.equal(removals, 2);
    ready = true; receipt(session, await session.releaseAfterClose());
    assert.equal(isFileLockPublicationPending(file), false); assert.equal(await lock.release(), true);
    assert.equal(removals, 2); fs.rm = remove;
  }

  // A serialization, field/capability copy, or changed physical pathname does
  // not confer the original published owner's private observation or unlink.
  for (const source of ['worker', 'inspection']) {
    const { file, lock, session } = await create(); let ready = source === 'worker', phase = 'initial', removals = 0, failure;
    const independent = Object.assign(new Error('wrapper independently observed native work'), {
      cacheOwnershipReleased() { assert.equal(this, independent); return ready; }
    });
    const primary = new Error('first native removal failed');
    if (source === 'inspection') Object.defineProperty(primary, 'code', { get() { throw independent; } });
    fs.rm = async (name, options) => {
      if (name === file) {
        removals += 1; if (phase === 'initial') { if (source === 'worker') ready = false; throw primary; }
        if (phase === 'self') throw failure;
      }
      return remove(name, options);
    };
    failure = await rejected(() => releaseFileLockOrThrow(lock, source === 'worker' ? { workerError: independent } : {}));
    assert.equal(failure.cause, primary); assert.equal(removals, 1);
    independent.cacheOwnershipReleased = () => true; phase = 'self';
    await rejected(() => lock.release()); assert.equal(removals, 1,
      'actual wrapper returns new independent prerequisites before any next native retry');
    ready = true; assert.equal(await rejected(() => lock.release()), failure); assert.equal(removals, 2);
    phase = 'allow'; receipt(session, await session.releaseAfterClose()); assert.equal(await lock.release(), true);
    assert.equal(removals, 3); fs.rm = remove;
  }
  {
    const { file, lock, session } = await create(); let phase = 'initial', first, ready = true, removals = 0;
    const primary = Object.freeze(new Error('first release'));
    const worker = Object.assign(new Error('later independent wrapper worker'), {
      cacheOwnershipReleased() { assert.equal(this, worker); return ready; }
    });
    fs.rm = async (name, options) => {
      if (name === file) {
        removals += 1; if (phase === 'initial') throw primary;
        if (phase === 'self') { ready = false; throw first; }
      }
      return remove(name, options);
    };
    first = await rejected(() => releaseFileLockOrThrow(lock)); phase = 'self';
    const second = await rejected(() => releaseFileLockOrThrow(lock, { workerError: worker }));
    assert.equal(second.cause, first); assert.equal(removals, 2); assert.equal(second.cacheOwnershipReleased(), false);
    phase = 'allow'; worker.cacheOwnershipReleased = () => true;
    await rejected(() => lock.release()); assert.equal(removals, 2);
    ready = true; receipt(session, await session.releaseAfterClose()); assert.equal(await lock.release(), true);
    assert.equal(removals, 3); assert.equal(second.cacheOwnershipReleased(), true); fs.rm = remove;
  }
  {
    const { file, lock, session } = await create(); let phase = 'initial', failure, foreignReady = false, removals = 0;
    const primary = Object.freeze(new Error('actual initial metadata failure'));
    const foreign = Object.assign(new Error('unbranded lookalike carries actual session'), {
      fileLockPublicationSession: session, cacheOwnershipReleased() { assert.equal(this, foreign); return foreignReady; }
    });
    fs.rm = async (name, options) => {
      if (name === file) {
        removals += 1;
        if (phase === 'initial') throw primary;
        if (phase === 'self') throw failure;
        if (phase === 'foreign') throw foreign;
      }
      return remove(name, options);
    };
    failure = await rejected(() => releaseFileLockOrThrow(lock)); assert.equal(failure.cause, primary);
    phase = 'self'; assert.equal(await rejected(() => lock.release()), failure);
    phase = 'foreign'; assert.equal(await rejected(() => lock.release()), foreign); assert.equal(removals, 3);
    phase = 'allow'; foreign.cacheOwnershipReleased = () => true;
    await rejected(() => lock.release()); assert.equal(removals, 3);
    foreignReady = true; receipt(session, await session.releaseAfterClose());
    assert.equal(await lock.release(), true); assert.equal(removals, 4); fs.rm = remove;
  }
  {
    const { file, lock, session } = await create(); let phase = 'initial', failure, removals = 0;
    const primary = Object.freeze(new Error('original metadata failure'));
    const foreign = Object.freeze(Object.assign(new Error('unbranded cyclic original observation'), {
      cacheOwnershipReleased() { return failure.cacheOwnershipReleased(); }
    }));
    fs.rm = async (name, options) => {
      if (name === file) { removals += 1; if (phase === 'initial') throw primary; if (phase === 'cycle') throw foreign; }
      return remove(name, options);
    };
    failure = await rejected(() => releaseFileLockOrThrow(lock));
    phase = 'cycle'; assert.equal(await rejected(() => lock.release()), foreign); phase = 'allow';
    await rejected(() => lock.release()); assert.equal(failure.cacheOwnershipReleased(), false); assert.equal(removals, 2);
    await rejected(() => session.releaseAfterClose()); assert.equal(removals, 2);
    assert.equal(session.isSettled(), false, 'unknown cyclic observation grants no metadata authority');
    fs.rm = remove; // Fixture disposal below cannot settle this original cycle.
  }
  {
    const { file, lock, session } = await create(); let ready = false, deny = true;
    const primary = Object.assign(new Error('actual original owner'), { cacheOwnershipReleased() { return ready; } });
    fs.rm = async (name, options) => { if (name === file && deny) throw primary; return remove(name, options); };
    assert.equal(await rejected(() => lock.release()), primary);
    const fake = { ...lock, fileLockPublicationSession: session, release: async () => false };
    assert.equal(getPublishedFileLockReleaseObservation(fake), null);
    const failure = await rejected(() => releaseFileLockOrThrow(fake));
    assert.equal(Object.hasOwn(failure, 'fileLockPublicationSession'), false);
    assert.equal(getPublishedFileLockReleaseObservation(JSON.parse(JSON.stringify(lock))), null);
    deny = false; ready = true; assert.equal(await lock.release(), true); fs.rm = remove;
  }
  {
    const { file, lock, session } = await create(), saved = `${file}.saved`;
    const contents = await fs.readFile(file, 'utf8'); await fs.rename(file, saved); await fs.writeFile(file, contents, { flag: 'wx' });
    const failure = await rejected(() => lock.release({ force: true }));
    assert.equal(failure.message, 'File lock metadata identity changed or was not sealed; existing evidence is preserved.');
    await rejected(() => session.releaseAfterClose());
    assert.equal(await fs.readFile(file, 'utf8'), contents); assert.equal(await fs.readFile(saved, 'utf8'), contents);
    await remove(file); // Manual disposable evidence disposal, never adoption.
    receipt(session, await session.releaseAfterClose()); assert.equal(await lock.release(), true);
    assert.equal(await fs.readFile(saved, 'utf8'), contents, 'renamed original metadata is never discovered');
  }
  {
    const { lock, session } = await create(); assert.equal(await lock.release(), true);
    receipt(session, await session.releaseAfterClose()); assert.equal(await lock.release(), false);
  }
} finally { fs.rm = remove; fs.lstat = lstat; fs.readFile = readFile; await rmDirRecursive(root); }
