import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { encodeVarintDeltas, readVarintDeltasAt } from '../../../src/shared/artifact-io/varint.js';
import { loadSymbolOccurrencesByFile } from '../../../src/shared/artifact-io/loaders.js';
import { getContainedFileSession } from '../../../src/shared/contained-file-resource.js';
import { OFFSETS_FORMAT, OFFSETS_FORMAT_VERSION, OFFSETS_COMPRESSION } from '../../../src/shared/artifact-io/offsets.js';
import { writePiecesManifest } from '../../helpers/artifact-io-fixture.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';

// UNVALIDATED: actual positioned decoder, public by-file consumer and disposable
// FileHandles. Explicit recovery closes only; no index, native binding or child.
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
const root = await makeTempDir('poc-varint-resource-');
const originalOpen = fsp.open, originalReadFile = fs.readFileSync;
const disposal = new Map();
try {
  const file = path.join(root, 'values.bin'), values = [1, 129, 5000];
  const bytes = encodeVarintDeltas(values); await fsp.writeFile(file, bytes);
  const install = (target, { read = null, close = null } = {}) => {
    const state = { opens: 0, reads: 0, closes: 0, handle: null };
    fsp.open = async (...args) => {
      const actual = await originalOpen(...args);
      if (args[0] !== target) return actual;
      const nativeRead = actual.read, nativeClose = actual.close;
      state.handle = actual; state.opens += 1; disposal.set(actual, () => nativeClose.call(actual));
      actual.read = function (...readArgs) {
        assert.equal(this, actual); state.reads += 1;
        return read ? read(state, (...next) => nativeRead.call(actual, ...next), ...readArgs) : nativeRead.call(actual, ...readArgs);
      };
      actual.close = async function () {
        assert.equal(this, actual); state.closes += 1;
        if (close) return close(state, async () => { const result = await nativeClose.call(actual); disposal.delete(actual); return result; });
        const result = await nativeClose.call(actual); disposal.delete(actual); return result;
      };
      return actual;
    };
    return state;
  };
  {
    const state = install(file, { read: (held, native, buffer, offset, length, position) => {
      void held; return native(buffer, offset, Math.min(1, length), position);
    } });
    assert.deepEqual(await readVarintDeltasAt(file, 0, bytes.length), values);
    assert.ok(state.reads > 1); assert.equal(state.closes, 1);
    assert.deepEqual(await readVarintDeltasAt(file, 1, 1), []); assert.equal(state.opens, 1); fsp.open = originalOpen;
  }
  for (const primary of [undefined, null, false, 0, '', Object.freeze(new Error('frozen original varint read'))]) {
    const secondary = Object.freeze(new Error('independent exact varint FileHandle close'));
    let failClose = true;
    const state = install(file, { read: () => { throw primary; }, close: (held, native) => {
      void held; if (failClose) throw secondary; return native();
    } });
    const failure = await rejected(() => readVarintDeltasAt(file, 0, bytes.length)), session = getContainedFileSession(failure);
    assert.equal(contains(failure, primary), true); assert.equal(contains(failure, secondary), true);
    assert.equal(state.reads, 1); assert.equal(state.closes, 1); assert.ok(session);
    state.handle.close = () => assert.fail('recovery cannot use a replacement handle close');
    failClose = false;
    assert.deepEqual(await session.releaseAfterClose(), { resourceId: session.resourceId, settled: true, pending: false });
    assert.equal(state.closes, 2); assert.equal(state.reads, 1); assert.equal(failure.cacheOwnershipReleased(), true);
    fsp.open = originalOpen;
  }
  {
    let settled = false;
    const primary = Object.assign(new Error('positioned read still owns native work'), {
      cacheOwnershipPending: false, cacheOwnershipReleased() { assert.equal(this, primary); return settled; }
    });
    const state = install(file, { read: () => { throw primary; } });
    const failure = await rejected(() => readVarintDeltasAt(file, 0, bytes.length)), session = getContainedFileSession(failure);
    assert.equal(state.closes, 0); primary.cacheOwnershipReleased = () => true;
    await rejected(() => session.releaseAfterClose()); assert.equal(state.closes, 0);
    settled = true; await session.releaseAfterClose(); assert.equal(state.closes, 1); assert.equal(state.reads, 1);
    fsp.open = originalOpen;
  }
  for (const returned of [false, null, 0]) {
    let reportVoid = false;
    const state = install(file, { close: (held, native) => { void held; return reportVoid ? native() : returned; } });
    const failure = await rejected(() => readVarintDeltasAt(file, 0, bytes.length)), session = getContainedFileSession(failure);
    assert.equal(state.closes, 1); reportVoid = true; await session.releaseAfterClose();
    assert.equal(state.closes, 2); assert.equal(state.reads, 1); fsp.open = originalOpen;
  }
  {
    const dir = path.join(root, 'by-file'); await fsp.mkdir(dir);
    const rows = [
      { v: 1, host: { file: 'src/a.js', chunkUid: 'a' }, role: 'decl', ref: { name: 'a' } },
      { v: 1, host: { file: 'src/b.js', chunkUid: 'b' }, role: 'decl', ref: { name: 'b' } }
    ];
    const lines = rows.map(row => `${JSON.stringify(row)}\n`), jsonl = path.join(dir, 'symbol_occurrences.jsonl');
    const data = path.join(dir, 'symbol_occurrences.by-file.bin');
    const u64 = entries => { const buffer = Buffer.alloc(entries.length * 8); entries.forEach((value, index) => buffer.writeBigUInt64LE(BigInt(value), index * 8)); return buffer; };
    await fsp.writeFile(jsonl, lines.join(''));
    await fsp.writeFile(path.join(dir, 'symbol_occurrences.jsonl.offsets.bin'), u64([0, Buffer.byteLength(lines[0])]));
    await fsp.writeFile(data, encodeVarintDeltas([0]));
    await fsp.writeFile(path.join(dir, 'symbol_occurrences.by-file.offsets.bin'), u64([0, 1]));
    await fsp.writeFile(path.join(dir, 'symbol_occurrences.by-file.meta.json'), JSON.stringify({
      data: path.basename(data), offsets: { path: 'symbol_occurrences.by-file.offsets.bin',
        format: OFFSETS_FORMAT, version: OFFSETS_FORMAT_VERSION, compression: OFFSETS_COMPRESSION },
      jsonl: { parts: [path.basename(jsonl)], counts: [2], offsets: ['symbol_occurrences.jsonl.offsets.bin'] }
    }));
    await writePiecesManifest(dir, [
      { name: 'symbol_occurrences', path: path.basename(jsonl) },
      { name: 'symbol_occurrences_by_file_meta', path: 'symbol_occurrences.by-file.meta.json', format: 'json' }
    ]);
    let fullReads = 0;
    fs.readFileSync = (target, ...args) => { if (target === jsonl) fullReads += 1; return originalReadFile(target, ...args); };
    const load = () => loadSymbolOccurrencesByFile(dir, { fileId: 0, filePath: 'src/a.js', strict: false });
    assert.deepEqual(await load(), [rows[0]]); assert.equal(fullReads, 0, 'valid indexed lookup remains positioned');
    for (const readFailure of [false, true]) {
      let failClose = true;
      const primary = Object.freeze(new Error('by-file varint read failed'));
      const secondary = Object.freeze(new Error('by-file varint close failed'));
      const state = install(data, { read: readFailure ? () => { throw primary; } : null,
        close: (held, native) => { void held; if (failClose) throw secondary; return native(); } });
      const failure = await rejected(load), session = getContainedFileSession(failure);
      assert.equal(contains(failure, secondary), true); if (readFailure) assert.equal(contains(failure, primary), true);
      assert.equal(fullReads, 0, 'pending exact varint owner cannot trigger a full artifact fallback');
      assert.equal(state.opens, 1); assert.equal(state.closes, 1);
      failClose = false; await session.releaseAfterClose(); assert.equal(state.closes, 2); assert.equal(state.reads, 1);
      fsp.open = originalOpen;
    }
    {
      let settled = false;
      const primary = Object.assign(new Error('by-file original native read pending'), {
        cacheOwnershipReleased() { assert.equal(this, primary); return settled; }
      });
      const state = install(data, { read: () => { throw primary; } });
      const failure = await rejected(load), session = getContainedFileSession(failure);
      assert.equal(state.closes, 0); assert.equal(fullReads, 0);
      primary.cacheOwnershipReleased = () => true; await rejected(() => session.releaseAfterClose());
      assert.equal(state.closes, 0); settled = true; await session.releaseAfterClose();
      assert.equal(state.closes, 1); assert.equal(state.reads, 1); assert.equal(fullReads, 0); fsp.open = originalOpen;
    }
    {
      let failClose = true;
      const secondary = Object.freeze(new Error('by-file offsets reader close failed before varint admission'));
      const state = install(path.join(dir, 'symbol_occurrences.by-file.offsets.bin'), {
        close: (held, native) => { void held; if (failClose) throw secondary; return native(); }
      });
      const installedOpen = fsp.open; let varintOpens = 0;
      fsp.open = (...args) => { if (args[0] === data) varintOpens += 1; return installedOpen(...args); };
      const failure = await rejected(load), session = getContainedFileSession(failure);
      assert.equal(contains(failure, secondary), true); assert.equal(fullReads, 0);
      assert.equal(state.opens, 1); assert.equal(state.closes, 1); assert.equal(state.reads, 1); assert.equal(varintOpens, 0);
      failClose = false; await session.releaseAfterClose(); assert.equal(state.closes, 2); assert.equal(state.reads, 1);
      assert.equal(varintOpens, 0);
      fsp.open = originalOpen;
    }
    await fsp.writeFile(data, Buffer.from([0x80]));
    assert.deepEqual(await load(), [rows[0]]); assert.equal(fullReads, 1, 'ordinary malformed varint retains the documented scan fallback');
    fs.readFileSync = originalReadFile;
  }
  assert.deepEqual(await fsp.readFile(file), bytes);
} finally {
  fsp.open = originalOpen; fs.readFileSync = originalReadFile;
  for (const close of disposal.values()) { try { await close(); } catch {} }
  await rmDirRecursive(root);
}
console.log('varint-resource-lifetime passed');
