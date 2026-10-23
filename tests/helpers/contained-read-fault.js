import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

/** Instrument actual numeric-flag contained opens of one disposable file.
 * Other readers and cleanup retain their original implementation/authority.
 */
export const installContainedReadFault = ({ filename, failClose = null, failRead = null }) => {
  const originalOpen = fs.open, states = [];
  fs.open = async (file, flags, ...args) => {
    const handle = await originalOpen(file, flags, ...args);
    if (path.resolve(String(file)) !== path.resolve(filename) || typeof flags !== 'number') return handle;
    const originalClose = handle.close, originalRead = handle.read;
    const state = { handle, reads: 0, closes: 0, allowClose: false, closed: false };
    states.push(state);
    handle.read = function (...readArgs) {
      assert.equal(this, handle); state.reads++;
      if (failRead) failRead(state);
      return originalRead.call(handle, ...readArgs);
    };
    handle.close = async function () {
      assert.equal(this, handle); state.closes++;
      if (!state.allowClose && failClose) failClose(state);
      await originalClose.call(handle); state.closed = true;
    };
    state.cleanup = async () => { if (!state.closed) { await originalClose.call(handle); state.closed = true; } };
    return handle;
  };
  return { states, restore: () => { fs.open = originalOpen; },
    async cleanup() { fs.open = originalOpen; for (const state of states) await state.cleanup(); } };
};

export const containsOriginalFailure = (failure, expected) => {
  const queue = [failure], seen = new Set();
  while (queue.length) {
    const value = queue.pop(); if (value === expected) return true;
    if (!value || !['object', 'function'].includes(typeof value) || seen.has(value)) continue;
    seen.add(value);
    if (Object.hasOwn(value, 'cause')) queue.push(value.cause);
    if (Array.isArray(value.errors)) queue.push(...value.errors);
  }
  return false;
};
