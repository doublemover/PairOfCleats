import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  acquireFileLock, releaseFileLockOrThrow, readLockInfo, isFileLockPublicationPending
} from '../../../src/shared/locks/file-lock.js';
import { getContainedFileSession, isContainedFileSession } from '../../../src/shared/contained-file-resource.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';

// UNVALIDATED: actual published metadata FD, release and nested recovery.
const root = await makeTempDir('poc-lock-release-reader-'), open = fs.open, remove = fs.rm;
const disposal = new Map(); let sequence = 0;
const rejected = async action => {
  let failed = false, failure;
  try { await action(); } catch (value) { failed = true; failure = value; }
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
const create = async () => {
  const file = path.join(root, `${sequence++}.lock`), lock = await acquireFileLock({ lockPath: file });
  return { file, lock, session: lock.fileLockPublicationSession };
};
const intercept = (file, decorate) => {
  const state = { opens: 0, reads: 0, stats: 0, closes: 0, removes: 0, handles: [] };
  fs.open = async (name, flags, ...args) => {
    const actual = await open(name, flags, ...args); if (name !== file || flags !== 'r') return actual;
    const close = actual.close, read = actual.read, stat = actual.stat;
    disposal.set(actual, () => close.call(actual)); state.opens += 1; state.handles.push(actual);
    const originals = { read: (...next) => read.call(actual, ...next), stat: (...next) => stat.call(actual, ...next),
      close: async () => { const result = await close.call(actual); disposal.delete(actual); return result; } };
    actual.read = function (...next) { assert.equal(this, actual); state.reads += 1; return originals.read(...next); };
    actual.stat = function (...next) { assert.equal(this, actual); state.stats += 1; return originals.stat(...next); };
    actual.close = function () { assert.equal(this, actual); state.closes += 1; return originals.close(); };
    decorate(actual, originals, state); return actual;
  };
  fs.rm = async (name, options) => { if (name === file) state.removes += 1; return remove(name, options); };
  return state;
};
try {
  for (const refusal of [Object.freeze(new Error('original metadata descriptor close refused')),
    false, true, 0, null, '', 'closed', Object.freeze({ closed: true })]) {
    const { file, lock, session } = await create(); let allow = false;
    const state = intercept(file, (actual, original) => {
      actual.close = function () {
        assert.equal(this, actual); state.closes += 1;
        if (!allow) { if (refusal instanceof Error) throw refusal; return refusal; } return original.close();
      };
    });
    const failure = await rejected(() => releaseFileLockOrThrow(lock)), child = getContainedFileSession(failure);
    assert.ok(child); assert.equal(isContainedFileSession({ ...child }), false);
    assert.deepEqual(failure.containedFileSessions, [child]); assert.equal(failure.fileLockPublicationSession, session);
    assert.equal(Object.getOwnPropertyDescriptor(failure, 'containedFileSession').enumerable, false);
    assert.equal(failure.cacheOwnershipReleased(), false); assert.equal(state.opens, 1); assert.equal(state.closes, 1);
    assert.equal(state.removes, 0); assert.equal(isFileLockPublicationPending(file), true);
    await rejected(() => lock.release()); await rejected(() => session.releaseAfterClose());
    assert.equal(state.opens, 1); assert.equal(state.closes, 1); assert.equal(state.removes, 0);
    state.handles[0].close = () => assert.fail('failed metadata FD must keep original close method');
    const reads = state.reads, stats = state.stats; allow = true;
    assert.deepEqual(await child.releaseAfterClose(), { resourceId: child.resourceId, settled: true, pending: false });
    assert.equal(state.reads, reads); assert.equal(state.stats, stats); assert.equal(state.closes, 2);
    assert.equal(session.isSettled(), false); assert.equal(state.removes, 0);
    assert.equal(await lock.release(), true); assert.equal(state.opens, 2); assert.equal(state.removes, 1);
    assert.equal(session.isSettled(), true); assert.equal(isFileLockPublicationPending(file), false);
    fs.open = open; fs.rm = remove;
  }
  for (const marker of [undefined, false, true]) {
    const { file, lock } = await create(); let ready = false, allow = false;
    const primary = new Error('actual metadata read owns native work');
    if (marker !== undefined) primary.cacheOwnershipPending = marker;
    primary.cacheOwnershipReleased = function () { assert.equal(this, primary); return ready; };
    const state = intercept(file, (actual, original) => {
      actual.read = function (...args) {
        assert.equal(this, actual); state.reads += 1; if (!allow) throw primary; return original.read(...args);
      };
    });
    const failure = await rejected(() => releaseFileLockOrThrow(lock)), child = getContainedFileSession(failure);
    assert.ok(child); assert.equal(contains(failure, primary), true); assert.equal(state.closes, 0); assert.equal(state.removes, 0);
    primary.cacheOwnershipReleased = () => true; allow = true;
    await rejected(() => child.releaseAfterClose()); await rejected(() => lock.release());
    assert.equal(state.closes, 0); assert.equal(state.opens, 1); assert.equal(state.reads, 1);
    ready = true; await child.releaseAfterClose(); assert.equal(state.closes, 1); assert.equal(state.reads, 1);
    assert.equal(await lock.release(), true); assert.equal(state.opens, 2); assert.equal(state.reads, 2); assert.equal(state.removes, 1);
    fs.open = open; fs.rm = remove;
  }
  for (const primary of [undefined, null, false, 0, '', Object.freeze(new Error('frozen metadata read rejection'))]) {
    const { file, lock } = await create(); let allow = false;
    const secondary = Object.freeze(new Error('independent metadata close rejection'));
    const state = intercept(file, (actual, original) => {
      actual.read = function (...args) { state.reads += 1; if (!allow) throw primary; return original.read(...args); };
      actual.close = function () { state.closes += 1; if (!allow) throw secondary; return original.close(); };
    });
    const failure = await rejected(() => releaseFileLockOrThrow(lock)), child = getContainedFileSession(failure);
    assert.ok(child); assert.equal(contains(failure, primary), true); assert.equal(contains(failure, secondary), true);
    assert.equal(state.removes, 0); allow = true; await child.releaseAfterClose();
    assert.equal(state.reads, 1); assert.equal(await lock.release(), true); assert.equal(state.removes, 1);
    fs.open = open; fs.rm = remove;
  }
  {
    const { file, lock } = await create(); let replacements = 0;
    const state = intercept(file, (actual, original) => {
      actual.read = function (buffer, offset, length, position) {
        assert.equal(this, actual); state.reads += 1;
        actual.read = actual.stat = actual.close = () => { replacements += 1; assert.fail('original metadata methods only'); };
        return original.read(buffer, offset, Math.min(3, length), position);
      };
    });
    const bytes = Buffer.byteLength(await fs.readFile(file, 'utf8'));
    assert.equal(await releaseFileLockOrThrow(lock), true); assert.equal(state.reads, Math.ceil(bytes / 3));
    assert.equal(state.stats, 2); assert.equal(state.closes, 1); assert.equal(state.removes, 1); assert.equal(replacements, 0);
    fs.open = open; fs.rm = remove;
  }
  for (const bad of [0, -1, true, Number.NaN, 1.5, 1000000]) {
    const { file, lock } = await create(); let allow = false;
    const state = intercept(file, (actual, original) => {
      actual.read = (...args) => { state.reads += 1; return allow ? original.read(...args) : { bytesRead: bad }; };
    });
    const failure = await rejected(() => releaseFileLockOrThrow(lock));
    assert.equal(state.closes, 1); assert.equal(state.removes, 0); assert.equal(getContainedFileSession(failure), null);
    allow = true; assert.equal(await lock.release(), true); assert.equal(state.removes, 1);
    fs.open = open; fs.rm = remove;
  }
  {
    const { file, lock } = await create();
    const expected = await readLockInfo(file); assert.equal(expected.lockId, lock.payload.lockId);
    assert.equal(await lock.release(), true); assert.equal(await readLockInfo(file), null,
      'ordinary diagnostic/stale read fallback remains separate');
  }
} finally {
  fs.open = open; fs.rm = remove;
  for (const close of disposal.values()) { try { await close(); } catch {} }
  await rmDirRecursive(root);
}
