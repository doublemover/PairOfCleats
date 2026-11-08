import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { readOffsetAt, readOffsetsAt } from '../../../src/shared/artifact-io/offsets.js';
import { getContainedFileSession } from '../../../src/shared/contained-file-resource.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';

// UNVALIDATED: actual owned/borrowed positioned offset readers and FileHandles.
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
const root = await makeTempDir('poc-offset-resource-'), originalOpen = fs.open;
const disposal = new Map();
try {
  const file = path.join(root, 'offsets.bin'), bytes = Buffer.alloc(24);
  [0n, 5n, 9n].forEach((value, index) => bytes.writeBigUInt64LE(value, index * 8)); await fs.writeFile(file, bytes);
  const install = (target = file, { read = null, close = null } = {}) => {
    const state = { handle: null, opens: 0, reads: 0, closes: 0, windows: [] };
    fs.open = async (...args) => {
      const actual = await originalOpen(...args); if (args[0] !== target) return actual;
      const nativeRead = actual.read, nativeClose = actual.close;
      state.handle = actual; state.opens += 1; disposal.set(actual, () => nativeClose.call(actual));
      actual.read = function (...readArgs) {
        assert.equal(this, actual); state.reads += 1; state.windows.push(readArgs[2]);
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
    return state;
  };
  {
    const state = install(file, { read: async (held, native, buffer, offset, length, position) => {
      held.handle.read = () => assert.fail('replacement read cannot replace original positioned operation');
      held.handle.close = () => assert.fail('replacement close cannot replace original descriptor owner');
      return native(buffer, offset, Math.min(3, length), position);
    } });
    assert.deepEqual([...await readOffsetsAt(file, [2, 0, 1, 2, -1, 0.5])], [[0, 0], [1, 5], [2, 9]]);
    assert.equal(state.closes, 1); assert.ok(state.reads > 1); fs.open = originalOpen;
  }
  {
    const state = install();
    assert.equal(await readOffsetAt(file, 1), 5); assert.equal(await readOffsetAt(file, 3), null);
    assert.equal(state.opens, 2); assert.equal(state.closes, 2); fs.open = originalOpen;
  }
  {
    const sparse = path.join(root, 'sparse-offsets.bin'), index = 600000;
    const handle = await originalOpen(sparse, 'w');
    try {
      await handle.truncate((index + 1) * 8);
      const last = Buffer.alloc(8); last.writeBigUInt64LE(9n); await handle.write(last, 0, 8, index * 8);
    } finally { await handle.close(); }
    const state = install(sparse);
    assert.deepEqual([...await readOffsetsAt(sparse, [0, index])], [[0, 0], [index, 9]]);
    assert.deepEqual(state.windows, [8, 8], 'far offsets keep individual reads instead of a multi-megabyte span');
    assert.equal(state.closes, 1); fs.open = originalOpen;
  }
  for (const primary of [undefined, null, false, 0, '', Object.freeze(new Error('original positioned offset read failed'))]) {
    let failClose = true;
    const secondary = Object.freeze(new Error('independent exact offset close failure'));
    const state = install(file, { read: () => { throw primary; }, close: (held, native) => { void held; if (failClose) throw secondary; return native(); } });
    const failure = await rejected(() => readOffsetsAt(file, [0, 1])), session = getContainedFileSession(failure);
    assert.equal(contains(failure, primary), true); assert.equal(contains(failure, secondary), true);
    assert.equal(state.closes, 1); assert.equal(state.reads, 1);
    state.handle.close = () => assert.fail('recovery cannot recapture a replaced close');
    failClose = false; await session.releaseAfterClose();
    assert.equal(state.closes, 2); assert.equal(state.reads, 1); assert.equal(failure.cacheOwnershipReleased(), true); fs.open = originalOpen;
  }
  {
    let failClose = true;
    const secondary = Object.freeze(new Error('valid scalar offset remains withheld after close failure'));
    const state = install(file, { close: (held, native) => { void held; if (failClose) throw secondary; return native(); } });
    const failure = await rejected(() => readOffsetAt(file, 1)), session = getContainedFileSession(failure);
    assert.equal(contains(failure, secondary), true); const reads = state.reads;
    failClose = false; await session.releaseAfterClose(); assert.equal(state.closes, 2); assert.equal(state.reads, reads); fs.open = originalOpen;
  }
  {
    let settled = false;
    const primary = Object.assign(new Error('original offset native work remains pending'), {
      cacheOwnershipPending: false, cacheOwnershipReleased() { assert.equal(this, primary); return settled; }
    });
    const state = install(file, { read: () => { throw primary; } });
    const failure = await rejected(() => readOffsetsAt(file, [0])), session = getContainedFileSession(failure);
    assert.equal(state.closes, 0); primary.cacheOwnershipReleased = () => true;
    await rejected(() => session.releaseAfterClose()); assert.equal(state.closes, 0);
    settled = true; await session.releaseAfterClose(); assert.equal(state.closes, 1); assert.equal(state.reads, 1); fs.open = originalOpen;
  }
  {
    const malformed = path.join(root, 'unsafe-offset.bin'), input = Buffer.alloc(8);
    input.writeBigUInt64LE(BigInt(Number.MAX_SAFE_INTEGER) + 1n); await fs.writeFile(malformed, input);
    let failClose = true;
    const secondary = Object.freeze(new Error('unsafe decoded offset plus close failure'));
    const state = install(malformed, { close: (held, native) => { void held; if (failClose) throw secondary; return native(); } });
    const failure = await rejected(() => readOffsetsAt(malformed, [0]));
    assert.match(failure.message, /Offset exceeds MAX_SAFE_INTEGER/); assert.equal(contains(failure, secondary), true);
    failClose = false; await getContainedFileSession(failure).releaseAfterClose(); assert.equal(state.reads, 1); assert.equal(state.closes, 2); fs.open = originalOpen;
  }
  {
    const state = install(), borrowed = await fs.open(file, 'r');
    assert.deepEqual([...await readOffsetsAt(file, [0, 2], { handle: borrowed })], [[0, 0], [2, 9]]);
    assert.equal(state.closes, 0, 'a caller-supplied handle retains its original ownership');
    await borrowed.close(); assert.equal(state.closes, 1); fs.open = originalOpen;
  }
  assert.deepEqual(await fs.readFile(file), bytes);
} finally {
  fs.open = originalOpen;
  for (const close of disposal.values()) { try { await close(); } catch {} }
  await rmDirRecursive(root);
}
console.log('offset-resource-lifetime passed');
