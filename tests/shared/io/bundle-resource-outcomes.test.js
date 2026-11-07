import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { readBundleFile, writeBundleFile, writeBundlePatch, resolveBundlePatchPath,
  resolveBundlePatchMetaPath, resolveBundlePatchLockPath } from '../../../src/shared/bundle-io.js';
import { readBundlePatches } from '../../../src/shared/bundle-io/patch.js';
import { writeBundleJsonChecksum } from '../../../src/shared/bundle-io/support.js';
import { resolveBundleJsonChecksumPath } from '../../../src/shared/bundle-io-paths.js';
import { MAX_BUNDLE_CHECKSUM_BYTES } from '../../../src/shared/bundle-contract.js';
import { getContainedFileSession } from '../../../src/shared/contained-file-resource.js';
import { isFileLockPublicationSession } from '../../../src/shared/locks/file-lock.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';

// Actual bundle consumers and exact FileHandle/lock recovery.
const root = await makeTempDir('poc-bundle-resource-'), open = fs.open, remove = fs.rm, lstat = fs.lstat;
const disposal = new Map(); let sequence = 0;
const before = { file: 'a.js', hash: 'one', chunks: [{ text: 'one' }] };
const after = { ...before, hash: 'two', chunks: [{ text: 'two' }] };
const last = { ...after, hash: 'three', chunks: [{ text: 'three' }] };
const restore = () => { fs.open = open; fs.rm = remove; fs.lstat = lstat; };
const rejected = async action => {
  let present = false, failure;
  try { await action(); } catch (error) { present = true; failure = error; }
  assert.equal(present, true); return failure;
};
const contains = (error, expected) => {
  const queue = [error], seen = new Set();
  while (queue.length) {
    const current = queue.pop(); if (current === expected) return true;
    if (current === null || !['object', 'function'].includes(typeof current) || seen.has(current)) continue;
    seen.add(current);
    for (const field of ['cause', 'errors', 'workerError']) {
      const descriptor = Object.getOwnPropertyDescriptor(current, field); if (!descriptor || !('value' in descriptor)) continue;
      if (field === 'errors' && Array.isArray(descriptor.value)) queue.push(...descriptor.value);
      else if (field !== 'errors') queue.push(descriptor.value);
    }
  }
  return false;
};
const fixture = async (patched = false) => {
  restore(); const file = path.join(root, String(sequence++) + '.json');
  await writeBundleFile({ bundlePath: file, bundle: before });
  if (patched) assert.equal((await writeBundlePatch({ bundlePath: file, previousBundle: before, nextBundle: after })).applied, true);
  return file;
};
const interceptClose = (target, mode = 'r') => {
  const primary = Object.freeze(new Error('actual bundle descriptor close failed'));
  const state = { closes: 0, writes: 0, opens: 0, allowClose: false };
  fs.open = async (file, ...args) => {
    const handle = await open(file, ...args);
    const matchesMode = args[0] === mode || mode === 'r' && typeof args[0] === 'number'
      && (args[0] & (constants.O_WRONLY | constants.O_RDWR)) === constants.O_RDONLY;
    if (file !== target || !matchesMode) return handle;
    const close = handle.close, write = handle.writeFile; disposal.set(handle, () => close.call(handle)); state.opens++;
    handle.writeFile = async function (...next) { state.writes++; return write.call(handle, ...next); };
    handle.close = async function () {
      assert.equal(this, handle); state.closes++; if (!state.allowClose) throw primary;
      const result = await close.call(handle); disposal.delete(handle); return result;
    };
    return handle;
  };
  return { state, primary };
};
const recover = async (failure, state, lockPath = null) => {
  const session = getContainedFileSession(failure); assert.ok(session); assert.equal(state.closes, 1);
  state.allowClose = true; await session.releaseAfterClose(); assert.equal(state.closes, 2);
  if (lockPath) {
    const lockSession = failure.fileLockPublicationSession; assert.equal(isFileLockPublicationSession(lockSession), true);
    assert.equal((await lockSession.releaseAfterClose()).pending, false);
    await assert.rejects(fs.lstat(lockPath), { code: 'ENOENT' });
  }
};
try {
  for (const selected of ['bundle', 'checksum', 'patch']) {
    const file = await fixture(selected === 'patch');
    const target = selected === 'bundle' ? file : selected === 'patch' ? resolveBundlePatchPath(file) : resolveBundleJsonChecksumPath(file);
    const { state, primary } = interceptClose(target);
    const failure = await rejected(() => selected === 'patch' ? readBundlePatches(file)
      : readBundleFile(file, selected === 'bundle' ? { maxBytes: 1 } : {}));
    assert.equal(contains(failure, primary), true); assert.equal(failure.reason, undefined, 'retained close cannot become an optional invalid/too-large result');
    await recover(failure, state); restore();
  }
  {
    const file = await fixture(true), meta = resolveBundlePatchMetaPath(file), lockPath = resolveBundlePatchLockPath(file);
    const previous = await fs.readFile(resolveBundlePatchPath(file)); const { state } = interceptClose(meta);
    const failure = await rejected(() => writeBundlePatch({ bundlePath: file, previousBundle: after, nextBundle: last }));
    assert.equal((await fs.lstat(lockPath)).isFile(), true, 'original patch admission remains held through failed metadata read close');
    assert.deepEqual(await fs.readFile(resolveBundlePatchPath(file)), previous, 'failed hint read cannot authorize append');
    await recover(failure, state, lockPath); restore();
  }
  {
    const file = await fixture(true), patchPath = resolveBundlePatchPath(file), lockPath = resolveBundlePatchLockPath(file);
    const checksum = await fs.readFile(resolveBundleJsonChecksumPath(file)), meta = await fs.readFile(resolveBundlePatchMetaPath(file));
    const { state, primary } = interceptClose(patchPath, 'a');
    const failure = await rejected(() => writeBundlePatch({ bundlePath: file, previousBundle: after, nextBundle: last }));
    assert.equal(contains(failure, primary), true); assert.equal(state.writes, 1);
    assert.deepEqual(await fs.readFile(resolveBundleJsonChecksumPath(file)), checksum);
    assert.deepEqual(await fs.readFile(resolveBundlePatchMetaPath(file)), meta);
    await recover(failure, state, lockPath); assert.equal(state.writes, 1, 'recovery closes/unlocks without replaying a patch'); restore();
  }
  for (const primary of [undefined, null, false, 0, '', Object.freeze(new Error('original patch stat failure'))]) {
    const file = await fixture(true), patchPath = resolveBundlePatchPath(file);
    fs.lstat = async (target, ...args) => { if (target === patchPath) throw primary; return lstat(target, ...args); };
    const failure = await rejected(() => writeBundlePatch({ bundlePath: file, previousBundle: after, nextBundle: last }));
    assert.equal(contains(failure, primary), true); restore(); await assert.rejects(fs.lstat(resolveBundlePatchLockPath(file)), { code: 'ENOENT' });
  }
  {
    const file = await fixture(), checksumPath = resolveBundleJsonChecksumPath(file);
    const primary = Object.freeze(Object.assign(new Error('stale checksum could not be retired'), { code: 'EIO' }));
    fs.rm = async (target, ...args) => { if (target === checksumPath) throw primary; return remove(target, ...args); };
    const failure = await rejected(() => writeBundleFile({ bundlePath: file, bundle: before, format: 'msgpack' }));
    assert.equal(contains(failure, primary), true); assert.equal((await fs.lstat(checksumPath)).isFile(), true); restore();
  }
  {
    const file = await fixture(), checksumPath = resolveBundleJsonChecksumPath(file); let ready = false, calls = 0;
    const primary = Object.assign(new Error('checksum removal still owns native work'), { cacheOwnershipReleased() { return ready; } });
    fs.rm = async (target, ...args) => { if (target === checksumPath) { calls++; throw primary; } return remove(target, ...args); };
    const failure = await rejected(() => writeBundleJsonChecksum(file, { file: 'large', chunks: [{ text: 'x'.repeat(MAX_BUNDLE_CHECKSUM_BYTES + 1) }] }));
    assert.equal(calls, 1); assert.equal(failure.cacheOwnershipReleased(), false);
    primary.cacheOwnershipReleased = () => true; assert.equal(failure.cacheOwnershipReleased(), false);
    ready = true; assert.equal(failure.cacheOwnershipReleased(), true); restore();
  }
  {
    const file = await fixture(true); const read = await readBundleFile(file); assert.equal(read.ok, true); assert.equal(read.bundle.hash, 'two');
    assert.equal((await readBundleFile(file, { maxBytes: 1 })).reason, 'bundle too large', 'settled ordinary bounds retain optional behavior');
    await fs.unlink(resolveBundleJsonChecksumPath(file)); assert.equal((await readBundleFile(file)).ok, true, 'settled absent optional checksum remains compatible');
  }
} finally {
  restore(); for (const close of disposal.values()) { try { await close(); } catch {} }
  await rmDirRecursive(root);
}
