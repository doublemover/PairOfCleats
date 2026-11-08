import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { readJsonFileSafe, readJsonFileSyncSafe, readJsonLinesSyncSafe } from '../../../src/shared/file-read.js';
import { loadBoundedJsonFile, loadBoundedJsonFileSync } from '../../../src/shared/cache/json-file.js';
import { getContainedFileSession } from '../../../src/shared/contained-file-resource.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';

// UNVALIDATED: actual JSON/cache borrowers and reporting/classification seams.
const root = await makeTempDir('poc-json-fallback-resource-'), file = path.join(root, 'data.json');
await fsp.writeFile(file, '{"ok":true}');
const open = fsp.open, stat = fsp.stat, syncOpen = fs.openSync, syncRead = fs.readSync, syncClose = fs.closeSync;
const disposal = new Map(), syncDisposal = new Set();
const rejected = async action => {
  let failed = false, failure;
  try { await action(); } catch (value) { failed = true; failure = value; }
  assert.equal(failed, true); return failure;
};
try {
  for (const cached of [false, true]) {
    let allow = false, reads = 0, closes = 0, reports = 0;
    const primary = Object.freeze(new Error('JSON native close refused'));
    fsp.open = async (name, ...args) => {
      const actual = await open(name, ...args); if (name !== file) return actual;
      const close = actual.close, read = actual.read; disposal.set(actual, () => close.call(actual));
      actual.read = function (...next) { assert.equal(this, actual); reads += 1; return read.call(actual, ...next); };
      actual.close = function () {
        assert.equal(this, actual); closes += 1; if (!allow) throw primary;
        disposal.delete(actual); return close.call(actual);
      };
      return actual;
    };
    const failure = await rejected(() => cached ? loadBoundedJsonFile(file, { fallback: {}, maxBytes: 1024 })
      : readJsonFileSafe(file, { fallback: {}, onError: () => { reports += 1; } }));
    const session = getContainedFileSession(failure); assert.ok(session);
    assert.equal(failure.cacheOwnershipReleased(), false); assert.equal(reads, 1); assert.equal(closes, 1); assert.equal(reports, 0);
    allow = true; await session.releaseAfterClose(); assert.equal(reads, 1); assert.equal(closes, 2);
    assert.equal(failure.cacheOwnershipReleased(), true); fsp.open = open;
  }

  for (const caller of ['json', 'bounded-cache', 'json-lines']) {
    let closes = 0, reads = 0;
    fs.openSync = (name, ...args) => { const fd = syncOpen(name, ...args); if (name === file) syncDisposal.add(fd); return fd; };
    fs.readSync = (...args) => { reads += 1; return syncRead(...args); };
    fs.closeSync = () => { closes += 1; return false; };
    const failure = await rejected(() => caller === 'json' ? readJsonFileSyncSafe(file, { fallback: {} })
      : caller === 'bounded-cache' ? loadBoundedJsonFileSync(file, { fallback: {} }) : readJsonLinesSyncSafe(file));
    const session = getContainedFileSession(failure); assert.ok(session); assert.equal(reads, 1); assert.equal(closes, 1);
    await rejected(() => session.releaseAfterCloseSync()); assert.equal(closes, 1);
    for (const fd of syncDisposal) { syncClose(fd); syncDisposal.delete(fd); }
    assert.equal(session.isSettled(), false, 'external sync disposal cannot prove numeric generation');
    fs.openSync = syncOpen; fs.readSync = syncRead; fs.closeSync = syncClose;
  }
  for (const marker of [undefined, false, true]) {
    let ready = false, allow = false, reads = 0, closes = 0;
    const primary = new Error('JSON original read work');
    if (marker !== undefined) primary.cacheOwnershipPending = marker;
    primary.cacheOwnershipReleased = function () { assert.equal(this, primary); return ready; };
    fsp.open = async (name, ...args) => {
      const actual = await open(name, ...args); if (name !== file) return actual;
      const close = actual.close, read = actual.read; disposal.set(actual, () => close.call(actual));
      actual.read = function (...next) { reads += 1; if (!allow) throw primary; return read.call(actual, ...next); };
      actual.close = function () { closes += 1; disposal.delete(actual); return close.call(actual); }; return actual;
    };
    const failure = await rejected(() => readJsonFileSafe(file, { fallback: 'must not return' }));
    const session = getContainedFileSession(failure); assert.ok(session); assert.equal(closes, 0);
    primary.cacheOwnershipReleased = () => true; allow = true;
    await rejected(() => session.releaseAfterClose()); assert.equal(closes, 0);
    ready = true; await session.releaseAfterClose(); assert.equal(reads, 1); assert.equal(closes, 1); fsp.open = open;
  }

  // A path stat failure must be observed before callback diagnostics can
  // replace its method; no callback or fallback may clear unknown work.
  for (const marker of [undefined, false, true]) {
    let ready = false, reports = 0;
    const primary = new Error('JSON preliminary stat owner');
    if (marker !== undefined) primary.cacheOwnershipPending = marker;
    primary.cacheOwnershipReleased = function () { assert.equal(this, primary); return ready; };
    fsp.stat = async () => { throw primary; };
    const failure = await rejected(() => readJsonFileSafe(file, { fallback: null, maxBytes: 1024,
      onError: () => { reports += 1; primary.cacheOwnershipReleased = () => true; } }));
    assert.equal(reports, 0); primary.cacheOwnershipReleased = () => true; assert.equal(failure.cacheOwnershipReleased(), false);
    ready = true; assert.equal(failure.cacheOwnershipReleased(), true); fsp.stat = stat;
  }
  const invalid = path.join(root, 'invalid.json'); await fsp.writeFile(invalid, '{broken');
  for (const sync of [false, true]) {
    let ready = false, reports = 0;
    const secondary = Object.freeze(Object.assign(new Error('reporting owns native work'), {
      cacheOwnershipReleased() { assert.equal(this, secondary); return ready; }
    }));
    const options = { fallback: 'blocked', onError: () => { reports += 1; throw secondary; } };
    const failure = await rejected(() => sync ? readJsonFileSyncSafe(invalid, options) : readJsonFileSafe(invalid, options));
    assert.equal(reports, 1); assert.equal(failure.cacheOwnershipReleased(), false);
    ready = true; assert.equal(failure.cacheOwnershipReleased(), true);
  }

  // The actual fd gate repeats maxBytes even if the earlier path stat was
  // stale. Positive short reads and ordinary fallback/report contracts remain.
  fsp.stat = async () => ({ size: 0 });
  const phases = []; assert.equal(await readJsonFileSafe(file, { fallback: 'large', maxBytes: 2,
    onError: info => phases.push([info.phase, info.error.code]) }), 'large');
  assert.deepEqual(phases, [['read', 'ERR_JSON_FILE_TOO_LARGE']]); fsp.stat = stat;
  fsp.open = async (name, ...args) => {
    const actual = await open(name, ...args), read = actual.read;
    actual.read = function (buffer, offset, length, position) { return read.call(actual, buffer, offset, Math.min(2, length), position); };
    return actual;
  };
  assert.deepEqual(await readJsonFileSafe(file), { ok: true }); fsp.open = open;
  assert.equal(readJsonFileSyncSafe(invalid, { fallback: 'parse', onError: () => { throw false; } }), 'parse');
  assert.equal(await readJsonFileSafe(path.join(root, 'missing'), { fallback: 'missing' }), 'missing');
  const lines = path.join(root, 'lines.jsonl'); await fsp.writeFile(lines, '0\nfalse\n""\n{broken\n{"ok":true}\n');
  assert.deepEqual(readJsonLinesSyncSafe(lines), [0, false, '', { ok: true }]);
} finally {
  fsp.open = open; fsp.stat = stat; fs.openSync = syncOpen; fs.readSync = syncRead; fs.closeSync = syncClose;
  for (const close of disposal.values()) { try { await close(); } catch {} }
  for (const fd of syncDisposal) { try { syncClose(fd); } catch {} }
  await rmDirRecursive(root);
}
