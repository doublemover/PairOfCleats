import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRecoveryFixture, semanticNode } from '../../helpers/semantic-recovery.js';
import { getContainedFileSession } from '../../../src/shared/contained-file-resource.js';

// UNVALIDATED: actual retained source/header/node files and original descriptor
// methods. No symlinks, native processes or working-tree fallback are required.
const hash = value => createHash('sha256').update(value).digest('hex');
const visit = (failure, inspect) => {
  const pending = [failure], seen = new Set();
  while (pending.length) {
    const value = pending.pop(); inspect(value);
    if (value === null || !['object', 'function'].includes(typeof value) || seen.has(value)) continue;
    seen.add(value);
    if (Object.hasOwn(value, 'cause')) pending.push(value.cause);
    if (Array.isArray(value.errors)) pending.push(...value.errors);
  }
};
const contains = (failure, expected) => {
  let found = false; visit(failure, value => { if (value === expected) found = true; }); return found;
};
const rejected = async run => {
  let failed = false, failure;
  try { await run(); } catch (value) { failed = true; failure = value; }
  assert.equal(failed, true); return failure;
};
const originalOpen = fs.open, originalReadFile = fs.readFile, disposal = new Map();
const f = await createRecoveryFixture('\uFEFF' + 'a'.repeat(65531) + '🧭\r\nend');
try {
  const syntax = await f.write([semanticNode(0, f.source.textLength)]), store = f.store([syntax]);
  const ref = { partitionId: syntax.partitionId, localId: 0 };
  const target = path.resolve(f.stagingRoot, 'semantic-sources', f.source.byteHash + '.utf8');
  const install = ({ read = null, stat = null, close = null } = {}) => {
    const states = [];
    fs.readFile = function (file, ...args) {
      assert.notEqual(path.resolve(String(file)), target, 'retained sources never use unbounded raw readFile');
      return originalReadFile.call(fs, file, ...args);
    };
    fs.open = async (file, ...args) => {
      const handle = await originalOpen(file, ...args);
      if (path.resolve(String(file)) !== target) return handle;
      const nativeRead = handle.read, nativeStat = handle.stat, nativeClose = handle.close;
      const state = { handle, reads: 0, readBytes: 0, maxBuffer: 0, maxRequest: 0, stats: 0, closes: 0 };
      states.push(state); disposal.set(handle, () => nativeClose.call(handle));
      handle.read = async function (buffer, offset, length, position) {
        assert.equal(this, handle); state.reads++; state.maxBuffer = Math.max(state.maxBuffer, buffer.length);
        state.maxRequest = Math.max(state.maxRequest, length);
        const native = async (nextLength = length) => {
          const value = await nativeRead.call(handle, buffer, offset, Math.min(length, nextLength), position);
          state.readBytes += value.bytesRead; return value;
        };
        return read ? read(state, native) : native();
      };
      handle.stat = async function () {
        assert.equal(this, handle); state.stats++;
        const native = () => nativeStat.call(handle);
        return stat ? stat(state, native) : native();
      };
      handle.close = function () {
        assert.equal(this, handle); state.closes++;
        const native = async () => { const value = await nativeClose.call(handle); disposal.delete(handle); return value; };
        return close ? close(state, native) : native();
      };
      return handle;
    };
    return states;
  };
  const restore = () => { fs.open = originalOpen; fs.readFile = originalReadFile; };
  const run = mode => mode === 'excerpt' ? store.getSourceSpans([ref]) : store.verifySource(f.source);
  await fs.writeFile(f.original, 'working tree changed');
  for (const mode of ['excerpt', 'verify']) {
    const states = install({ read: (state, native) => state.reads === 1 ? native(7) : native() });
    const result = await run(mode);
    if (mode === 'excerpt') assert.equal(result[0].text, f.bytes.toString('utf8'));
    assert.equal(states.length, 1);
    assert.ok(states[0].maxRequest <= 65536);
    assert.ok(states[0].maxBuffer <= (mode === 'excerpt' ? f.bytes.length : 65536));
    assert.equal(states[0].closes, 1); assert.equal(states[0].handle.fd, -1);
    restore();
  }
  for (const mode of ['excerpt', 'verify']) {
    const states = install({ async stat(state, native) {
      const result = await native();
      if (state.stats === 1) await fs.appendFile(target, Buffer.alloc(4096, 120));
      return result;
    } });
    await assert.rejects(run(mode), { code: 'ERR_SEMANTIC_INTEGRITY' },
      'growth is source corruption, not an ordinary page output allowance');
    assert.equal(states.length, 1);
    assert.ok(states[0].readBytes <= f.bytes.length + 1);
    assert.ok(states[0].maxRequest <= 65536);
    assert.equal(states[0].handle.fd, -1);
    restore(); await fs.writeFile(target, f.bytes);
  }
  for (const mode of ['excerpt', 'verify']) for (const readFailure of [false, true]) {
    let deny = true;
    const original = Object.freeze(Object.assign(new Error('original retained source close rejected'), { code: 'ERR_FILE_TOO_LARGE' }));
    const states = install({
      read: readFailure ? () => { throw 0; } : null,
      close: (_state, native) => { if (deny) throw original; return native(); }
    });
    const failure = await rejected(() => run(mode));
    assert.equal(contains(failure, original), true);
    if (readFailure) assert.equal(contains(failure, 0), true);
    assert.equal(failure.cacheOwnershipReleased(), false);
    assert.equal(states.length, 1); assert.equal(states[0].closes, 1);
    const sessions = new Set(); visit(failure, value => { const session = getContainedFileSession(value); if (session) sessions.add(session); });
    assert.ok(sessions.size > 0);
    const reads = states[0].reads; deny = false;
    for (const session of sessions) {
      const receipt = await session.releaseAfterClose(); assert.equal(receipt.pending, false); assert.equal(receipt.settled, true);
    }
    assert.equal(states[0].reads, reads); assert.equal(states[0].closes, 2); assert.equal(states[0].handle.fd, -1);
    assert.equal(failure.cacheOwnershipReleased(), true); restore();
  }
  for (const mode of ['excerpt', 'verify']) {
    const controller = new AbortController();
    const states = install({ close: async (_state, native) => { controller.abort(); return native(); } });
    const failure = await rejected(() => mode === 'excerpt'
      ? store.getSourceSpans([ref], { signal: controller.signal })
      : store.verifySource(f.source, { signal: controller.signal }));
    assert.equal(contains(failure, controller.signal.reason), true);
    assert.equal(states[0].handle.fd, -1); assert.equal(states[0].closes, 1); restore();
  }
  for (const kind of ['code', undefined, null, false, 0, '', 'pending-inspection']) {
    let settled = true, inspectionSettled = false;
    const inspection = kind === 'pending-inspection' ? Object.freeze(Object.assign(new Error('source code inspection owns work'), {
      cacheOwnershipReleased: () => inspectionSettled
    })) : kind;
    const primary = Object.defineProperties(new Error('retained source read rejected'), {
      cacheOwnershipReleased: { value() { assert.equal(this, primary); return settled; }, writable: true },
      code: { get() {
        primary.cacheOwnershipReleased = () => true; settled = false;
        if (kind !== 'code') throw inspection; return 'ERR_FILE_INTEGRITY';
      } }
    });
    const states = install({ read: () => { throw primary; } });
    const failure = await rejected(() => store.verifySource(f.source));
    assert.equal(contains(failure, primary), true);
    if (kind !== 'code') assert.equal(contains(failure, inspection), true);
    assert.equal(states[0].handle.fd, -1); assert.equal(states[0].closes, 1);
    assert.equal(failure.cacheOwnershipReleased(), false);
    settled = true; inspectionSettled = true; assert.equal(failure.cacheOwnershipReleased(), true); restore();
  }
  const supplied = structuredClone(f.source);
  const states = install({ read: (_state, native) => {
    supplied.byteHash = '0'.repeat(64); supplied.textHash = '0'.repeat(64);
    supplied.byteLength = 1; supplied.textLength = 1; supplied.encoding = 'binary'; return native();
  } });
  await store.verifySource(supplied);
  assert.equal(states.length, 1); assert.equal(states[0].handle.fd, -1); restore();
  const changed = Buffer.from(f.bytes); changed[5] ^= 1;
  await fs.writeFile(target, changed);
  const corruptIdentity = structuredClone(f.source);
  install({ read: (_state, native) => {
    corruptIdentity.byteHash = hash(changed); corruptIdentity.textHash = hash(changed); return native();
  } });
  await assert.rejects(store.verifySource(corruptIdentity), { code: 'ERR_SEMANTIC_INTEGRITY' },
    'a caller cannot bless changed retained bytes by mutating expected hashes during the read');
  restore(); await fs.writeFile(target, f.bytes);
  await store.verifySource(f.source, { spans: [[65532, 65534]] });
  assert.equal((await store.getSourceSpans([ref]))[0].text, f.bytes.toString('utf8'));
  const limitStore = f.store([syntax], { maxRecordBytes: f.bytes.length - 1 });
  await assert.rejects(limitStore.getSourceSpans([ref]), { code: 'ERR_SEMANTIC_OUTPUT_LIMIT' });
  await assert.rejects(store.getSourceSpans([ref], { maxBytes: 1 }), { code: 'ERR_SEMANTIC_OUTPUT_LIMIT' });
  console.log('Retained source readers preserve descriptor ownership, byte bounds and submitted identities');
} finally {
  fs.open = originalOpen; fs.readFile = originalReadFile;
  for (const dispose of disposal.values()) await dispose();
  await f.cleanup();
}
