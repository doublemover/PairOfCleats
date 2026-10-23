import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createQueuedAppendWriter } from '../../../src/shared/io/append-writer.js';
import { getContainedFileSession } from '../../../src/shared/contained-file-resource.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';

// UNVALIDATED: public append writer with actual FileHandles and disposable files.
const root = await makeTempDir('poc-append-resource-'), open = fs.open, disposal = new Map(); let sequence = 0;
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
    for (const field of ['cause', 'errors']) {
      const descriptor = Object.getOwnPropertyDescriptor(current, field);
      if (!descriptor || !('value' in descriptor)) continue;
      if (field === 'errors' && Array.isArray(descriptor.value)) queue.push(...descriptor.value);
      else if (field === 'cause') queue.push(descriptor.value);
    }
  }
  return false;
};
const capture = ({ writeFailure, failWrite = false, syncFailure, failSync = false,
  closeFailure, failClose = false, closeResult = undefined, replaceMethods = false, syncBarrier = null,
  closeGetterFailure = null } = {}) => {
  const file = path.join(root, String(sequence++));
  const state = { file, opens: 0, writes: 0, syncs: 0, closes: 0, allowClose: !failClose,
    allowWrite: !failWrite, allowSync: !failSync, events: [] };
  fs.open = async (name, ...args) => {
    const actual = await open(name, ...args); if (name !== file) return actual;
    state.opens++; const write = actual.writeFile, sync = actual.sync, close = actual.close;
    disposal.set(actual, () => close.call(actual));
    actual.writeFile = async function (...next) {
      assert.equal(this, actual); state.writes++; state.events.push('write');
      if (!state.allowWrite) throw writeFailure;
      const result = await write.call(actual, ...next);
      if (replaceMethods) actual.writeFile = actual.sync = actual.close = () => assert.fail('append must retain original methods');
      return result;
    };
    actual.sync = async function () {
      assert.equal(this, actual); state.syncs++; state.events.push('sync');
      if (syncBarrier && state.syncs === 1) { syncBarrier.enter(); await syncBarrier.promise; }
      if (!state.allowSync) throw syncFailure; return sync.call(actual);
    };
    actual.close = async function () {
      assert.equal(this, actual); state.closes++; state.events.push('close');
      if (!state.allowClose) throw closeFailure;
      if (closeResult !== undefined) return closeResult;
      const result = await close.call(actual); disposal.delete(actual); return result;
    };
    if (closeGetterFailure !== null) Object.defineProperty(actual, 'close', {
      configurable: true, get() { throw closeGetterFailure; }
    });
    return actual;
  };
  return state;
};
try {
  {
    const state = capture({ replaceMethods: true }), errors = [];
    const writer = createQueuedAppendWriter({ filePath: state.file, syncOnFlush: true, onError: (...args) => { errors.push(args); } });
    await writer.enqueue('first λ😀\n'); await writer.enqueue('second\n');
    await writer.flush(); await Promise.all([writer.close(), writer.close()]);
    await writer.flush(); await writer.enqueue('late');
    assert.equal(await fs.readFile(state.file, 'utf8'), 'first λ😀\nsecond\n');
    assert.equal(state.opens, 1); assert.equal(state.writes, 2); assert.equal(state.closes, 1); assert.deepEqual(errors, []);
  }
  {
    const original = Object.freeze(new Error('exact append close failed'));
    const state = capture({ failClose: true, closeFailure: original });
    const writer = createQueuedAppendWriter({ filePath: state.file, syncOnFlush: true }); await writer.enqueue('accepted');
    const closing = writer.close(); assert.equal(writer.close(), closing);
    const failure = await rejected(() => closing); const session = getContainedFileSession(failure); assert.ok(session);
    assert.equal(contains(failure, original), true); assert.equal(state.closes, 1); assert.equal(failure.cacheOwnershipReleased(), false);
    await rejected(() => writer.flush()); await writer.enqueue('late'); assert.equal(state.closes, 1); assert.equal(state.writes, 1);
    state.allowClose = true; await session.releaseAfterClose(); assert.equal(state.closes, 2);
    assert.equal(state.writes, 1); assert.equal(state.syncs, 1); assert.equal(failure.cacheOwnershipReleased(), true);
    await rejected(() => writer.close()); assert.equal(state.closes, 2, 'cached failed close never retries native closure');
  }
  for (const phase of ['write', 'sync']) {
    let ready = false;
    const original = Object.assign(new Error('original append work remains pending'), { cacheOwnershipPending: false,
      cacheOwnershipReleased() { assert.equal(this, original); return ready; } });
    const state = capture(phase === 'write' ? { failWrite: true, writeFailure: original } : { failSync: true, syncFailure: original });
    const reports = [];
    const writer = createQueuedAppendWriter({ filePath: state.file, syncOnFlush: true,
      onError(stage, error) { reports.push([stage, error]); if (error === original) original.cacheOwnershipReleased = () => true; } });
    await writer.enqueue('accepted'); // Enqueue remains best effort, never a persistence receipt.
    const failure = await rejected(() => writer.flush()); const session = getContainedFileSession(failure); assert.ok(session);
    assert.equal(state.closes, 0); assert.equal(failure.cacheOwnershipReleased(), false);
    await writer.enqueue('must not start another operation'); await rejected(() => writer.close());
    await rejected(() => session.releaseAfterClose()); assert.equal(state.closes, 0);
    ready = true; await session.releaseAfterClose(); assert.equal(state.closes, 1); assert.equal(state.writes, 1);
    assert.equal(state.syncs, phase === 'write' ? 0 : 1); assert.equal(state.opens, 1);
    assert.equal(reports.some(([stage, error]) => stage === phase.replace('sync', 'flush') && error === original), true);
  }
  for (const original of [undefined, null, false, 0, '', Object.freeze(new Error('ordinary frozen append write'))]) {
    const secondary = Object.freeze(new Error('ordinary callback failure')), reports = [];
    const state = capture({ failWrite: true, writeFailure: original });
    const writer = createQueuedAppendWriter({ filePath: state.file,
      onError(stage, error) { reports.push([stage, error]); throw secondary; } });
    await writer.enqueue('best effort'); await writer.close();
    assert.equal(reports[0][0], 'write'); assert.equal(reports[0][1], original);
    assert.equal(state.closes, 1, 'settled ordinary diagnostics preserve best-effort behavior');
  }
  {
    let ready = false;
    const original = Object.freeze(new Error('ordinary native write failure'));
    const secondary = Object.assign(new Error('independent callback native work'), { cacheOwnershipReleased() { return ready; } });
    const state = capture({ failWrite: true, writeFailure: original });
    const writer = createQueuedAppendWriter({ filePath: state.file, onError() { throw secondary; } });
    await writer.enqueue('accepted'); const failure = await rejected(() => writer.close());
    assert.equal(contains(failure, original), true); assert.equal(contains(failure, secondary), true); assert.equal(state.closes, 0);
    secondary.cacheOwnershipReleased = () => true; assert.equal(failure.cacheOwnershipReleased(), false);
    ready = true; await getContainedFileSession(failure).releaseAfterClose(); assert.equal(state.closes, 1);
  }
  {
    fs.open = open; const file = path.join(root, String(sequence++)); let ready = false, opens = 0;
    const original = Object.assign(new Error('open failure owns unknown native work'), { cacheOwnershipReleased() { return ready; } });
    fs.open = async name => { assert.equal(name, file); opens++; throw original; };
    const writer = createQueuedAppendWriter({ filePath: file }); await writer.enqueue('accepted');
    const failure = await rejected(() => writer.close()); assert.equal(getContainedFileSession(failure), null);
    original.cacheOwnershipReleased = () => true; assert.equal(failure.cacheOwnershipReleased(), false);
    ready = true; assert.equal(failure.cacheOwnershipReleased(), true);
    await writer.enqueue('ignored'); await rejected(() => writer.flush()); assert.equal(opens, 1);
  }
  {
    let enter, release;
    const entered = new Promise(resolve => { enter = resolve; }), promise = new Promise(resolve => { release = resolve; });
    const state = capture({ syncBarrier: { enter, promise } });
    const writer = createQueuedAppendWriter({ filePath: state.file, syncOnFlush: true }); await writer.enqueue('first');
    const flushing = writer.flush(), closing = writer.close(); await entered;
    assert.equal(state.closes, 0); await writer.enqueue('late'); release(); await Promise.all([flushing, closing]);
    assert.deepEqual(state.events, ['write', 'sync', 'sync', 'close']); assert.equal(await fs.readFile(state.file, 'utf8'), 'first');
  }
  {
    const original = Object.freeze(new Error('original close method capture failed'));
    const state = capture({ closeGetterFailure: original }), writer = createQueuedAppendWriter({ filePath: state.file });
    await writer.enqueue('must not write without the captured close owner');
    const failure = await rejected(() => writer.close()), session = getContainedFileSession(failure); assert.ok(session);
    assert.equal(contains(failure, original), true); assert.equal(state.writes, 0); assert.equal(state.closes, 0);
    assert.equal(failure.cacheOwnershipReleased(), false, 'exact own wrapper is not recaptured as an independent self-cycle');
    await rejected(() => session.releaseAfterClose()); assert.equal(state.closes, 0); assert.equal(state.opens, 1);
  }
  {
    const state = capture({ closeResult: false }); const writer = createQueuedAppendWriter({ filePath: state.file });
    await writer.enqueue('accepted'); const failure = await rejected(() => writer.close());
    assert.ok(getContainedFileSession(failure)); assert.equal(state.closes, 1); assert.equal(failure.cacheOwnershipReleased(), false);
    await rejected(() => writer.close()); assert.equal(state.closes, 1);
    // Disposable-only final cleanup below uses the captured native method. It
    // does not establish a resource receipt for the rejected nonvoid boundary.
  }
} finally {
  fs.open = open; for (const close of disposal.values()) { try { await close(); } catch {} }
  await rmDirRecursive(root);
}
