import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { readLockInfo, readLockInfoSync, readLockSnapshot, isStableStaleSnapshot,
  createLockPayload, removeLockFileSyncIfOwned } from '../../../src/shared/locks/file-lock-info.js';
import { removeLockFileIfOwned } from '../../../src/shared/locks/file-lock-owner.js';
import { isLockStale, isBenignStaleRemovalRace, createStaleRemovalFailureError } from '../../../src/shared/locks/file-lock-stale.js';
import { acquireFileLock } from '../../../src/shared/locks/file-lock.js';
import { getContainedFileSession } from '../../../src/shared/contained-file-resource.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';

// Source-authored only; real disposable metadata and exact descriptor boundaries.
const root = await makeTempDir('poc-lock-metadata-resource-'), file = path.join(root, 'metadata.lock');
const payload = createLockPayload({ scope: 'metadata-lifetime' });
const contents = JSON.stringify(payload);
await fsp.writeFile(file, contents);
const open = fsp.open, remove = fsp.rm, stat = fsp.stat;
const openSync = fs.openSync, readSync = fs.readSync, closeSync = fs.closeSync, removeSync = fs.rmSync;
const disposal = new Map(), syncDisposal = new Set();
const rejected = async action => {
  let failed = false, failure;
  try { await action(); } catch (value) { failed = true; failure = value; }
  assert.equal(failed, true); return failure;
};
const intercept = ({ primary = null, failClose = false, short = false, replace = false } = {}) => {
  const state = { opens: 0, reads: 0, closes: 0, removals: 0, stats: 0, allowClose: !failClose, allowRead: primary === null };
  fsp.open = async (name, ...args) => {
    const actual = await open(name, ...args); if (name !== file) return actual;
    state.opens += 1;
    const read = actual.read, close = actual.close, getStat = actual.stat;
    disposal.set(actual, () => close.call(actual));
    actual.stat = async function (...next) {
      assert.equal(this, actual); state.stats += 1;
      if (replace) { actual.stat = actual.read = actual.close = () => assert.fail('original metadata methods must remain captured'); }
      return getStat.call(actual, ...next);
    };
    actual.read = async function (buffer, offset, length, position) {
      assert.equal(this, actual); state.reads += 1;
      if (!state.allowRead) throw primary;
      return read.call(actual, buffer, offset, short ? Math.min(length, 7) : length, position);
    };
    actual.close = async function () {
      assert.equal(this, actual); state.closes += 1;
      if (!state.allowClose) throw Object.freeze(new Error('original lock metadata close failed'));
      const result = await close.call(actual); disposal.delete(actual); return result;
    };
    return actual;
  };
  fsp.rm = async (name, ...args) => { if (name === file) state.removals += 1; return remove(name, ...args); };
  return state;
};
const restore = () => {
  fsp.open = open; fsp.rm = remove; fsp.stat = stat;
  fs.openSync = openSync; fs.readSync = readSync; fs.closeSync = closeSync; fs.rmSync = removeSync;
};
try {
  assert.deepEqual(await readLockInfo(file), payload); assert.deepEqual(readLockInfoSync(file), payload);
  assert.equal(await readLockInfo(path.join(root, 'missing')), null);
  assert.equal(readLockInfoSync(path.join(root, 'missing')), null);
  {
    const state = intercept({ short: true, replace: true });
    fsp.stat = () => assert.fail('snapshot stat and raw bytes must come from the same opened descriptor');
    const snapshot = await readLockSnapshot(file, 1000000);
    assert.equal(snapshot.exists, true); assert.equal(snapshot.staleByMtime, false); assert.ok(snapshot.fingerprint);
    assert.equal(state.opens, 1); assert.equal(state.stats, 2); assert.equal(state.closes, 1); assert.ok(state.reads > 1); restore();
  }
  const actions = [() => readLockInfo(file), () => readLockSnapshot(file, 1), () => isLockStale(file, 1),
    () => removeLockFileIfOwned(file, payload, { force: true }), () => acquireFileLock({ lockPath: file, waitMs: 0 })];
  for (const action of actions) {
    const state = intercept({ failClose: true });
    const failure = await rejected(action), session = getContainedFileSession(failure);
    assert.ok(session); assert.equal(failure.cacheOwnershipReleased(), false);
    assert.equal(state.removals, 0); assert.equal(state.closes, 1);
    const reads = state.reads; state.allowClose = true; await session.releaseAfterClose();
    assert.equal(state.closes, 2); assert.equal(state.reads, reads); assert.equal(state.removals, 0);
    assert.equal(await fsp.readFile(file, 'utf8'), contents); restore();
  }
  for (const action of actions) {
    let ready = false;
    const primary = Object.assign(new Error('original metadata read still owns native work'), {
      cacheOwnershipPending: false, cacheOwnershipReleased() { assert.equal(this, primary); return ready; }
    });
    const state = intercept({ primary });
    const failure = await rejected(action), session = getContainedFileSession(failure);
    assert.ok(session); assert.equal(state.closes, 0); assert.equal(state.removals, 0);
    primary.cacheOwnershipReleased = () => true; await rejected(() => session.releaseAfterClose());
    assert.equal(state.closes, 0); ready = true; await session.releaseAfterClose();
    assert.equal(state.reads, 1); assert.equal(state.closes, 1); assert.equal(state.removals, 0); restore();
  }
  for (const action of [() => readLockInfoSync(file), () => removeLockFileSyncIfOwned(file, payload, { force: true })]) {
    let closes = 0, removals = 0;
    fs.openSync = (name, ...args) => { const fd = openSync(name, ...args); if (name === file) syncDisposal.add(fd); return fd; };
    fs.closeSync = fd => { if (syncDisposal.has(fd)) { closes += 1; return false; } return closeSync(fd); };
    fs.rmSync = (name, ...args) => { if (name === file) removals += 1; return removeSync(name, ...args); };
    const failure = await rejected(action), session = getContainedFileSession(failure);
    assert.ok(session); assert.equal(closes, 1); assert.equal(removals, 0);
    await rejected(() => session.releaseAfterCloseSync()); assert.equal(closes, 1);
    for (const fd of syncDisposal) { closeSync(fd); syncDisposal.delete(fd); }
    assert.equal(session.isSettled(), false, 'manual disposable cleanup is not numeric generation evidence'); restore();
  }
  {
    let ready = false, codes = 0;
    const primary = { cacheOwnershipReleased() { assert.equal(this, primary); return ready; },
      get code() { codes += 1; return 'ENOENT'; } };
    const failure = await rejected(() => isBenignStaleRemovalRace(primary));
    assert.equal(codes, 0); primary.cacheOwnershipReleased = () => true;
    assert.equal(failure.cacheOwnershipReleased(), false); ready = true; assert.equal(failure.cacheOwnershipReleased(), true);
  }
  {
    let ready = true, codes = 0;
    const primary = { cacheOwnershipReleased() { return ready; },
      get code() { codes += 1; ready = false; this.cacheOwnershipReleased = () => true; return 'ENOENT'; } };
    const failure = await rejected(() => isBenignStaleRemovalRace(primary));
    assert.equal(codes, 1); assert.equal(failure.cacheOwnershipReleased(), false);
    ready = true; assert.equal(failure.cacheOwnershipReleased(), true);
  }
  for (const cause of [undefined, null, false, 0, '', Object.freeze(Object.assign(new Error('frozen removal'), { code: 'EACCES' }))]) {
    const failure = createStaleRemovalFailureError({ lockPath: file, cause });
    assert.equal(failure.code, 'ERR_FILE_LOCK_STALE_REMOVE_FAILED'); assert.equal(failure.cause, cause);
  }
  {
    let ready = false, opens = 0;
    const primary = Object.assign(new Error('original open still pending'), { code: 'ENOENT',
      cacheOwnershipReleased() { return ready; } });
    fsp.open = async name => { assert.equal(name, file); opens += 1; throw primary; };
    const failure = await rejected(() => acquireFileLock({ lockPath: file, waitMs: 0 }));
    assert.equal(opens, 1); primary.cacheOwnershipReleased = () => true;
    assert.equal(failure.cacheOwnershipReleased(), false); ready = true; assert.equal(failure.cacheOwnershipReleased(), true); restore();
  }
  await fsp.writeFile(file, '{malformed');
  assert.equal(await readLockInfo(file), null); assert.equal(readLockInfoSync(file), null);
  const old = new Date(Date.now() - 60000); await fsp.utimes(file, old, old);
  const before = await readLockSnapshot(file, 1000); assert.equal(before.exists, true); assert.equal(before.staleByMtime, true);
  const saved = path.join(root, 'saved.lock'); await fsp.rename(file, saved); await fsp.writeFile(file, '{malformed'); await fsp.utimes(file, old, old);
  const after = await readLockSnapshot(file, 1000);
  assert.equal(isStableStaleSnapshot(before, after), false, 'same bytes and mtime on a new object are not the same stale snapshot');
  assert.equal(await removeLockFileIfOwned(file, null, { force: true }), true, 'ordinary force/malformed semantics remain');
} finally {
  restore(); for (const close of disposal.values()) { try { await close(); } catch {} }
  for (const fd of syncDisposal) { try { closeSync(fd); } catch {} }
  await rmDirRecursive(root);
}
