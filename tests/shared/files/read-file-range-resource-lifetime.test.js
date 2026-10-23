import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { readFileRangeSync } from '../../../src/shared/file-read.js';
import { getContainedFileSession, isContainedFileSession } from '../../../src/shared/contained-file-resource.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';

// UNVALIDATED: actual sync range consumer, no fd generation assumption.
const root = await makeTempDir('poc-file-range-resource-'), file = path.join(root, 'source.txt');
await fsp.writeFile(file, 'abcdefghijklmnopqrstuvwxyz');
const open = fs.openSync, read = fs.readSync, close = fs.closeSync, stat = fs.fstatSync;
const descriptors = new Set();
const rejected = action => {
  let failed = false, failure;
  try { action(); } catch (value) { failed = true; failure = value; }
  assert.equal(failed, true); return failure;
};
const contains = (value, expected) => {
  const queue = [value], seen = new Set();
  while (queue.length) {
    const current = queue.pop(); if (current === expected) return true;
    if (current === null || !['object', 'function'].includes(typeof current) || seen.has(current)) continue;
    seen.add(current);
    const cause = Object.getOwnPropertyDescriptor(current, 'cause'), errors = Object.getOwnPropertyDescriptor(current, 'errors');
    if (cause && 'value' in cause) queue.push(cause.value);
    if (Array.isArray(errors?.value)) queue.push(...errors.value);
  }
  return false;
};
const restore = () => { fs.openSync = open; fs.readSync = read; fs.closeSync = close; fs.fstatSync = stat; };
const observeOpen = () => {
  fs.openSync = (name, ...args) => { const fd = open(name, ...args); if (name === file) descriptors.add(fd); return fd; };
};
try {
  for (const contained of [false, true]) {
    const selectedRoot = contained ? root : null;
    let reads = 0, closes = 0, replacements = 0;
    observeOpen();
    fs.readSync = function (fd, buffer, offset, length, position) {
      assert.equal(this, fs); reads += 1;
      fs.readSync = () => { replacements += 1; assert.fail('must keep original read'); };
      fs.closeSync = () => { replacements += 1; assert.fail('must keep original close'); };
      return read.call(fs, fd, buffer, offset, Math.min(2, length), position);
    };
    fs.closeSync = function (fd) { assert.equal(this, fs); closes += 1; const result = close(fd); descriptors.delete(fd); return result; };
    assert.equal(readFileRangeSync(file, 1.9, 9.2, selectedRoot).toString(), 'bcdefghi');
    assert.equal(reads, 4); assert.equal(closes, 1); assert.equal(replacements, 0); restore();
    assert.equal(readFileRangeSync(file, 24, 40, selectedRoot).toString(), 'yz');
    assert.equal(readFileRangeSync(file, -12, 3, selectedRoot).toString(), 'abc');
    assert.equal(readFileRangeSync(file, 50, 60, selectedRoot).length, 0);
  }

  // Original read observers precede actual native destruction. A first close
  // may be admitted explicitly once original work confirms, without a reread.
  for (const contained of [false, true]) for (const marker of [undefined, false, true]) {
    let ready = false, reads = 0, closes = 0;
    const primary = new Error('range read still owns native work');
    if (marker !== undefined) primary.cacheOwnershipPending = marker;
    primary.cacheOwnershipReleased = function () { assert.equal(this, primary); return ready; };
    observeOpen(); fs.readSync = function () { assert.equal(this, fs); reads += 1; throw primary; };
    fs.closeSync = function (fd) { assert.equal(this, fs); closes += 1; const result = close(fd); descriptors.delete(fd); return result; };
    const failure = rejected(() => readFileRangeSync(file, 0, 4, contained ? root : null));
    const session = getContainedFileSession(failure);
    assert.ok(session); assert.equal(isContainedFileSession({ ...session }), false);
    assert.equal(contains(failure, primary), true); assert.equal(closes, 0); assert.equal(reads, 1);
    primary.cacheOwnershipReleased = () => true;
    rejected(() => session.releaseAfterCloseSync()); assert.equal(closes, 0);
    ready = true;
    assert.deepEqual(session.releaseAfterCloseSync(), { resourceId: session.resourceId, settled: true, pending: false });
    assert.equal(closes, 1); assert.equal(reads, 1); assert.equal(failure.cacheOwnershipReleased(), true); restore();
  }

  // A synchronous failed close has uncertain numeric generation. Neither a
  // method replacement, an inode check nor external disposal permits retry.
  for (const contained of [false, true]) for (const result of [false, true, 0, null, '', 'closed', Object.freeze({ closed: true })]) {
    let closes = 0, reads = 0;
    observeOpen();
    fs.readSync = function (...args) { reads += 1; return read.apply(fs, args); };
    fs.closeSync = function () { assert.equal(this, fs); closes += 1; return result; };
    const failure = rejected(() => readFileRangeSync(file, 0, 4, contained ? root : null)), session = getContainedFileSession(failure);
    assert.ok(session); assert.equal(closes, 1); assert.equal(reads, 1);
    fs.closeSync = () => assert.fail('unknown fd generation may not invoke replacement');
    rejected(() => session.releaseAfterCloseSync()); assert.equal(closes, 1); assert.equal(reads, 1);
    const originalFd = [...descriptors][0]; close(originalFd); descriptors.delete(originalFd);
    const another = open(file, 'r');
    try {
      // Numeric reuse, if the OS happens to choose it, grants no authority.
      rejected(() => session.releaseAfterCloseSync()); assert.equal(closes, 1);
      const data = Buffer.alloc(4); assert.equal(read(another, data, 0, 4, 0), 4); assert.equal(data.toString(), 'abcd');
    } finally { close(another); }
    assert.equal(session.isSettled(), false); restore();
  }

  for (const contained of [false, true]) for (const primary of [undefined, null, false, 0, '', Object.freeze(new Error('frozen original read'))]) {
    const secondary = Object.freeze(new Error('independent actual close failure')); let reads = 0, closes = 0;
    observeOpen(); fs.readSync = () => { reads += 1; throw primary; };
    fs.closeSync = () => { closes += 1; throw secondary; };
    const failure = rejected(() => readFileRangeSync(file, 0, 4, contained ? root : null));
    assert.equal(contains(failure, primary), true); assert.equal(contains(failure, secondary), true);
    const session = getContainedFileSession(failure); assert.ok(session); assert.equal(reads, 1); assert.equal(closes, 1);
    rejected(() => session.releaseAfterCloseSync()); assert.equal(closes, 1); assert.equal(reads, 1);
    for (const fd of descriptors) { close(fd); descriptors.delete(fd); } restore();
  }
  for (const progress of [undefined, null, false, true, -1, 5, Number.NaN, 1.5]) {
    let closes = 0, reads = 0;
    observeOpen(); fs.readSync = () => { reads += 1; return progress; };
    fs.closeSync = fd => { closes += 1; const result = close(fd); descriptors.delete(fd); return result; };
    const failure = rejected(() => readFileRangeSync(file, 0, 4));
    assert.equal(failure.message, 'Invalid file range read progress.'); assert.equal(reads, 1); assert.equal(closes, 1);
    assert.equal(getContainedFileSession(failure), null, 'confirmed close does not invent a live native capability'); restore();
  }
  fs.openSync = () => assert.fail('empty range must not open a descriptor');
  assert.equal(readFileRangeSync(file, 5, 4).length, 0); assert.equal(readFileRangeSync(file, 0, Number.NaN).length, 0);
  restore();
  assert.equal(await fsp.readFile(file, 'utf8'), 'abcdefghijklmnopqrstuvwxyz');
} finally {
  restore(); for (const fd of descriptors) { try { close(fd); } catch {} }
  await rmDirRecursive(root);
}
