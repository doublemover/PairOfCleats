import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { atomicWriteTextSync, atomicWriteJsonSync } from '../../../src/shared/io/atomic-write.js';
import { getContainedFileSession } from '../../../src/shared/contained-file-resource.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';

// UNVALIDATED: original numeric FD boundaries, never retry an attempted close.
const root = await makeTempDir('poc-atomic-sync-resource-'), target = path.join(root, 'state');
const marker = path.join(root, 'not-a-parent'); await fsp.writeFile(marker, 'file');
const open = fs.openSync, write = fs.writeFileSync, close = fs.closeSync, sync = fs.fsyncSync, unlink = fs.unlinkSync;
const disposal = new Set();
const rejected = action => {
  let failed = false, failure;
  try { action(); } catch (value) { failed = true; failure = value; }
  assert.equal(failed, true); return failure;
};
const restore = () => { fs.openSync = open; fs.writeFileSync = write; fs.closeSync = close; fs.fsyncSync = sync; fs.unlinkSync = unlink; };
const intercept = ({ primary = null, failClose = false } = {}) => {
  const state = { path: null, fd: null, writes: 0, closes: 0, syncs: 0, unlinks: 0, allowWrite: primary === null };
  fs.openSync = (name, ...args) => {
    const fd = open(name, ...args); if (args[0] === 'wx') { state.fd = fd; state.path = name; disposal.add(fd); } return fd;
  };
  fs.writeFileSync = (fd, ...args) => {
    if (fd === state.fd) { state.writes += 1; if (!state.allowWrite) throw primary; } return write(fd, ...args);
  };
  fs.fsyncSync = fd => { if (fd === state.fd) state.syncs += 1; return sync(fd); };
  fs.closeSync = fd => {
    if (fd === state.fd) { state.closes += 1; if (failClose) return false; }
    const result = close(fd); disposal.delete(fd); return result;
  };
  fs.unlinkSync = name => { state.unlinks += 1; return unlink(name); };
  return state;
};
try {
  for (const work of [() => atomicWriteTextSync(target, 'new', { mkdir: false }),
    () => atomicWriteJsonSync(target, { value: false }, { mkdir: false })]) {
    await fsp.writeFile(target, 'old'); const state = intercept({ failClose: true });
    const failure = rejected(work), session = getContainedFileSession(failure);
    assert.ok(session); assert.equal(failure.atomicWritePublicationState, 'uncommitted');
    assert.equal(state.closes, 1); assert.equal(state.unlinks, 0); assert.equal(await fsp.readFile(target, 'utf8'), 'old');
    rejected(() => session.releaseAfterCloseSync()); assert.equal(state.closes, 1);
    close(state.fd); disposal.delete(state.fd);
    assert.equal(session.isSettled(), false, 'manual fixture disposal is not descriptor-generation proof'); restore();
    await fsp.unlink(state.path);
  }
  for (const markerValue of [undefined, false, true]) {
    let ready = false;
    const primary = new Error('original sync write retains native work');
    if (markerValue !== undefined) primary.cacheOwnershipPending = markerValue;
    primary.cacheOwnershipReleased = function () { assert.equal(this, primary); return ready; };
    const state = intercept({ primary });
    const failure = rejected(() => atomicWriteTextSync(target, 'new', { mkdir: false }));
    const session = getContainedFileSession(failure); assert.ok(session); assert.equal(state.closes, 0); assert.equal(state.unlinks, 0);
    primary.cacheOwnershipReleased = () => true; rejected(() => session.releaseAfterCloseSync());
    assert.equal(state.closes, 0); ready = true; session.releaseAfterCloseSync();
    assert.equal(state.closes, 1); assert.equal(state.writes, 1); assert.equal(state.unlinks, 0);
    restore(); await fsp.unlink(state.path);
  }
  {
    let parentFd = null, parentCloses = 0;
    fs.openSync = (name, ...args) => {
      if (name !== root) return open(name, ...args);
      parentFd = open(marker, 'r'); disposal.add(parentFd); return parentFd;
    };
    fs.closeSync = fd => { if (fd === parentFd) { parentCloses += 1; throw Object.freeze(new Error('original parent-close failure')); } return close(fd); };
    const failure = rejected(() => atomicWriteTextSync(target, 'committed', { mkdir: false }));
    assert.equal(failure.atomicWritePublicationState, 'committed'); assert.equal(await fsp.readFile(target, 'utf8'), 'committed');
    const session = getContainedFileSession(failure); assert.ok(session); assert.equal(parentCloses, 1);
    rejected(() => session.releaseAfterCloseSync()); assert.equal(parentCloses, 1);
    close(parentFd); disposal.delete(parentFd); restore();
  }
  {
    const state = intercept();
    atomicWriteTextSync(target, 'not-durable', { mkdir: false, durable: false });
    assert.equal(state.syncs, 0); assert.equal(state.closes, 1); assert.equal(await fsp.readFile(target, 'utf8'), 'not-durable'); restore();
  }
} finally {
  restore(); for (const fd of disposal) { try { close(fd); } catch {} }
  await rmDirRecursive(root);
}
