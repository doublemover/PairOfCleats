import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { getContainedFileSession, openContainedFileSync, readVerifiedContainedFileSync } from '../../src/shared/contained-file.js';
import { withVerifiedArtifactReadScope } from '../../src/shared/artifact-io/verified-read-scope.js';
import { makeTempDir, rmDirRecursive } from '../helpers/temp.js';

// UNVALIDATED: actual disposable sync fds. A failed numeric close is unknown,
// and fixture teardown does not confer a session settlement receipt.
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
const root = await makeTempDir('poc-contained-sync-resource-');
const originalOpen = fs.openSync, originalClose = fs.closeSync, originalRead = fs.readSync, originalStat = fs.fstatSync;
const disposal = new Set();
try {
  const file = path.join(root, 'data'), body = Buffer.from('original sync bytes'); fs.writeFileSync(file, body);
  let records = 0;
  const read = () => withVerifiedArtifactReadScope({ root, record: () => { records += 1; } },
    () => readVerifiedContainedFileSync(root, file));
  assert.deepEqual(read().buffer, body); assert.equal(records, 1);
  for (const primary of [undefined, null, false, 0, '', Object.freeze(Object.defineProperty(new Error('readonly primary'), 'code', { value: 'EORIGINAL' }))]) {
    let fd, reads = 0, closes = 0;
    const secondary = Object.freeze(new Error('independent sync close rejected'));
    fs.openSync = (target, ...args) => {
      const opened = originalOpen(target, ...args); if (target === file) { fd = opened; disposal.add(opened); } return opened;
    };
    fs.readSync = (opened, ...args) => { if (opened === fd) { reads += 1; throw primary; } return originalRead(opened, ...args); };
    fs.closeSync = opened => { if (opened === fd) { closes += 1; throw secondary; } return originalClose(opened); };
    const failure = caught(read), session = getContainedFileSession(failure);
    assert.equal(contains(failure, primary), true); assert.equal(contains(failure, secondary), true);
    assert.equal(reads, 1); assert.equal(closes, 1); assert.equal(records, 1);
    assert.equal(session.isSettled(), false);
    if (primary instanceof Error) {
      assert.equal(failure.cause, primary); assert.equal(failure.code, 'EORIGINAL');
      assert.equal(Object.getOwnPropertyDescriptor(failure, 'code').writable, false);
    }
    const before = originalStat(fd, { bigint: true });
    fs.closeSync = () => assert.fail('a replacement numeric close cannot establish descriptor generation');
    const retry = caught(() => session.releaseAfterCloseSync());
    assert.equal(getContainedFileSession(retry), session); assert.equal(closes, 1); assert.equal(reads, 1);
    const after = originalStat(fd, { bigint: true });
    assert.equal(after.dev, before.dev); assert.equal(after.ino, before.ino);
    assert.equal(failure.cacheOwnershipReleased(), false, 'matching inode/fd cannot settle an unconfirmed close');
    originalClose(fd); disposal.delete(fd);
    assert.equal(session.isSettled(), false, 'external fixture teardown does not manufacture a generation-bound receipt');
  }
  fs.openSync = originalOpen; fs.readSync = originalRead; fs.closeSync = originalClose;
  {
    let fd, closes = 0, nativeSettled = false;
    const primary = Object.assign(new Error('original sync read work remains pending'), {
      cacheOwnershipReleased() { assert.equal(this, primary); return nativeSettled; }
    });
    fs.openSync = (target, ...args) => {
      const opened = originalOpen(target, ...args); if (target === file) { fd = opened; disposal.add(opened); } return opened;
    };
    fs.readSync = (opened, ...args) => { if (opened === fd) throw primary; return originalRead(opened, ...args); };
    fs.closeSync = opened => { closes += 1; originalClose(opened); disposal.delete(opened); };
    const failure = caught(read), session = getContainedFileSession(failure);
    assert.equal(closes, 0, 'pending original native work gates the first synchronous descriptor destruction');
    primary.cacheOwnershipReleased = () => true;
    caught(() => session.releaseAfterCloseSync()); assert.equal(closes, 0);
    fs.closeSync = () => assert.fail('recovery cannot reread a replaced global close method');
    nativeSettled = true;
    assert.deepEqual(session.releaseAfterCloseSync(), { resourceId: session.resourceId, settled: true, pending: false });
    assert.equal(closes, 1); assert.equal(failure.cacheOwnershipReleased(), true); assert.equal(records, 1);
  }
  fs.openSync = originalOpen; fs.readSync = originalRead; fs.closeSync = originalClose;
  for (const returned of [false, true, null, 0]) {
    let fd, closes = 0;
    fs.openSync = (target, ...args) => {
      const opened = originalOpen(target, ...args); if (target === file) { fd = opened; disposal.add(opened); } return opened;
    };
    fs.closeSync = opened => { if (opened === fd) { closes += 1; return returned; } return originalClose(opened); };
    const failure = caught(read), session = getContainedFileSession(failure);
    assert.equal(closes, 1); assert.equal(session.isSettled(), false); assert.equal(records, 1);
    caught(() => session.releaseAfterCloseSync()); assert.equal(closes, 1);
    originalClose(fd); disposal.delete(fd);
  }
  fs.openSync = originalOpen; fs.readSync = originalRead; fs.closeSync = originalClose;
  {
    let fd, closes = 0;
    const stat = fs.statSync(file, { bigint: true });
    fs.openSync = (target, ...args) => {
      const opened = originalOpen(target, ...args); if (target === file) { fd = opened; disposal.add(opened); } return opened;
    };
    fs.closeSync = opened => { if (opened === fd) { closes += 1; throw false; } return originalClose(opened); };
    const failure = caught(() => openContainedFileSync(root, file, {
      expectedFileIdentity: { dev: String(stat.dev), ino: String(stat.ino + 1n) }
    }));
    assert.equal(failure.code, 'ERR_FILE_CHANGED'); assert.equal(contains(failure, false), true); assert.equal(closes, 1);
    caught(() => getContainedFileSession(failure).releaseAfterCloseSync()); assert.equal(closes, 1);
    originalClose(fd); disposal.delete(fd);
  }
  fs.openSync = originalOpen; fs.readSync = originalRead; fs.closeSync = originalClose;
  assert.deepEqual(read().buffer, body); assert.equal(records, 2); assert.deepEqual(fs.readFileSync(file), body);
} finally {
  fs.openSync = originalOpen; fs.readSync = originalRead; fs.closeSync = originalClose; fs.fstatSync = originalStat;
  for (const fd of disposal) { try { originalClose(fd); } catch {} }
  await rmDirRecursive(root);
}
console.log('contained-file-sync-resource-lifetime passed');
