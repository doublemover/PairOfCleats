import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { replaceFile } from '../../../src/shared/io/replace-file.js';
import { copyFileWithDurability, copyFileWithDurabilitySync, renameWithRetry, renameWithRetrySync } from '../../../src/shared/io/persistence-helpers.js';
import { getContainedFileSession } from '../../../src/shared/contained-file-resource.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';

// UNVALIDATED: actual copy/rename/replace consumers and exact native boundaries.
const root = await makeTempDir('poc-persistence-resource-'), source = path.join(root, 'source'), target = path.join(root, 'target');
await fsp.writeFile(source, 'new'); await fsp.writeFile(target, 'old');
const open = fsp.open, rename = fsp.rename, copy = fsp.copyFile, remove = fsp.rm, lstat = fsp.lstat;
const openSync = fs.openSync, closeSync = fs.closeSync, renameSync = fs.renameSync;
const disposal = new Map(), syncDisposal = new Set();
const rejected = async action => {
  let failed = false, failure;
  try { await action(); } catch (value) { failed = true; failure = value; }
  assert.equal(failed, true); return failure;
};
const restore = () => {
  fsp.open = open; fsp.rename = rename; fsp.copyFile = copy; fsp.rm = remove; fsp.lstat = lstat;
  fs.openSync = openSync; fs.closeSync = closeSync; fs.renameSync = renameSync;
};
const interceptCopied = (matches, { failClose = false, replaceMethods = false, syncFailure = null } = {}) => {
  const state = { closes: 0, syncs: 0, opens: 0, path: null, allowClose: !failClose, allowSync: syncFailure === null };
  fsp.open = async (name, ...args) => {
    const actual = await open(name, ...args); if (!matches(name) || args[0] !== 'r+') return actual;
    state.opens += 1; state.path = name;
    const close = actual.close, sync = actual.sync, stat = actual.stat;
    disposal.set(actual, () => close.call(actual));
    actual.sync = async function () { assert.equal(this, actual); state.syncs += 1; if (!state.allowSync) throw syncFailure; return sync.call(actual); };
    actual.close = async function () {
      assert.equal(this, actual); state.closes += 1; if (!state.allowClose) throw Object.freeze(new Error('exact copied FileHandle close failed'));
      const result = await close.call(actual); disposal.delete(actual); return result;
    };
    actual.stat = async function (...next) {
      const value = await stat.call(actual, ...next);
      if (replaceMethods) actual.sync = actual.close = () => assert.fail('copy must use original captured methods');
      return value;
    };
    return actual;
  };
  return state;
};
const temps = async () => (await fsp.readdir(root)).filter(name => name.startsWith('.target.bak-'));
try {
  {
    const output = path.join(root, 'copied'); const state = interceptCopied(name => name === output, { replaceMethods: true });
    const identity = await copyFileWithDurability(source, output, { exclusive: true });
    assert.equal(typeof identity.ino, 'string'); assert.equal(state.opens, 1); assert.equal(state.syncs, 1); assert.equal(state.closes, 1);
    assert.equal(await fsp.readFile(output, 'utf8'), 'new'); restore(); await fsp.unlink(output);
  }
  for (const crossDevice of [false, true]) {
    let renames = 0, copies = 0, removals = 0;
    const state = interceptCopied(name => name.includes('.target.bak-'), { failClose: true });
    fsp.rename = async (from, to) => {
      renames += 1; if (crossDevice && from === source) throw Object.assign(new Error('cross-device staging'), { code: 'EXDEV' });
      return rename(from, to);
    };
    fsp.copyFile = async (...args) => { copies += 1; return copy(...args); };
    fsp.rm = async (...args) => { removals += 1; return remove(...args); };
    const failure = await rejected(() => replaceFile(source, target, { keepBackup: !crossDevice }));
    const session = getContainedFileSession(failure); assert.ok(session);
    assert.equal(state.closes, 1); assert.equal(removals, 0); assert.equal(copies, 1);
    assert.equal(await fsp.readFile(target, 'utf8'), 'old'); assert.equal(await fsp.readFile(source, 'utf8'), 'new');
    assert.equal(failure.replacementRetainedPaths.includes(state.path), true);
    assert.equal(await fsp.readFile(state.path, 'utf8'), crossDevice ? 'new' : 'old');
    const before = { renames, copies, removals }; state.allowClose = true; await session.releaseAfterClose();
    assert.equal(state.closes, 2); assert.deepEqual({ renames, copies, removals }, before, 'close-only recovery cannot replay publication/cleanup');
    restore(); await fsp.unlink(state.path);
  }
  {
    let ready = false;
    const primary = Object.assign(new Error('copy fsync original native work'), { cacheOwnershipPending: false,
      cacheOwnershipReleased() { assert.equal(this, primary); return ready; } });
    const output = path.join(root, 'pending-copy'); const state = interceptCopied(name => name === output, { syncFailure: primary });
    const failure = await rejected(() => copyFileWithDurability(source, output, { exclusive: true }));
    const session = getContainedFileSession(failure); assert.ok(session); assert.equal(state.closes, 0);
    primary.cacheOwnershipReleased = () => true; await rejected(() => session.releaseAfterClose()); assert.equal(state.closes, 0);
    ready = true; await session.releaseAfterClose(); assert.equal(state.closes, 1); assert.equal(state.syncs, 1);
    restore(); await fsp.unlink(output);
  }
  for (const syncMode of [false, true]) {
    let ready = false, calls = 0, codes = 0;
    const primary = { message: 'rename native work remains unknown', cacheOwnershipReleased() { return ready; },
      get code() { codes += 1; return 'EXDEV'; } };
    if (syncMode) fs.renameSync = () => { calls += 1; throw primary; };
    else fsp.rename = async () => { calls += 1; throw primary; };
    const failure = await rejected(() => syncMode ? renameWithRetrySync(source, target) : renameWithRetry(source, target));
    assert.equal(calls, 1); assert.equal(codes, 0, 'unknown original work is checked before classifying fallback/retry');
    primary.cacheOwnershipReleased = () => true; assert.equal(failure.cacheOwnershipReleased(), false);
    ready = true; assert.equal(failure.cacheOwnershipReleased(), true); assert.equal(calls, 1); restore();
  }
  for (const syncMode of [false, true]) {
    let ready = true, calls = 0, codes = 0;
    const primary = { message: 'code getter cannot change original observer', cacheOwnershipReleased() { return ready; },
      get code() { codes += 1; ready = false; this.cacheOwnershipReleased = () => true; return 'EXDEV'; } };
    if (syncMode) fs.renameSync = () => { calls += 1; throw primary; };
    else fsp.rename = async () => { calls += 1; throw primary; };
    const failure = await rejected(() => syncMode ? renameWithRetrySync(source, target) : renameWithRetry(source, target));
    assert.equal(calls, 1); assert.equal(codes, 1); assert.equal(failure.cacheOwnershipReleased(), false);
    ready = true; assert.equal(failure.cacheOwnershipReleased(), true); restore();
  }
  {
    let ready = true, removals = 0;
    const primary = Object.assign(new Error('retry then pending before backup cleanup'), { code: 'EACCES', cacheOwnershipReleased() { return ready; } });
    // Copy admission itself uses lstat. Flip only after its successful target
    // seal/close, at the cleanup lookup following the ordinary rename failure.
    let sealed = false;
    const copyOriginal = fsp.copyFile;
    fsp.copyFile = async (...args) => { const value = await copyOriginal(...args); sealed = true; return value; };
    fsp.lstat = async (name, ...args) => {
      const value = await lstat(name, ...args);
      if (sealed && name.includes('.target.bak-') && primary.phase === 'cleanup') ready = false;
      return value;
    };
    fsp.rename = async () => { primary.phase = 'cleanup'; throw primary; };
    fsp.rm = async (...args) => { removals += 1; return remove(...args); };
    const failure = await rejected(() => replaceFile(source, target, { keepBackup: true }));
    assert.equal(removals, 0); assert.equal(failure.cacheOwnershipReleased(), false);
    primary.cacheOwnershipReleased = () => true; assert.equal(failure.cacheOwnershipReleased(), false);
    ready = true; assert.equal(failure.cacheOwnershipReleased(), true); restore();
    for (const name of await temps()) await fsp.unlink(path.join(root, name));
  }
  {
    const output = path.join(root, 'sync-copied'); let fd = null, closes = 0;
    fs.openSync = (name, ...args) => { const result = openSync(name, ...args); if (name === output) { fd = result; syncDisposal.add(fd); } return result; };
    fs.closeSync = value => { if (value === fd) { closes += 1; return false; } return closeSync(value); };
    const failure = await rejected(() => copyFileWithDurabilitySync(source, output, { exclusive: true }));
    const session = getContainedFileSession(failure); assert.ok(session); assert.equal(closes, 1);
    await rejected(() => session.releaseAfterCloseSync()); assert.equal(closes, 1);
    closeSync(fd); syncDisposal.delete(fd); assert.equal(session.isSettled(), false); restore(); await fsp.unlink(output);
  }
  assert.deepEqual(await temps(), []);
} finally {
  restore(); for (const close of disposal.values()) { try { await close(); } catch {} }
  for (const fd of syncDisposal) { try { closeSync(fd); } catch {} }
  await rmDirRecursive(root);
}
