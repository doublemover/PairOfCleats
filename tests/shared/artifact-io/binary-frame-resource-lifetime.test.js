import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { encodeBinaryRowFrames } from '../../../src/shared/artifact-io/binary-columnar.js';
import { iterateBinaryColumnarRowPayloads } from '../../../src/shared/artifact-io/loaders/binary-columnar.js';
import { getContainedFileSession } from '../../../src/shared/contained-file-resource.js';
import { withVerifiedArtifactReadScope } from '../../../src/shared/artifact-io/verified-read-scope.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';

// UNVALIDATED: actual disposable frame data/descriptors and inert boundary faults.
// No native binding, child, physical link, whole index or benchmark is used.
const caught = action => {
  let failed = false, error;
  try { action(); } catch (value) { failed = true; error = value; }
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
const root = await makeTempDir('poc-binary-frame-resource-');
const originalOpen = fs.openSync, originalRead = fs.readSync, originalStat = fs.fstatSync;
const originalClose = fs.closeSync, originalReadFile = fs.readFileSync;
const disposal = new Set();
const restore = () => {
  fs.openSync = originalOpen; fs.readSync = originalRead; fs.fstatSync = originalStat;
  fs.closeSync = originalClose; fs.readFileSync = originalReadFile;
};
try {
  const file = path.join(root, 'frames.bin');
  const rows = [Buffer.from('first'), Buffer.from('second-😀'), Buffer.alloc(0)];
  const encoded = encodeBinaryRowFrames(rows);
  const bytes = Buffer.concat([encoded.dataBuffer, Buffer.alloc(65536 + 17, 7)]);
  fs.writeFileSync(file, bytes);
  const makeIterator = (containedRoot, overrides = {}) => iterateBinaryColumnarRowPayloads({
    dataPath: file, offsetsPath: '', lengthsPath: '', count: rows.length,
    offsetsBuffer: encoded.offsetsBuffer, lengthsBuffer: encoded.lengthsBuffer,
    containedRoot, ...overrides
  });
  const install = ({ read = null, close = null, stat = null } = {}) => {
    const state = { fd: null, opens: 0, reads: 0, closes: 0, stats: 0 };
    fs.openSync = (target, ...args) => {
      const opened = originalOpen(target, ...args);
      if (target === file) { state.fd = opened; state.opens += 1; disposal.add(opened); }
      return opened;
    };
    fs.readSync = (fd, ...args) => {
      if (fd !== state.fd) return originalRead(fd, ...args);
      state.reads += 1;
      return read ? read(state, ...args) : originalRead(fd, ...args);
    };
    fs.fstatSync = (fd, ...args) => {
      if (fd !== state.fd) return originalStat(fd, ...args);
      state.stats += 1;
      return stat ? stat(state, ...args) : originalStat(fd, ...args);
    };
    fs.closeSync = fd => {
      if (fd !== state.fd) return originalClose(fd);
      state.closes += 1;
      if (close) return close(state);
      const result = originalClose(fd); disposal.delete(fd); return result;
    };
    fs.readFileSync = (target, ...args) => {
      if (target === file) assert.fail('frame iterator cannot materialize its full data file');
      return originalReadFile(target, ...args);
    };
    return state;
  };
  for (const containedRoot of [root, null]) {
    {
      const state = install();
      const unopened = makeIterator(containedRoot);
      assert.deepEqual(unopened.return('unused'), { value: 'unused', done: true });
      assert.equal(caught(() => makeIterator(containedRoot).throw(false)), false);
      assert.equal(state.opens, 0); assert.equal(state.closes, 0); restore();
    }
    {
      let records = 0;
      const state = install({ read: (held, buffer, offset, length, position) => {
        assert.ok(length <= 65536);
        return originalRead(held.fd, buffer, offset, Math.min(position < encoded.dataBuffer.length ? 3 : 1024, length), position);
      } });
      withVerifiedArtifactReadScope({ root, record: (target, certificate) => {
        assert.equal(target, file); assert.equal(state.closes, 1);
        assert.equal(certificate.hash, createHash('sha256').update(bytes).digest('hex')); records += 1;
      } }, () => {
        const iterator = makeIterator(containedRoot);
        assert.equal(state.opens, 0);
        assert.deepEqual(iterator.next(), { value: rows[0], done: false });
        assert.equal(state.closes, 0); assert.equal(records, 0);
        assert.equal(getContainedFileSession(iterator), null, 'a live borrower must not expose a close-only recovery handle');
        fs.readSync = () => assert.fail('later global read replacement is not the original operation');
        fs.fstatSync = () => assert.fail('later global stat replacement is not the original operation');
        fs.closeSync = () => assert.fail('later global close replacement is not the original operation');
        assert.deepEqual([...iterator], rows.slice(1));
        assert.equal(state.closes, 1); assert.equal(records, containedRoot ? 1 : 0);
        assert.equal(getContainedFileSession(iterator).isSettled(), true);
      });
      restore();
    }
    for (const mode of ['return', 'break']) {
      let records = 0;
      const state = install();
      withVerifiedArtifactReadScope({ root, record: () => { records += 1; } }, () => {
        const iterator = makeIterator(containedRoot);
        if (mode === 'return') {
          assert.deepEqual(iterator.next().value, rows[0]);
          assert.deepEqual(iterator.return('stopped'), { value: 'stopped', done: true });
        } else {
          for (const row of iterator) { assert.deepEqual(row, rows[0]); break; }
        }
        assert.equal(state.closes, 1); assert.equal(state.reads, 1); assert.equal(records, 0);
        assert.equal(getContainedFileSession(iterator).isSettled(), true);
      });
      restore();
    }
    for (const primary of [undefined, null, false, 0, '', Object.freeze(new Error('frozen read failure'))]) {
      const secondary = Object.freeze(new Error('independent original frame close failure'));
      const state = install({ read: () => { throw primary; }, close: () => { throw secondary; } });
      const iterator = makeIterator(containedRoot), failure = caught(() => iterator.next());
      const session = getContainedFileSession(failure);
      assert.equal(contains(failure, primary), true); assert.equal(contains(failure, secondary), true);
      assert.equal(getContainedFileSession(iterator), session); assert.equal(state.reads, 1); assert.equal(state.closes, 1);
      iterator.return(); iterator.next(); caught(() => session.releaseAfterCloseSync());
      assert.equal(state.closes, 1); assert.equal(state.reads, 1);
      originalClose(state.fd); disposal.delete(state.fd); assert.equal(session.isSettled(), false); restore();
    }
    for (const primary of [undefined, null, false, 0, '']) {
      const secondary = Object.freeze(new Error('independent close after delegated throw'));
      const state = install({ close: () => { throw secondary; } });
      const iterator = makeIterator(containedRoot); iterator.next();
      const failure = caught(() => iterator.throw(primary)), session = getContainedFileSession(failure);
      assert.equal(contains(failure, primary), true); assert.equal(contains(failure, secondary), true);
      assert.equal(getContainedFileSession(iterator), session); assert.equal(state.reads, 1); assert.equal(state.closes, 1);
      caught(() => session.releaseAfterCloseSync()); assert.equal(state.closes, 1);
      originalClose(state.fd); disposal.delete(state.fd); restore();
    }
    {
      let settled = false, records = 0;
      const primary = Object.assign(new Error('throw at suspended row retains original work'), {
        cacheOwnershipPending: false, cacheOwnershipReleased() { assert.equal(this, primary); return settled; }
      });
      const state = install();
      withVerifiedArtifactReadScope({ root, record: () => { records += 1; } }, () => {
        const iterator = makeIterator(containedRoot); iterator.next();
        const failure = caught(() => iterator.throw(primary)), session = getContainedFileSession(failure);
        assert.equal(contains(failure, primary), true); assert.equal(state.closes, 0);
        assert.equal(getContainedFileSession(iterator), session);
        assert.equal(getContainedFileSession({ containedFileSession: { ...session } }), null);
        primary.cacheOwnershipReleased = () => true;
        caught(() => session.releaseAfterCloseSync()); assert.equal(state.closes, 0);
        fs.closeSync = () => assert.fail('explicit first close must keep its original method');
        settled = true;
        assert.deepEqual(session.releaseAfterCloseSync(), { resourceId: session.resourceId, settled: true, pending: false });
        assert.equal(state.closes, 1); assert.equal(state.reads, 1); assert.equal(records, 0);
        assert.equal(failure.cacheOwnershipReleased(), true); assert.equal(iterator.next().done, true);
      });
      restore();
    }
    for (const returned of [false, undefined]) {
      let records = 0;
      const state = install({ close: () => {
        if (returned === undefined) throw Object.freeze(new Error('close after final yielded frame'));
        return returned;
      } });
      withVerifiedArtifactReadScope({ root, record: () => { records += 1; } }, () => {
        const iterator = makeIterator(containedRoot);
        for (const row of rows) assert.deepEqual(iterator.next().value, row);
        const failure = caught(() => iterator.next()), session = getContainedFileSession(failure);
        assert.equal(state.closes, 1); assert.equal(records, 0);
        caught(() => session.releaseAfterCloseSync()); assert.equal(state.closes, 1);
      });
      originalClose(state.fd); disposal.delete(state.fd); restore();
    }
    for (const progress of [0, -1, NaN, 0.5, rows[0].length + 1]) {
      const state = install({ read: () => progress });
      const iterator = makeIterator(containedRoot), failure = caught(() => iterator.next());
      assert.equal(state.closes, 1); assert.equal(state.reads, 1);
      assert.equal(getContainedFileSession(failure), null); assert.equal(getContainedFileSession(iterator).isSettled(), true); restore();
    }
    {
      const state = install({ stat: (held, ...args) => {
        const actual = originalStat(held.fd, ...args);
        if (args[0]?.bigint || held.reads === 0) return actual;
        return new Proxy(actual, { get: (value, key) => key === 'size' ? actual.size + 1 : Reflect.get(value, key) });
      } });
      const iterator = makeIterator(containedRoot);
      for (const row of rows) assert.deepEqual(iterator.next().value, row);
      assert.equal(caught(() => iterator.next()).code, 'ERR_FILE_CHANGED'); assert.equal(state.closes, 1); restore();
    }
  }
  assert.deepEqual(fs.readFileSync(file), bytes);
} finally {
  restore();
  for (const fd of disposal) { try { originalClose(fd); } catch {} }
  await rmDirRecursive(root);
}
console.log('binary-frame-resource-lifetime passed');
