import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { readJsonlRowAt, validateOffsetsAgainstFile } from '../../../src/shared/artifact-io/offsets.js';
import { withOpenedFileReaders } from '../../../src/shared/artifact-io/with-opened-readers.js';
import { getContainedFileSession, isContainedFileSession } from '../../../src/shared/contained-file-resource.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';

// UNVALIDATED: real pair admission, exact original FileHandles and bounded public
// row/validation consumers. No metadata unlink, link creation, child or native binding.
const rejected = async action => {
  let failed = false, error;
  try { await action(); } catch (value) { failed = true; error = value; }
  assert.equal(failed, true); return error;
};
const contains = (value, expected) => {
  const queue = [value], seen = new Set();
  while (queue.length) {
    const current = queue.pop(); if (current === expected) return true;
    if (current === null || !['object', 'function'].includes(typeof current) || seen.has(current)) continue;
    seen.add(current);
    if (Object.hasOwn(current, 'cause')) queue.push(current.cause);
    if (Array.isArray(current.errors)) queue.push(...current.errors);
  }
  return false;
};
const root = await makeTempDir('poc-paired-reader-resource-');
const originalOpen = fsp.open, originalStat = fs.statSync;
const disposal = new Map();
try {
  const data = path.join(root, 'rows.jsonl'), offsets = path.join(root, 'rows.offsets.bin');
  const rows = [{ id: 1 }, { id: 2 }], lines = rows.map(row => `${JSON.stringify(row)}\n`);
  const bytes = Buffer.alloc(16); bytes.writeBigUInt64LE(BigInt(Buffer.byteLength(lines[0])), 8);
  await fsp.writeFile(data, lines.join('')); await fsp.writeFile(offsets, bytes);
  const install = ({ open = null, read = null, close = null } = {}) => {
    const states = new Map();
    fsp.open = async (target, ...args) => {
      if (open) await open(target);
      const actual = await originalOpen(target, ...args);
      const state = { target, handle: actual, reads: 0, closes: 0 };
      states.set(target, state);
      const nativeRead = actual.read, nativeClose = actual.close;
      disposal.set(actual, () => nativeClose.call(actual));
      actual.read = function (...readArgs) {
        assert.equal(this, actual); state.reads += 1;
        const native = (...next) => nativeRead.call(actual, ...next);
        return read ? read(state, native, ...readArgs) : native(...readArgs);
      };
      actual.close = function () {
        assert.equal(this, actual); state.closes += 1;
        const native = async () => { const result = await nativeClose.call(actual); disposal.delete(actual); return result; };
        return close ? close(state, native) : native();
      };
      return actual;
    };
    return states;
  };
  const sessionsOf = failure => {
    const field = Object.getOwnPropertyDescriptor(failure, 'containedFileSessions');
    assert.equal(field.enumerable, false); assert.ok(Object.isFrozen(field.value));
    assert.ok(field.value.every(isContainedFileSession));
    assert.equal(getContainedFileSession(failure), field.value[0]);
    assert.equal(new Set(field.value.map(session => session.resourceId)).size, field.value.length);
    return field.value;
  };
  {
    const states = install();
    assert.deepEqual(await readJsonlRowAt(data, offsets, 1, { maxBytes: 1024 }), rows[1]);
    assert.ok([...states.values()].every(state => state.closes === 1 && state.handle.fd === -1)); fsp.open = originalOpen;
    for (const containedRoot of [root, null]) {
      const opened = install(); assert.equal(await validateOffsetsAgainstFile(data, offsets, { containedRoot }), true);
      assert.ok([...opened.values()].every(state => state.closes === 1 && state.handle.fd === -1)); fsp.open = originalOpen;
    }
  }
  for (const primary of [undefined, null, false, 0, '', Object.freeze(Object.assign(new Error('original peer open failed'), { code: 'EORIGINAL' }))]) {
    const states = install({ open: target => { if (target === data) throw primary; } });
    const failure = await rejected(() => readJsonlRowAt(data, offsets, 0));
    assert.equal(contains(failure, primary), true); assert.equal(states.size, 1);
    assert.equal(states.get(offsets).closes, 1); assert.equal(states.get(offsets).reads, 0);
    assert.equal(states.get(offsets).handle.fd, -1); fsp.open = originalOpen;
  }
  {
    let failClose = true;
    const secondary = Object.freeze(new Error('successful peer close failed after actual missing open'));
    const states = install({ close: (state, native) => { if (failClose) throw secondary; return native(); } });
    const failure = await rejected(() => readJsonlRowAt(path.join(root, 'missing.jsonl'), offsets, 0));
    assert.equal(failure.code, 'ENOENT'); assert.equal(contains(failure, secondary), true);
    const sessions = sessionsOf(failure); assert.equal(sessions.length, 1); assert.equal(states.get(offsets).closes, 1);
    states.get(offsets).handle.close = () => assert.fail('recovery cannot recapture a replacement close');
    failClose = false; await sessions[0].releaseAfterClose();
    assert.equal(states.get(offsets).closes, 2); assert.equal(states.get(offsets).reads, 0);
    assert.equal(failure.cacheOwnershipReleased(), true); fsp.open = originalOpen;
  }
  {
    const first = Object.freeze(new Error('first open failure')), second = Object.freeze(new Error('independent second open failure'));
    const states = install({ open: target => { throw target === data ? first : second; } });
    const failure = await rejected(() => validateOffsetsAgainstFile(data, offsets));
    assert.equal(contains(failure, first), true); assert.equal(contains(failure, second), true); assert.equal(states.size, 0); fsp.open = originalOpen;
  }
  for (const primary of [undefined, null, false, 0, '', Object.freeze(new Error('original data read failure'))]) {
    let failClose = true;
    const dataClose = Object.freeze(new Error('independent data close')), offsetClose = Object.freeze(new Error('independent offsets close'));
    const states = install({ read: (state, native, ...args) => { if (state.target === data) throw primary; return native(...args); },
      close: (state, native) => { if (failClose) throw state.target === data ? dataClose : offsetClose; return native(); } });
    const failure = await rejected(() => readJsonlRowAt(data, offsets, 0)), sessions = sessionsOf(failure);
    assert.equal(contains(failure, primary), true); assert.equal(contains(failure, dataClose), true); assert.equal(contains(failure, offsetClose), true);
    assert.equal(sessions.length, 2); assert.ok([...states.values()].every(state => state.closes === 1));
    const reads = [...states.values()].map(state => state.reads); failClose = false;
    for (const session of sessions) await session.releaseAfterClose();
    assert.deepEqual([...states.values()].map(state => state.reads), reads);
    assert.ok([...states.values()].every(state => state.closes === 2)); assert.equal(failure.cacheOwnershipReleased(), true); fsp.open = originalOpen;
  }
  {
    let failClose = true;
    const secondary = Object.freeze(new Error('valid row cannot resolve through unconfirmed descriptor close'));
    const states = install({ close: (state, native) => { void state; if (failClose) throw secondary; return native(); } });
    const failure = await rejected(() => readJsonlRowAt(data, offsets, 1)), sessions = sessionsOf(failure);
    assert.equal(contains(failure, secondary), true); assert.equal(sessions.length, 2);
    const reads = [...states.values()].map(state => state.reads); failClose = false;
    for (const session of sessions) await session.releaseAfterClose();
    assert.deepEqual([...states.values()].map(state => state.reads), reads); fsp.open = originalOpen;
  }
  {
    let settled = false;
    const primary = Object.assign(new Error('original paired read still owns native work'), {
      cacheOwnershipPending: false, cacheOwnershipReleased() { assert.equal(this, primary); return settled; }
    });
    const states = install({ read: (state, native, ...args) => { if (state.target === data) throw primary; return native(...args); } });
    const failure = await rejected(() => readJsonlRowAt(data, offsets, 0)), sessions = sessionsOf(failure);
    assert.equal(sessions.length, 2); assert.ok([...states.values()].every(state => state.closes === 0));
    primary.cacheOwnershipReleased = () => true;
    for (const session of sessions) await rejected(() => session.releaseAfterClose());
    assert.ok([...states.values()].every(state => state.closes === 0));
    settled = true; for (const session of sessions) await session.releaseAfterClose();
    assert.ok([...states.values()].every(state => state.closes === 1)); assert.equal(failure.cacheOwnershipReleased(), true); fsp.open = originalOpen;
  }
  {
    let failClose = true;
    const secondary = Object.freeze(new Error('strict admission close failed on actual data descriptor'));
    const states = install({ close: (state, native) => { if (state.target === data && failClose) throw secondary; return native(); } });
    fs.statSync = (target, ...args) => {
      const actual = originalStat(target, ...args);
      return target === data && args[0]?.bigint ? new Proxy(actual, {
        get: (stat, key) => key === 'ino' ? actual.ino + 1n : Reflect.get(stat, key)
      }) : actual;
    };
    const failure = await rejected(() => validateOffsetsAgainstFile(data, offsets, { containedRoot: root }));
    fs.statSync = originalStat;
    assert.equal(failure.code, 'ERR_UNSAFE_FILE_PATH'); assert.equal(contains(failure, secondary), true);
    const sessions = sessionsOf(failure); assert.equal(sessions.length, 2);
    assert.equal(states.get(data).closes, 1); assert.equal(states.get(offsets).closes, 0);
    assert.ok([...states.values()].every(state => state.reads === 0));
    failClose = false; for (const session of sessions) await session.releaseAfterClose();
    assert.equal(states.get(data).closes, 2); assert.equal(states.get(offsets).closes, 1);
    assert.equal(failure.cacheOwnershipReleased(), true); fsp.open = originalOpen;
  }
  {
    const started = Promise.withResolvers(), gate = Promise.withResolvers(); let admitted = 0;
    const states = install({ read: async (state, native, ...args) => {
      void state; admitted += 1; if (admitted === 2) started.resolve(); await gate.promise; return native(...args);
    } });
    const primary = Object.freeze(new Error('callback fails while both admitted reads are still pending'));
    const reading = withOpenedFileReaders([data, offsets], descriptors => {
      for (const descriptor of descriptors) void descriptor.read(Buffer.alloc(1), 0, 1, 0);
      throw primary;
    });
    await started.promise;
    assert.ok([...states.values()].every(state => state.closes === 0)); gate.resolve();
    const failure = await rejected(() => reading);
    assert.equal(contains(failure, primary), true); assert.ok([...states.values()].every(state => state.closes === 1));
    assert.equal(getContainedFileSession(failure), null); fsp.open = originalOpen;
  }
  assert.equal(await fsp.readFile(data, 'utf8'), lines.join('')); assert.deepEqual(await fsp.readFile(offsets), bytes);
} finally {
  fsp.open = originalOpen; fs.statSync = originalStat;
  for (const close of disposal.values()) { try { await close(); } catch {} }
  await rmDirRecursive(root);
}
console.log('paired-reader-resource-lifetime passed');
