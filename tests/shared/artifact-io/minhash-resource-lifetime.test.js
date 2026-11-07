import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { MINHASH_HASH_IDENTITY } from '../../../src/index/minhash.js';
import { loadMinhashSignatureRows } from '../../../src/shared/artifact-io/loaders.js';
import { getContainedFileSession } from '../../../src/shared/contained-file-resource.js';
import { iterateContainedFile } from '../../../src/shared/contained-file.js';
import { writePiecesManifest } from '../../helpers/artifact-io-fixture.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';

// UNVALIDATED: actual async generators, FileHandles and canonical packed bytes.
// No child, whole index, native binding, physical link or benchmark.
const rejected = async action => {
  let failed = false, error;
  try { await action(); } catch (value) { failed = true; error = value; }
  assert.equal(failed, true); return error;
};
const contains = (value, expected, matches = candidate => candidate === expected) => {
  const queue = [value], seen = new Set();
  while (queue.length) {
    const current = queue.pop(); if (matches(current)) return true;
    if (current === null || !['object', 'function'].includes(typeof current) || seen.has(current)) continue;
    seen.add(current);
    if (Object.hasOwn(current, 'cause')) queue.push(current.cause);
    if (Array.isArray(current.errors)) queue.push(...current.errors);
  }
  return false;
};
const root = await makeTempDir('poc-minhash-resource-'), originalOpen = fs.open;
const disposal = new Map();
try {
  const signatures = Array.from({ length: 5 }, (_, row) => [row * 100 + 1, row * 100 + 2, row * 100 + 3]);
  const family = async (name, { corrupt = false, short = false } = {}) => {
    const dir = path.join(root, name); await fs.mkdir(dir);
    const data = path.join(dir, 'minhash_signatures.packed.bin'), buffer = Buffer.alloc(signatures.length * 3 * 4);
    signatures.flat().forEach((value, index) => buffer.writeUInt32LE(value, index * 4));
    const checksum = `sha256:${createHash('sha256').update(buffer).digest('hex')}`;
    if (corrupt) buffer[0] ^= 0xff;
    await fs.writeFile(data, short ? buffer.subarray(0, buffer.length - 4) : buffer);
    await fs.writeFile(path.join(dir, 'minhash_signatures.packed.meta.json'), JSON.stringify({ fields: {
      hashIdentity: MINHASH_HASH_IDENTITY, format: 'u32', endian: 'le', dims: 3, count: signatures.length, checksum
    } }));
    await writePiecesManifest(dir, [
      { name: 'minhash_signatures', path: path.basename(data), format: 'packed' },
      { name: 'minhash_signatures_meta', path: 'minhash_signatures.packed.meta.json', format: 'json' }
    ]);
    return { dir, data };
  };
  const valid = await family('valid'), corrupt = await family('corrupt', { corrupt: true }), short = await family('short', { short: true });
  const install = (selected, { read = null, stat = null, close = null } = {}) => {
    const state = { handle: null, opens: 0, reads: 0, closes: 0, stats: 0 };
    fs.open = async (...args) => {
      const actual = await originalOpen(...args);
      if (args[0] !== selected.data) return actual;
      const originalRead = actual.read, originalStat = actual.stat, originalClose = actual.close;
      state.handle = actual; state.opens += 1; disposal.set(actual, () => originalClose.call(actual));
      actual.read = function (...readArgs) {
        assert.equal(this, actual); state.reads += 1;
        const native = (...next) => originalRead.call(actual, ...next);
        return read ? read(state, native, ...readArgs) : native(...readArgs);
      };
      actual.stat = function (...statArgs) {
        assert.equal(this, actual); state.stats += 1;
        const native = (...next) => originalStat.call(actual, ...next);
        return stat ? stat(state, native, ...statArgs) : native(...statArgs);
      };
      actual.close = function () {
        assert.equal(this, actual); state.closes += 1;
        const native = async () => { const result = await originalClose.call(actual); disposal.delete(actual); return result; };
        return close ? close(state, native) : native();
      };
      return actual;
    };
    return state;
  };
  const load = (selected, strict, options = {}) => loadMinhashSignatureRows(selected.dir, { strict, batchSize: 2, ...options });
  for (const strict of [true, false]) {
    {
      const state = install(valid), iterator = load(valid, strict);
      assert.deepEqual(await iterator.return('unused'), { value: 'unused', done: true });
      assert.equal(await rejected(() => load(valid, strict).throw(false)), false);
      assert.equal(state.opens, 0); fs.open = originalOpen;
    }
    {
      const state = install(valid, { read: (held, native, buffer, offset, length, position) => {
        void held; assert.ok(length <= 2 * 3 * 4); return native(buffer, offset, Math.min(5, length), position);
      } });
      const iterator = load(valid, strict), first = await iterator.next();
      assert.equal(state.opens, 1); assert.equal(state.closes, 0);
      assert.deepEqual(Array.from(first.value.sig), signatures[0]);
      state.handle.read = () => assert.fail('later handle read replacement is not original authority');
      state.handle.stat = () => assert.fail('later handle stat replacement is not original authority');
      state.handle.close = () => assert.fail('later handle close replacement is not original authority');
      const rows = [first.value]; for await (const row of iterator) rows.push(row);
      assert.equal(state.closes, 1); assert.ok(state.reads > 3);
      assert.deepEqual(rows.map(row => Array.from(row.sig)), signatures);
      assert.deepEqual(rows.map(row => row.docId), [0, 1, 2, 3, 4]);
      assert.deepEqual(rows[0].hashIdentity, MINHASH_HASH_IDENTITY); fs.open = originalOpen;
    }
    for (const mode of ['return', 'break', 'body-throw']) {
      const state = install(valid), iterator = load(valid, strict), primary = Object.freeze(new Error('ordinary MinHash consumer failed'));
      if (mode === 'return') {
        await iterator.next(); assert.deepEqual(await iterator.return('early'), { value: 'early', done: true });
      } else if (mode === 'break') {
        for await (const row of iterator) { assert.equal(row.docId, 0); break; }
      } else {
        assert.equal(await rejected(async () => { for await (const row of iterator) { void row; throw primary; } }), primary);
      }
      assert.equal(state.closes, 1); assert.equal(state.reads, 1); fs.open = originalOpen;
    }
    for (const primary of [undefined, null, false, 0, '', Object.freeze(new Error('original frozen MinHash read'))]) {
      let failClose = true;
      const secondary = Object.freeze(new Error('independent original MinHash close'));
      const state = install(valid, { read: () => { throw primary; }, close: (held, native) => {
        void held; if (failClose) throw secondary; return native();
      } });
      const iterator = load(valid, strict), failure = await rejected(() => iterator.next()), session = getContainedFileSession(failure);
      assert.equal(contains(failure, primary), true); assert.equal(contains(failure, secondary), true);
      assert.equal(state.closes, 1); assert.equal(state.reads, 1);
      state.handle.close = () => assert.fail('recovery must retain original FileHandle close');
      failClose = false;
      assert.deepEqual(await session.releaseAfterClose(), { resourceId: session.resourceId, settled: true, pending: false });
      assert.equal(state.closes, 2); assert.equal(state.reads, 1); assert.equal((await iterator.next()).done, true);
      assert.equal(failure.cacheOwnershipReleased(), true); fs.open = originalOpen;
    }
    for (const source of ['read', 'throw']) {
      let settled = false;
      const primary = Object.assign(new Error('original MinHash native work remains pending'), {
        cacheOwnershipPending: false, cacheOwnershipReleased() { assert.equal(this, primary); return settled; }
      });
      const state = install(valid, source === 'read' ? { read: () => { throw primary; } } : {});
      const iterator = load(valid, strict);
      if (source === 'throw') await iterator.next();
      const failure = await rejected(() => source === 'read' ? iterator.next() : iterator.throw(primary));
      const session = getContainedFileSession(failure);
      assert.equal(state.closes, 0); assert.equal(contains(failure, primary), true);
      primary.cacheOwnershipReleased = () => true;
      await rejected(() => session.releaseAfterClose()); assert.equal(state.closes, 0);
      settled = true; await session.releaseAfterClose(); assert.equal(state.closes, 1); assert.equal(state.reads, 1);
      assert.equal((await iterator.next()).done, true); fs.open = originalOpen;
    }
    for (const primary of [undefined, null, false, 0, '']) {
      let failClose = true;
      const secondary = Object.freeze(new Error('original close after falsey async throw'));
      const state = install(valid, { close: (held, native) => { void held; if (failClose) throw secondary; return native(); } });
      const iterator = load(valid, strict); await iterator.next();
      const failure = await rejected(() => iterator.throw(primary));
      assert.equal(contains(failure, primary), true); assert.equal(contains(failure, secondary), true);
      assert.equal(state.closes, 1); assert.equal(state.reads, 1);
      failClose = false; await getContainedFileSession(failure).releaseAfterClose();
      assert.equal(state.closes, 2); assert.equal(state.reads, 1); fs.open = originalOpen;
    }
    for (const early of [false, true]) {
      let failClose = true;
      const secondary = Object.freeze(new Error('close after yielded MinHash signature'));
      const state = install(valid, { close: (held, native) => { void held; if (failClose) throw secondary; return native(); } });
      const iterator = load(valid, strict);
      if (early) await iterator.next();
      else for (let index = 0; index < signatures.length; index += 1) assert.equal((await iterator.next()).value.docId, index);
      const failure = await rejected(() => early ? iterator.return() : iterator.next()), session = getContainedFileSession(failure);
      assert.equal(contains(failure, secondary), true); assert.equal(state.closes, 1);
      const reads = state.reads; failClose = false; await session.releaseAfterClose();
      assert.equal(state.closes, 2); assert.equal(state.reads, reads); assert.equal((await iterator.next()).done, true); fs.open = originalOpen;
    }
    {
      let failClose = true, emitted = 0;
      const secondary = Object.freeze(new Error('checksum rejection plus independent close'));
      const state = install(corrupt, { close: (held, native) => { void held; if (failClose) throw secondary; return native(); } });
      const failure = await rejected(async () => { for await (const row of load(corrupt, strict)) { void row; emitted += 1; } });
      assert.equal(emitted, signatures.length, 'existing streaming protocol verifies checksum at final exhaustion');
      assert.equal(contains(failure, null, value => value instanceof Error && /checksum mismatch/.test(value.message)), true);
      assert.equal(contains(failure, secondary), true); const reads = state.reads;
      failClose = false; await getContainedFileSession(failure).releaseAfterClose();
      assert.equal(state.closes, 2); assert.equal(state.reads, reads); fs.open = originalOpen;
    }
    {
      const state = install(short);
      const failure = await rejected(() => load(short, strict).next());
      assert.equal(failure.code, 'ERR_ARTIFACT_CORRUPT'); assert.equal(state.reads, 0); assert.equal(state.closes, 1); fs.open = originalOpen;
    }
    {
      let reportVoid = false;
      const state = install(valid, { close: (held, native) => { void held; return reportVoid ? native() : false; } });
      const failure = await rejected(async () => { for await (const row of load(valid, strict)) void row; });
      assert.equal(state.closes, 1); const reads = state.reads;
      reportVoid = true; await getContainedFileSession(failure).releaseAfterClose();
      assert.equal(state.closes, 2); assert.equal(state.reads, reads); fs.open = originalOpen;
    }
    {
      const state = install(valid, { stat: async (held, native, ...args) => {
        const result = await native(...args);
        return held.reads ? new Proxy(result, { get: (actual, key) => key === 'mtimeMs' ? result.mtimeMs + 1 : Reflect.get(actual, key) }) : result;
      } });
      const failure = await rejected(async () => { for await (const row of load(valid, strict)) void row; });
      assert.equal(failure.code, 'ERR_FILE_CHANGED'); assert.equal(state.closes, 1); fs.open = originalOpen;
    }
  }
  {
    let admitRead, started;
    const readGate = new Promise(resolve => { admitRead = resolve; });
    const readStarted = new Promise(resolve => { started = resolve; });
    const state = install(valid, { read: async (held, native, ...args) => {
      void held; started(); await readGate; return native(...args);
    } });
    let reading, completed = 0, borrowed;
    const iterator = iterateContainedFile(valid.dir, valid.data, async function* (descriptor) {
      borrowed = descriptor; reading = descriptor.read(Buffer.alloc(4), 0, 4, 0); yield 'admitted';
      await reading;
    }, { onComplete: () => { completed += 1; } });
    assert.equal((await iterator.next()).value, 'admitted'); await readStarted;
    assert.equal(getContainedFileSession(iterator), null);
    const returning = iterator.return('stop'); await Promise.resolve();
    assert.equal(state.closes, 0, 'return must drain actual admitted native read before close');
    admitRead(); assert.deepEqual(await returning, { value: 'stop', done: true }); await reading;
    assert.equal(state.closes, 1); assert.equal(completed, 0); assert.equal(getContainedFileSession(iterator).isSettled(), true);
    await rejected(() => borrowed.read(Buffer.alloc(1), 0, 1, 0)); assert.equal(state.reads, 1); fs.open = originalOpen;
  }
  {
    const state = install(valid); let completed = 0;
    const iterator = iterateContainedFile(valid.dir, valid.data, async function* (descriptor) {
      const result = await descriptor.read(Buffer.alloc(4), 0, 4, 0); yield result.bytesRead;
    }, { onComplete: () => { assert.equal(state.closes, 1); completed += 1; } });
    assert.equal((await iterator.next()).value, 4); assert.equal(completed, 0);
    assert.equal((await iterator.next()).done, true); assert.equal(completed, 1); fs.open = originalOpen;
  }
} finally {
  fs.open = originalOpen;
  for (const close of disposal.values()) { try { await close(); } catch {} }
  await rmDirRecursive(root);
}
console.log('minhash-resource-lifetime passed');
