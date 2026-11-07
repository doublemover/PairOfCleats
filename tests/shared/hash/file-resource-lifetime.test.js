import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { sha1File, sha256File, checksumFile, checksumString, setXxhashBackend } from '../../../src/shared/hash.js';
import { getContainedFileSession } from '../../../src/shared/contained-file-resource.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';

// Source-authored only in the parallel implementation wave; execution deferred.
const root = await makeTempDir('poc-file-hash-resource-'), file = path.join(root, 'input');
const ascii = Buffer.from('descriptor hash payload\n'.repeat(7000)); await fs.writeFile(file, ascii);
const open = fs.open, createHash = crypto.createHash, disposal = new Map();
const rejected = async action => {
  let failed = false, failure;
  try { await action(); } catch (value) { failed = true; failure = value; }
  assert.equal(failed, true); return failure;
};
const contains = (failure, expected) => {
  const queue = [failure], seen = new Set();
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
const intercept = ({ readFailure, failRead = false, closeFailure, failClose = false,
  nonvoid = false, short = false, invalidProgress = null, changed = false, afterRead = null } = {}) => {
  const state = { reads: 0, closes: 0, opens: 0, stats: 0, largest: 0, allowRead: !failRead, allowClose: !failClose && !nonvoid };
  fs.open = async (name, ...args) => {
    const actual = await open(name, ...args); if (name !== file) return actual;
    state.opens += 1;
    const read = actual.read, close = actual.close, stat = actual.stat;
    disposal.set(actual, () => close.call(actual));
    actual.stat = async function (...next) {
      assert.equal(this, actual); state.stats += 1; const result = await stat.call(actual, ...next);
      if (changed && state.stats > 1) result.size += 1;
      return result;
    };
    actual.read = async function (buffer, offset, length, position) {
      assert.equal(this, actual); state.reads += 1; state.largest = Math.max(state.largest, length);
      if (!state.allowRead) throw readFailure;
      if (invalidProgress !== null) return { buffer, bytesRead: invalidProgress };
      const result = await read.call(actual, buffer, offset, short ? Math.min(length, 997) : length, position);
      afterRead?.(actual); return result;
    };
    actual.close = async function () {
      assert.equal(this, actual); state.closes += 1;
      if (!state.allowClose) { if (nonvoid) return false; throw closeFailure; }
      const result = await close.call(actual); disposal.delete(actual); return result;
    };
    return actual;
  };
  return state;
};
const restore = () => { fs.open = open; crypto.createHash = createHash; };
try {
  setXxhashBackend('wasm');
  // Byte parity uses ASCII for checksumString, whose contract is text.
  const expected = [createHash('sha1').update(ascii).digest('hex'), createHash('sha256').update(ascii).digest('hex'),
    (await checksumString(ascii.toString('utf8'))).value];
  const computes = [sha1File, sha256File, checksumFile];
  for (const contained of [false, true]) {
    const options = contained ? { containedRoot: root } : {};
    for (let index = 0; index < computes.length; index += 1) {
      const compute = computes[index], state = intercept({ short: true });
      const result = await compute(file, options);
      assert.equal(typeof result === 'string' ? result : result.value, expected[index]);
      assert.equal(state.opens, 1); assert.equal(state.closes, 1); assert.ok(state.reads > 3); assert.ok(state.largest <= 65536);
      restore();
      for (const nonvoid of [false, true]) {
        const primary = Object.freeze(new Error('file hash exact close failed'));
        const closeState = intercept({ failClose: true, closeFailure: primary, nonvoid });
        const failure = await rejected(() => compute(file, options)), session = getContainedFileSession(failure);
        assert.ok(session); assert.equal(closeState.closes, 1); assert.equal(failure.cacheOwnershipReleased(), false);
        if (!nonvoid) assert.equal(contains(failure, primary), true);
        const readCount = closeState.reads; closeState.allowClose = true;
        await session.releaseAfterClose(); assert.equal(closeState.closes, 2); assert.equal(closeState.reads, readCount);
        assert.equal(closeState.opens, 1); restore();
      }
      let ready = false;
      const primary = Object.assign(new Error('file hash pending original read'), {
        cacheOwnershipPending: false, cacheOwnershipReleased() { assert.equal(this, primary); return ready; }
      });
      const pending = intercept({ failRead: true, readFailure: primary });
      const failure = await rejected(() => compute(file, options)), session = getContainedFileSession(failure);
      assert.ok(session); assert.equal(pending.closes, 0); primary.cacheOwnershipReleased = () => true;
      await rejected(() => session.releaseAfterClose()); assert.equal(pending.closes, 0);
      ready = true; await session.releaseAfterClose();
      assert.equal(pending.closes, 1); assert.equal(pending.reads, 1); assert.equal(pending.opens, 1); restore();
    }
    for (const value of [undefined, null, false, 0, '', Object.freeze(new Error('frozen original read'))]) {
      const closeFailure = Object.freeze(new Error('independent exact close failure'));
      const state = intercept({ failRead: true, readFailure: value, failClose: true, closeFailure });
      const failure = await rejected(() => sha256File(file, options));
      assert.equal(contains(failure, value), true); assert.equal(contains(failure, closeFailure), true);
      const session = getContainedFileSession(failure); assert.ok(session); state.allowClose = true;
      await session.releaseAfterClose(); assert.equal(state.reads, 1); assert.equal(state.closes, 2); restore();
    }
    for (const invalidProgress of [0, -1, 65537, 0.5, NaN]) {
      const state = intercept({ invalidProgress });
      await rejected(() => sha256File(file, options)); assert.equal(state.closes, 1); restore();
    }
    {
      const state = intercept({ changed: true });
      const failure = await rejected(() => sha256File(file, options));
      assert.equal(failure.code, 'ERR_FILE_CHANGED'); assert.equal(state.closes, 1); restore();
    }
    {
      const controller = new AbortController();
      const state = intercept({ afterRead: () => controller.abort() });
      const failure = await rejected(() => sha256File(file, { ...options, signal: controller.signal }));
      assert.equal(failure.name, 'AbortError'); assert.equal(state.reads, 1); assert.equal(state.closes, 1); restore();
    }
  }
  {
    const primary = Object.freeze(new Error('hash update native work')); let ready = false, updates = 0, digests = 0;
    const native = Object.freeze({ cause: primary, cacheOwnershipReleased() { assert.equal(this, native); return ready; } });
    crypto.createHash = algorithm => {
      const actual = createHash(algorithm), update = actual.update;
      actual.update = function (chunk) { updates += 1; update.call(this, chunk); throw native; };
      actual.digest = () => { digests += 1; assert.fail('failed original update cannot digest'); };
      return actual;
    };
    const state = intercept(); const failure = await rejected(() => sha1File(file));
    const session = getContainedFileSession(failure); assert.ok(session); assert.equal(state.closes, 0);
    ready = true; await session.releaseAfterClose();
    assert.equal(state.closes, 1); assert.equal(updates, 1); assert.equal(digests, 0); restore();
  }
  {
    let digests = 0;
    crypto.createHash = algorithm => {
      const actual = createHash(algorithm), update = actual.update, digest = actual.digest;
      actual.update = function (...next) { this.digest = () => assert.fail('replacement digest cannot replace original'); return update.call(this, ...next); };
      actual.digest = function (...next) { assert.equal(this, actual); digests += 1; return digest.call(this, ...next); };
      return actual;
    };
    assert.equal(await sha256File(file), expected[1]); assert.equal(digests, 1); restore();
  }
  await fs.writeFile(file, '');
  assert.equal(await sha256File(file), createHash('sha256').digest('hex'));
  assert.equal((await checksumFile(file)).value, (await checksumString('')).value);
  const controller = new AbortController(); controller.abort(); const state = intercept();
  await rejected(() => sha1File(file, { signal: controller.signal })); assert.equal(state.opens, 0);
} finally {
  restore(); setXxhashBackend(null);
  for (const close of disposal.values()) { try { await close(); } catch {} }
  await rmDirRecursive(root);
}
