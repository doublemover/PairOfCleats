import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  acquireFileLock, isFileLockPublicationPending, isFileLockPublicationSession
} from '../../../src/shared/locks/file-lock.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';

// UNVALIDATED: actual descriptor publication, with inert boundary injection.
const root = await makeTempDir('poc-lock-publication-observation-');
const open = fs.open, lstat = fs.lstat, rm = fs.rm, disposal = new Map();
let sequence = 0;
const next = () => path.join(root, `${sequence++}.lock`);
const rejected = async action => {
  let failed = false, failure;
  try { await action(); } catch (value) { failed = true; failure = value; }
  assert.equal(failed, true); return failure;
};
const intercept = (selected, decorate) => {
  const state = { closes: 0, writes: 0, stats: 0, replacements: 0, actual: null, owned: null };
  fs.open = async function (file, ...args) {
    const actual = await open.call(fs, file, ...args); if (file !== selected) return actual;
    state.actual = actual;
    const close = actual.close;
    disposal.set(actual, () => close.call(actual));
    const owned = {
      stat(options) { assert.equal(this, owned); state.stats += 1; return actual.stat(options); },
      writeFile(contents) { assert.equal(this, owned); state.writes += 1; return actual.writeFile(contents); },
      async close() {
        assert.equal(this, owned); state.closes += 1;
        const result = await close.call(actual); disposal.delete(actual); return result;
      }
    };
    state.owned = owned; decorate(owned, actual, state); return owned;
  };
  return state;
};
const receipt = (session, result) => assert.deepEqual(result, { resourceId: session.resourceId, settled: true, pending: false });
const recoverEmpty = async (session, file) => {
  // Close may commit timestamps on a supported native filesystem. An identity
  // mismatch must remain a failure, never guessed away by this fixture.
  try { receipt(session, await session.releaseAfterClose()); }
  catch (failure) {
    assert.ok(failure.errors.some(error => error instanceof Error
      && Object.getOwnPropertyDescriptor(error, 'message')?.value
        === 'File lock metadata identity changed or was not sealed; existing evidence is preserved.'),
    'fixture disposal is allowed only for the specific conservative identity mismatch');
    assert.equal(failure.fileLockPublication.descriptorCloseObserved, true);
    assert.equal(await fs.readFile(file, 'utf8'), '');
    await rm(file); // Disposable fixture disposal, not an inferred unlink right.
    receipt(session, await session.releaseAfterClose());
  }
};
try {
  // A throwing original observer contributes its independently pending error.
  // Changing either public method cannot change either captured receiver.
  for (const flag of [undefined, false, true]) {
    const file = next(); let primaryReady = false, secondaryReady = false, messageReads = 0;
    const secondary = Object.freeze(Object.assign(new Error('observer-owned native work'), {
      cacheOwnershipReleased() { assert.equal(this, secondary); return secondaryReady; }
    }));
    const primary = new Error('original native write');
    if (flag !== undefined) primary.cacheOwnershipPending = flag;
    primary.cacheOwnershipReleased = function () {
      assert.equal(this, primary); if (!primaryReady) throw secondary; return true;
    };
    Object.defineProperty(primary, 'message', { configurable: true, get() {
      messageReads += 1; primary.cacheOwnershipReleased = () => true; return 'original message';
    } });
    const state = intercept(file, owned => { owned.writeFile = () => { state.writes += 1; throw primary; }; });
    const failure = await rejected(() => acquireFileLock({ lockPath: file }));
    assert.equal(failure.cause, primary); assert.ok(failure.errors.includes(secondary));
    assert.equal(messageReads, 1); assert.equal(state.closes, 0);
    primaryReady = true;
    await rejected(() => failure.fileLockPublicationSession.releaseAfterClose());
    assert.equal(state.closes, 0, 'a confirmed primary cannot erase the retained secondary');
    secondaryReady = true;
    await recoverEmpty(failure.fileLockPublicationSession, file);
    assert.equal(state.closes, 1); assert.equal(state.writes, 1); assert.equal(messageReads, 1);
    assert.equal(failure.cacheOwnershipReleased(), true);
  }

  // Own-property inspection is itself admitted before close and retained once.
  // The original descriptor getter, not its replacement, keeps its receiver.
  {
    const file = next(); let ready = false, ownKeys = 0, codeReads = 0;
    const inspection = Object.freeze(Object.assign(new Error('descriptor inspection work'), {
      cacheOwnershipReleased() { assert.equal(this, inspection); return ready; }
    }));
    const target = new Error('original descriptor projection'); let primary;
    Object.defineProperty(target, 'code', { configurable: true, get() {
      assert.equal(this, primary); codeReads += 1; return 'EREADONLY';
    } });
    primary = new Proxy(target, { ownKeys(value) {
      ownKeys += 1; if (ownKeys === 1) throw inspection; return Reflect.ownKeys(value);
    } });
    const state = intercept(file, owned => { owned.writeFile = () => { throw primary; }; });
    const failure = await rejected(() => acquireFileLock({ lockPath: file }));
    assert.equal(failure.cause, primary); assert.ok(failure.errors.includes(inspection)); assert.equal(state.closes, 0);
    ready = true; await recoverEmpty(failure.fileLockPublicationSession, file);
    assert.equal(ownKeys, 1, 'reconciliation never re-inspects replacement descriptors'); assert.equal(codeReads, 0);
  }
  {
    const file = next(); let ready = false, reads = 0;
    const secondary = Object.freeze(Object.assign(new Error('getter failure owns work'), {
      cacheOwnershipReleased() { assert.equal(this, secondary); return ready; }
    }));
    const primary = Object.defineProperty(new Error('primary'), 'code', {
      configurable: true, get() { assert.equal(this, primary); reads += 1; throw secondary; }
    });
    const state = intercept(file, owned => { owned.writeFile = () => { throw primary; }; });
    const failure = await rejected(() => acquireFileLock({ lockPath: file }));
    assert.equal(state.closes, 1); // Capturing a descriptor does not invoke its getter.
    Object.defineProperty(primary, 'code', { get() { assert.fail('no replacement diagnostic'); } });
    assert.throws(() => failure.code, value => value === secondary);
    const latest = await rejected(() => failure.fileLockPublicationSession.releaseAfterClose());
    assert.ok(latest.errors.includes(secondary)); assert.equal(reads, 1);
    assert.equal(Object.getOwnPropertyDescriptor(latest, 'code').set, undefined);
    ready = true; await recoverEmpty(failure.fileLockPublicationSession, file); assert.equal(state.closes, 1);
  }
  for (const value of [undefined, null, false, 0, '', Object.freeze(new Error('frozen diagnostic rejection'))]) {
    const file = next(); let reads = 0;
    const primary = Object.freeze(Object.defineProperties(new Error('primary'), {
      message: { get() { reads += 1; throw value; } }, code: { value: 'ERO', writable: false }
    }));
    intercept(file, owned => { owned.writeFile = () => { throw primary; }; });
    const failure = await rejected(() => acquireFileLock({ lockPath: file }));
    assert.equal(failure.cause, primary); assert.ok(failure.fileLockPublicationErrors.includes(value));
    assert.equal(failure.code, 'ERO'); assert.equal(Object.getOwnPropertyDescriptor(failure, 'code').writable, false);
    await recoverEmpty(failure.fileLockPublicationSession, file); assert.equal(reads, 1);
  }

  // Native close is standard void; every other fulfillment leaves the actual
  // handle unconfirmed and the existing pathname fence present.
  for (const result of [false, true, 0, null, '', 'closed', Object.freeze({ closed: true })]) {
    const file = next(); let allow = false, closes = 0;
    const primary = Object.freeze(new Error('write was not performed'));
    const state = intercept(file, (owned, actual) => {
      const close = actual.close;
      owned.writeFile = () => { state.writes += 1; throw primary; };
      owned.close = async function () {
        assert.equal(this, owned); closes += 1;
        if (!allow) return result;
        const value = await close.call(actual); disposal.delete(actual); return value;
      };
    });
    const failure = await rejected(() => acquireFileLock({ lockPath: file }));
    const session = failure.fileLockPublicationSession;
    assert.equal(isFileLockPublicationSession(session), true); assert.equal(closes, 1);
    assert.equal(failure.fileLockPublication.descriptorCloseObserved, false); assert.equal(isFileLockPublicationPending(file), true);
    state.owned.close = () => { state.replacements += 1; };
    allow = true; await recoverEmpty(session, file);
    assert.equal(closes, 2); assert.equal(state.replacements, 0); assert.equal(state.writes, 1);
    assert.equal(isFileLockPublicationPending(file), false);
  }

  // The original work is checked again after identity lookup and after actual
  // unlink. Late settlement removes the fence without a second unlink.
  {
    const file = next(); let ready = true, lookups = 0, removals = 0;
    const primary = Object.assign(new Error('initial write failed'), {
      cacheOwnershipReleased() { assert.equal(this, primary); return ready; }
    });
    intercept(file, owned => { owned.writeFile = () => { throw primary; }; });
    const failure = await rejected(() => acquireFileLock({ lockPath: file })), session = failure.fileLockPublicationSession;
    primary.cacheOwnershipReleased = () => true;
    fs.lstat = async (name, ...args) => {
      const result = await lstat(name, ...args); if (name === file) { lookups += 1; ready = false; } return result;
    };
    fs.rm = async (name, options) => { if (name === file) removals += 1; return rm(name, options); };
    await rejected(() => session.releaseAfterClose());
    assert.equal(lookups, 1); assert.equal(removals, 0); assert.equal(isFileLockPublicationPending(file), true);
    fs.lstat = lstat; ready = true;
    fs.rm = async (name, options) => {
      const result = await rm(name, options); if (name === file) { removals += 1; ready = false; } return result;
    };
    const latest = await rejected(() => session.releaseAfterClose());
    assert.equal(latest.fileLockPublication.metadataRemoved, true); assert.equal(removals, 1);
    assert.equal(isFileLockPublicationPending(file), true); assert.equal(failure.cacheOwnershipReleased(), false);
    ready = true; receipt(session, await session.releaseAfterClose());
    assert.equal(removals, 1); assert.equal(isFileLockPublicationPending(file), false);
    fs.rm = rm;
  }
  for (const missing of [false, true]) {
    const file = next(); let ready = false, codeReads = 0, removals = 0;
    const primary = Object.freeze(new Error('original publication stopped'));
    const secondary = Object.assign(new Error('lookup has native work'), {
      cacheOwnershipReleased() { assert.equal(this, secondary); return ready; }
    });
    Object.defineProperty(secondary, 'code', { get() { codeReads += 1; return 'ENOENT'; } });
    intercept(file, owned => { owned.writeFile = () => { throw primary; }; });
    const failure = await rejected(() => acquireFileLock({ lockPath: file })), session = failure.fileLockPublicationSession;
    if (missing) await rm(file);
    fs.lstat = async (name, ...args) => { if (name === file) throw secondary; return lstat(name, ...args); };
    fs.rm = async (name, options) => { if (name === file) removals += 1; return rm(name, options); };
    const latest = await rejected(() => session.releaseAfterClose());
    assert.ok(latest.errors.includes(secondary)); assert.equal(codeReads, 0); assert.equal(removals, 0);
    assert.equal(isFileLockPublicationPending(file), true);
    secondary.cacheOwnershipReleased = () => true;
    fs.lstat = lstat; await rejected(() => session.releaseAfterClose()); assert.equal(removals, 0);
    ready = true; await recoverEmpty(session, file); assert.equal(session.isSettled(), true);
    fs.rm = rm;
  }

  // A fulfilled nonvoid rm cannot become removal evidence, either during
  // rollback or through the existing successful lock owner.
  for (const result of [false, true, 0, null, '', 'removed', Object.freeze({ removed: true })]) {
    for (const rollback of [false, true]) {
      const file = next(); let allow = false, removals = 0;
      intercept(file, owned => { if (rollback) owned.writeFile = () => { throw new Error('write not performed'); }; });
      const owner = rollback ? (await rejected(() => acquireFileLock({ lockPath: file }))).fileLockPublicationSession
        : await acquireFileLock({ lockPath: file });
      fs.rm = async (name, options) => {
        if (name === file) { removals += 1; if (!allow) return result; } return rm(name, options);
      };
      await rejected(() => rollback ? owner.releaseAfterClose() : owner.release());
      assert.equal(removals, 1); assert.equal((await fs.lstat(file)).isFile(), true);
      if (rollback) assert.equal(owner.isSettled(), false);
      allow = true;
      if (rollback) receipt(owner, await owner.releaseAfterClose()); else assert.equal(await owner.release(), true);
      assert.equal(removals, 2); fs.rm = rm;
    }
  }
  fs.open = open;
  {
    const file = next(), owner = await acquireFileLock({ lockPath: file });
    assert.equal(isFileLockPublicationPending(file), false);
    assert.equal(await owner.release(), true); assert.equal(await owner.release(), false);
  }
} finally {
  fs.open = open; fs.lstat = lstat; fs.rm = rm;
  for (const close of disposal.values()) { try { await close(); } catch {} }
  await rmDirRecursive(root);
}
