import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { openJsonlRowReader, readJsonlRowsAt } from '../../../src/shared/artifact-io/offsets.js';
import { getContainedFileSession, isContainedFileSession } from '../../../src/shared/contained-file-resource.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';

// UNVALIDATED: real positioned readers and original FileHandle boundaries only.
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
const sessionsOf = failure => {
  const descriptor = Object.getOwnPropertyDescriptor(failure, 'containedFileSessions');
  assert.equal(descriptor.enumerable, false); assert.ok(Object.isFrozen(descriptor.value));
  assert.ok(descriptor.value.every(isContainedFileSession));
  assert.equal(getContainedFileSession(failure), descriptor.value[0]);
  return descriptor.value;
};
const root = await makeTempDir('poc-persistent-reader-resource-');
const originalOpen = fs.open, disposal = new Map();
try {
  const data = path.join(root, 'rows.jsonl'), offsets = path.join(root, 'rows.offsets.bin');
  const rows = [{ id: 1 }, { id: 2 }];
  const write = async values => {
    const lines = values.map(value => `${JSON.stringify(value)}\n`);
    const body = Buffer.from(lines.join('')), table = Buffer.alloc(values.length * 8);
    let position = 0;
    for (let index = 0; index < values.length; index += 1) {
      table.writeBigUInt64LE(BigInt(position), index * 8); position += Buffer.byteLength(lines[index]);
    }
    await fs.writeFile(data, body); await fs.writeFile(offsets, table);
    return { jsonlBytes: body.length, offsetsBytes: table.length,
      jsonlHash: createHash('sha256').update(body).digest('hex'),
      offsetsHash: createHash('sha256').update(table).digest('hex') };
  };
  const install = ({ open = null, read = null, stat = null, close = null } = {}) => {
    const states = new Map();
    fs.open = async (file, ...args) => {
      if (open) await open(file);
      const actual = await originalOpen(file, ...args);
      const state = { file, handle: actual, reads: 0, stats: 0, closes: 0, maxRead: 0 };
      states.set(file, state);
      const nativeRead = actual.read, nativeStat = actual.stat, nativeClose = actual.close;
      disposal.set(actual, () => nativeClose.call(actual));
      actual.read = function (...readArgs) {
        assert.equal(this, actual); state.reads += 1; state.maxRead = Math.max(state.maxRead, readArgs[2]);
        const native = (...next) => nativeRead.call(actual, ...next);
        return read ? read(state, native, ...readArgs) : native(...readArgs);
      };
      actual.stat = function (...statArgs) {
        assert.equal(this, actual); state.stats += 1;
        const native = (...next) => nativeStat.call(actual, ...next);
        return stat ? stat(state, native, ...statArgs) : native(...statArgs);
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
  let identity = await write(rows);
  for (const containedRoot of [null, root]) {
    const states = install();
    const reader = await openJsonlRowReader(data, offsets, { containedRoot });
    let replacements = 0;
    for (const state of states.values()) {
      state.handle.read = state.handle.stat = () => { replacements += 1; throw new Error('replacement read/stat forbidden'); };
      state.handle.close = async () => { replacements += 1; };
    }
    assert.deepEqual(await reader.readRows([1, 0, 1, -1]), [rows[1], rows[0], rows[1], null]);
    assert.equal(await reader.validateOffsets(), true);
    await rejected(() => reader.readRows([0], { maxBytes: 1 }));
    // Ordinary settled read failure remains compatible with successful close.
    await reader.close(); await reader.close();
    assert.equal(replacements, 0);
    assert.ok([...states.values()].every(state => state.closes === 1 && state.handle.fd === -1));
    assert.throws(() => reader.readRows([0]), /reader is closed/); fs.open = originalOpen;
  }

  for (const containedRoot of [null, root]) {
    const states = install();
    const reader = await openJsonlRowReader(data, offsets, { containedRoot });
    await reader.verify(identity);
    assert.ok([...states.values()].every(state => state.closes === 1 && state.handle.fd === -1));
    const nativeReads = [...states.values()].reduce((sum, state) => sum + state.reads, 0);
    await fs.writeFile(data, 'different bytes after confirmed snapshot close\n');
    assert.deepEqual(await reader.readRows([1, 0]), [rows[1], rows[0]]);
    assert.equal(await reader.validateOffsets(), true);
    await reader.close();
    assert.equal([...states.values()].reduce((sum, state) => sum + state.reads, 0), nativeReads);
    assert.ok([...states.values()].every(state => state.closes === 1));
    fs.open = originalOpen; identity = await write(rows);
  }

  const largeRows = [{ id: 1, payload: 'x'.repeat(66000) }, { id: 2, payload: 'last' }];
  const largeIdentity = await write(largeRows), largeStates = install();
  const large = await openJsonlRowReader(data, offsets, { containedRoot: root });
  await large.verify(largeIdentity);
  assert.ok([...largeStates.values()].every(state => state.closes === 0 && state.maxRead <= 65536));
  assert.deepEqual(await large.readRows([1], { maxBytes: 1024 }), [largeRows[1]]);
  assert.equal(await large.validateOffsets(), true);
  await large.close(); assert.ok([...largeStates.values()].every(state => state.closes === 1));
  fs.open = originalOpen; identity = await write(rows);

  for (const consume of [
    () => openJsonlRowReader(data, offsets),
    () => readJsonlRowsAt(data, offsets, [1, 0])
  ]) {
    for (const primary of [undefined, null, false, 0, '', Object.freeze(new Error('frozen peer admission rejected'))]) {
      let deny = true;
      const secondary = Object.freeze(new Error('actual successful peer close rejected'));
      const states = install({ open: file => { if (file === data) throw primary; },
        close: (_state, native) => { if (deny) throw secondary; return native(); } });
      const failure = await rejected(consume);
      assert.equal(contains(failure, primary), true); assert.equal(contains(failure, secondary), true);
      assert.equal(states.size, 1); assert.equal(states.get(offsets).closes, 1);
      const sessions = sessionsOf(failure); assert.equal(sessions.length, 1);
      deny = false; const receipt = await sessions[0].releaseAfterClose();
      assert.equal(receipt.pending, false); assert.equal(receipt.settled, true);
      assert.equal(states.get(offsets).closes, 2); assert.equal(states.get(offsets).reads, 0);
      assert.equal(failure.cacheOwnershipReleased(), true); fs.open = originalOpen;
    }
  }

  for (const primary of [undefined, null, false, 0, '', Object.freeze(new Error('original persistent data read rejected'))]) {
    let deny = true;
    const dataClose = Object.freeze(new Error('data close rejected independently'));
    const offsetClose = Object.freeze(new Error('offset close rejected independently'));
    const states = install({ read: (state, native, ...args) => { if (state.file === data) throw primary; return native(...args); },
      close: (state, native) => { if (deny) throw state.file === data ? dataClose : offsetClose; return native(); } });
    const reader = await openJsonlRowReader(data, offsets);
    assert.equal(contains(await rejected(() => reader.readRows([0])), primary), true);
    const failure = await rejected(() => reader.close());
    assert.equal(contains(failure, primary), true); assert.equal(contains(failure, dataClose), true);
    assert.equal(contains(failure, offsetClose), true);
    const sessions = sessionsOf(failure); assert.equal(sessions.length, 2);
    assert.equal(await rejected(() => reader.close()), failure, 'failed reader close never implicitly retries native destruction');
    assert.ok([...states.values()].every(state => state.closes === 1));
    const reads = states.get(data).reads;
    deny = false; for (const session of sessions) await session.releaseAfterClose();
    assert.ok([...states.values()].every(state => state.closes === 2));
    assert.equal(states.get(data).reads, reads); assert.equal(failure.cacheOwnershipReleased(), true);
    fs.open = originalOpen;
  }

  for (const marker of [undefined, false, true]) {
    let settled = false;
    const primary = Object.defineProperties(new Error('original read owns independent native work'), {
      ...(marker === undefined ? {} : { cacheOwnershipPending: { value: marker } }),
      cacheOwnershipReleased: { value() { assert.equal(this, primary); return settled; }, writable: true }
    });
    const states = install({ read: (state, native, ...args) => { if (state.file === data) throw primary; return native(...args); } });
    const reader = await openJsonlRowReader(data, offsets);
    const readFailure = await rejected(() => reader.readRows([0]));
    primary.cacheOwnershipReleased = () => true;
    assert.equal(readFailure.cacheOwnershipReleased(), false);
    const reads = states.get(data).reads;
    await rejected(() => reader.readRows([1])); assert.equal(states.get(data).reads, reads);
    const failure = await rejected(() => reader.close()), sessions = sessionsOf(failure);
    assert.equal(sessions.length, 2); assert.ok([...states.values()].every(state => state.closes === 0));
    for (const session of sessions) await rejected(() => session.releaseAfterClose());
    assert.ok([...states.values()].every(state => state.closes === 0));
    settled = true; for (const session of sessions) await session.releaseAfterClose();
    assert.ok([...states.values()].every(state => state.closes === 1));
    assert.equal(failure.cacheOwnershipReleased(), true); assert.equal(states.get(data).reads, reads);
    fs.open = originalOpen;
  }

  {
    const started = Promise.withResolvers(), permit = Promise.withResolvers();
    const states = install({ read: async (state, native, ...args) => {
      const result = await native(...args);
      if (state.file === data) { started.resolve(); await permit.promise; }
      return result;
    } });
    const reader = await openJsonlRowReader(data, offsets);
    const reading = reader.readRows([1]); await started.promise;
    const closing = reader.close();
    try {
      await new Promise(resolve => setImmediate(resolve));
      assert.ok([...states.values()].every(state => state.closes === 0));
    } finally { permit.resolve(); }
    assert.deepEqual(await reading, [rows[1]]); await closing;
    assert.ok([...states.values()].every(state => state.closes === 1)); fs.open = originalOpen;
  }

  for (const failingClose of [undefined, null, false, 0, '', Object.freeze(new Error('snapshot native close rejected'))]) {
    let deny = true;
    const states = install({ close: (state, native) => { if (state.file === data && deny) throw failingClose; return native(); } });
    const reader = await openJsonlRowReader(data, offsets, { containedRoot: root });
    const failure = await rejected(() => reader.verify(identity));
    assert.equal(contains(failure, failingClose), true);
    const sessions = sessionsOf(failure); assert.equal(sessions.length, 1);
    const reads = [...states.values()].reduce((sum, state) => sum + state.reads, 0);
    assert.equal(await rejected(() => reader.readRows([0])), failure, 'unconfirmed snapshot cannot publish a memory reader');
    assert.equal(await rejected(() => reader.close()), failure);
    assert.ok([...states.values()].every(state => state.closes === 1));
    deny = false; await sessions[0].releaseAfterClose();
    assert.equal(states.get(data).closes, 2); assert.equal(states.get(offsets).closes, 1);
    assert.equal([...states.values()].reduce((sum, state) => sum + state.reads, 0), reads);
    assert.equal(failure.cacheOwnershipReleased(), true); fs.open = originalOpen;
  }

  {
    let deny = true;
    const primary = Object.freeze(new Error('first verification read rejected'));
    const secondary = Object.freeze(new Error('second verification read rejected'));
    const states = install({ read: state => { throw state.file === data ? primary : secondary; },
      close: (_state, native) => { if (deny) return false; return native(); } });
    const reader = await openJsonlRowReader(data, offsets);
    const verificationFailure = await rejected(() => reader.verify(identity));
    assert.equal(contains(verificationFailure, primary), true); assert.equal(contains(verificationFailure, secondary), true);
    const failure = await rejected(() => reader.close()), sessions = sessionsOf(failure);
    assert.equal(sessions.length, 2); assert.ok([...states.values()].every(state => state.closes === 1));
    deny = false; for (const session of sessions) await session.releaseAfterClose();
    assert.equal(contains(failure, primary), true); assert.equal(contains(failure, secondary), true);
    assert.equal(failure.cacheOwnershipReleased(), true); fs.open = originalOpen;
  }

  {
    let deny = true;
    const states = install({ close: (_state, native) => { if (deny) throw false; return native(); } });
    const failure = await rejected(() => readJsonlRowsAt(data, offsets, [1, 0, 1], { containedRoot: root }));
    const sessions = sessionsOf(failure); assert.equal(sessions.length, 2);
    assert.ok([...states.values()].every(state => state.closes === 1));
    const reads = states.get(data).reads;
    deny = false; for (const session of sessions) await session.releaseAfterClose();
    assert.equal(states.get(data).reads, reads, 'close-only recovery does not return or reread the withheld valid batch');
    fs.open = originalOpen;
  }
} finally {
  fs.open = originalOpen;
  for (const dispose of disposal.values()) { try { await dispose(); } catch {} }
  await rmDirRecursive(root);
}
console.log('persistent-reader-resource-lifetime passed');
