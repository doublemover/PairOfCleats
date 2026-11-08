import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { writeBinaryRowFrames, encodeBinaryRowFrames } from '../../../src/shared/artifact-io/binary-columnar.js';
import { getContainedFileSession, isContainedFileSession } from '../../../src/shared/contained-file-resource.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';

// Actual public producer, native FileHandles and original iterators.
const root = await makeTempDir('poc-binary-frame-resource-'), open = fs.open, remove = fs.rm;
const disposal = new Map(); let sequence = 0;
const restore = () => { fs.open = open; fs.rm = remove; };
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
      const descriptor = Object.getOwnPropertyDescriptor(current, field); if (!descriptor || !('value' in descriptor)) continue;
      if (field === 'errors' && Array.isArray(descriptor.value)) queue.push(...descriptor.value);
      else if (field === 'cause') queue.push(descriptor.value);
    }
  }
  return false;
};
const fixture = async ({ failClose = -1, writeFailure, failWrite = false, syncFailure, failSync = false,
  replaceMethods = false, openFailure, failOpen = -1, writeHook = null } = {}) => {
  restore(); const directory = path.join(root, String(sequence++)); await fs.mkdir(directory);
  const paths = { dataPath: path.join(directory, 'data'), offsetsPath: path.join(directory, 'offsets'), lengthsPath: path.join(directory, 'lengths') };
  for (const file of Object.values(paths)) await fs.writeFile(file, 'old');
  const states = [], events = []; let removals = 0, openings = 0;
  fs.open = async (file, ...args) => {
    if (file === directory && args[0] === 'r') throw Object.assign(new Error('unsupported directory sync fixture'), { code: 'EPERM' });
    if (args[0] === 'wx' && openings++ === failOpen) throw openFailure;
    const actual = await open(file, ...args); if (args[0] !== 'wx') return actual;
    const index = states.length, state = { file, writes: 0, syncs: 0, closes: 0, truncates: 0, allowClose: index !== failClose };
    states.push(state); const stat = actual.stat, close = actual.close, write = actual.write, sync = actual.sync, truncate = actual.truncate;
    disposal.set(actual, () => close.call(actual));
    actual.write = async function (...next) {
      assert.equal(this, actual); state.writes++; events.push('write:' + index);
      if (index === 0 && writeHook) await writeHook(file);
      if (index === 0 && failWrite) throw writeFailure;
      return write.call(actual, ...next);
    };
    actual.truncate = async function (...next) { assert.equal(this, actual); state.truncates++; return truncate.call(actual, ...next); };
    actual.sync = async function () {
      assert.equal(this, actual); state.syncs++; if (index === 0 && failSync) throw syncFailure; return sync.call(actual);
    };
    actual.close = async function () {
      assert.equal(this, actual); state.closes++; events.push('close:' + index);
      if (!state.allowClose) throw Object.freeze(new Error('original binary descriptor close failed'));
      const result = await close.call(actual); disposal.delete(actual); return result;
    };
    actual.stat = async function (...next) {
      const result = await stat.call(actual, ...next);
      if (replaceMethods) actual.write = actual.sync = actual.close = actual.truncate = () => assert.fail('binary writer must retain captured native methods');
      return result;
    };
    return actual;
  };
  fs.rm = async (...args) => { removals++; return remove(...args); };
  return { directory, paths, states, events, removals: () => removals, openings: () => openings };
};
const unchanged = async paths => { for (const file of Object.values(paths)) assert.equal(await fs.readFile(file, 'utf8'), 'old'); };
const sessions = failure => {
  const values = failure.containedFileSessions || [getContainedFileSession(failure)];
  assert.equal(values.every(isContainedFileSession), true); return values;
};
try {
  {
    const current = await fixture({ replaceMethods: true }), rows = [Buffer.from('λ😀'), Buffer.alloc(0), Buffer.from('last')];
    const result = await writeBinaryRowFrames({ ...current.paths, rowBuffers: rows, preallocateBytes: 4096 });
    const expected = encodeBinaryRowFrames(rows); assert.equal(result.count, 3); assert.equal(result.totalBytes, expected.dataBuffer.length);
    assert.deepEqual(await fs.readFile(current.paths.dataPath), expected.dataBuffer);
    assert.deepEqual(await fs.readFile(current.paths.offsetsPath), expected.offsetsBuffer);
    assert.deepEqual(await fs.readFile(current.paths.lengthsPath), expected.lengthsBuffer);
    assert.equal(current.states[0].truncates, 2); assert.deepEqual(current.states.map(state => state.closes), [1, 1, 1]);
  }
  {
    const current = await fixture({ failClose: 1 });
    const failure = await rejected(() => writeBinaryRowFrames({ ...current.paths, rowBuffers: ['new'] }));
    assert.deepEqual(current.states.map(state => state.closes), [1, 1, 1]); assert.equal(current.removals(), 0); await unchanged(current.paths);
    const retained = sessions(failure); assert.equal(retained.length, 1); const before = current.states.map(state => [state.writes, state.syncs]);
    current.states[1].allowClose = true; await retained[0].releaseAfterClose();
    assert.deepEqual(current.states.map(state => state.closes), [1, 2, 1]); assert.equal(current.removals(), 0);
    assert.deepEqual(current.states.map(state => [state.writes, state.syncs]), before); assert.equal(failure.cacheOwnershipReleased(), true);
  }
  {
    let ready = false, nexts = 0, returns = 0;
    const primary = Object.assign(new Error('original binary write still owns work'), { cacheOwnershipPending: false, cacheOwnershipReleased() { return ready; } });
    const iterator = { [Symbol.asyncIterator]() { return this; }, next() {
      assert.equal(this, iterator); nexts++; this.next = this.return = () => assert.fail('source methods must remain original');
      return Promise.resolve({ value: Buffer.alloc(1024 * 1024 + 1), done: false });
    }, return() { assert.equal(this, iterator); returns++; return Promise.resolve({ done: true }); } };
    const current = await fixture({ failWrite: true, writeFailure: primary });
    const failure = await rejected(() => writeBinaryRowFrames({ ...current.paths, rowBuffers: iterator }));
    assert.deepEqual(current.states.map(state => state.closes), [0, 0, 0]); assert.equal(returns, 0); assert.equal(current.removals(), 0);
    primary.cacheOwnershipReleased = () => true; await rejected(() => failure.binaryColumnarSourceClose.close()); assert.equal(returns, 0);
    ready = true; assert.equal((await failure.binaryColumnarSourceClose.close()).closed, true); assert.equal(returns, 1);
    const retained = sessions(failure); assert.equal(retained.length, 3); for (const session of retained) await session.releaseAfterClose();
    assert.deepEqual(current.states.map(state => state.closes), [1, 1, 1]); assert.equal(nexts, 1); assert.equal(current.states[0].writes, 1);
    assert.equal(current.removals(), 0); assert.equal(failure.cacheOwnershipReleased(), true); await unchanged(current.paths);
  }
  {
    let ready = false;
    const primary = Object.assign(new Error('original sync retains native work'), { cacheOwnershipReleased() { return ready; } });
    const current = await fixture({ failSync: true, syncFailure: primary });
    const failure = await rejected(() => writeBinaryRowFrames({ ...current.paths, rowBuffers: ['new'] }));
    assert.deepEqual(current.states.map(state => state.closes), [0, 0, 0]); assert.deepEqual(current.states.map(state => state.syncs), [1, 1, 1]);
    primary.cacheOwnershipReleased = () => true; assert.equal(failure.cacheOwnershipReleased(), false); ready = true;
    for (const session of sessions(failure)) await session.releaseAfterClose();
    assert.deepEqual(current.states.map(state => state.closes), [1, 1, 1]); assert.deepEqual(current.states.map(state => state.syncs), [1, 1, 1]);
    assert.equal(failure.cacheOwnershipReleased(), true); assert.equal(current.removals(), 0);
  }
  for (const primary of [undefined, null, false, 0, '', Object.freeze(new Error('ordinary frozen frame write'))]) {
    const current = await fixture({ failWrite: true, writeFailure: primary });
    const failure = await rejected(() => writeBinaryRowFrames({ ...current.paths, rowBuffers: ['new'] }));
    assert.equal(contains(failure, primary), true); assert.deepEqual(current.states.map(state => state.closes), [1, 1, 1]);
    assert.equal(current.removals(), 3); await unchanged(current.paths);
  }
  {
    let ready = false;
    const primary = Object.assign(new Error('second open retains unknown work'), { cacheOwnershipReleased() { return ready; } });
    const current = await fixture({ failOpen: 1, openFailure: primary });
    const failure = await rejected(() => writeBinaryRowFrames({ ...current.paths, rowBuffers: ['new'] }));
    assert.equal(current.states.length, 1); assert.equal(current.states[0].closes, 0); assert.equal(current.openings(), 2);
    const session = getContainedFileSession(failure);
    ready = true;
    await rejected(() => session.releaseAfterClose());
    assert.equal(current.states[0].closes, 0, 'settling a failed open does not close the independent row source');
    assert.equal((await failure.binaryColumnarSourceClose.close()).closed, true);
    await session.releaseAfterClose(); assert.equal(current.states[0].closes, 1);
    assert.equal(current.openings(), 2); assert.equal(current.removals(), 0); await unchanged(current.paths);
  }
  {
    const primary = Object.freeze(new Error('row source failed')), secondary = Object.freeze(new Error('original source return failed')); let returns = 0;
    const iterator = { [Symbol.iterator]() { return this; }, next() { throw primary; }, return() { returns++; throw secondary; } };
    const current = await fixture(), failure = await rejected(() => writeBinaryRowFrames({ ...current.paths, rowBuffers: iterator }));
    assert.equal(contains(failure, primary), true); assert.equal(contains(failure, secondary), true); assert.equal(returns, 1);
    assert.deepEqual(current.states.map(state => state.closes), [0, 0, 0]);
    await rejected(() => failure.binaryColumnarSourceClose.close()); assert.equal(returns, 1, 'a known failed return is not implicitly retried');
  }
  {
    const primary = Object.freeze(new Error('preserve replaced staging namespace')); let staged, saved;
    const current = await fixture({ failWrite: true, writeFailure: primary, writeHook: async file => {
      staged = file; saved = file + '.saved'; await fs.rename(file, saved); await fs.writeFile(file, 'foreign');
    } });
    const failure = await rejected(() => writeBinaryRowFrames({ ...current.paths, rowBuffers: ['new'] }));
    assert.equal(contains(failure, primary), true); assert.equal(await fs.readFile(staged, 'utf8'), 'foreign');
    assert.equal((await fs.lstat(saved)).isFile(), true); assert.equal(current.removals(), 2); await unchanged(current.paths);
  }
  {
    const current = await fixture(), marker = path.join(current.directory, 'parent-negative'); await fs.writeFile(marker, 'not directory');
    const stagedOpen = fs.open; let parentCloses = 0, allowClose = false;
    fs.open = async (file, ...args) => {
      if (file !== current.directory || args[0] !== 'r') return stagedOpen(file, ...args);
      const actual = await open(marker, 'r'), close = actual.close; disposal.set(actual, () => close.call(actual));
      actual.close = async function () { parentCloses++; if (!allowClose) throw Object.freeze(new Error('parent close failed'));
        const result = await close.call(actual); disposal.delete(actual); return result; };
      return actual;
    };
    const failure = await rejected(() => writeBinaryRowFrames({ ...current.paths, rowBuffers: ['new'] }));
    assert.deepEqual(failure.binaryColumnarPublishedPaths, [current.paths.offsetsPath]); assert.equal(parentCloses, 1);
    assert.equal(await fs.readFile(current.paths.dataPath, 'utf8'), 'old'); assert.equal(await fs.readFile(current.paths.lengthsPath, 'utf8'), 'old');
    allowClose = true; await getContainedFileSession(failure).releaseAfterClose(); assert.equal(parentCloses, 2); assert.equal(current.removals(), 0);
  }
} finally {
  restore(); for (const close of disposal.values()) { try { await close(); } catch {} }
  await rmDirRecursive(root);
}
