import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { assembleCompositeContextPack, clearContextPackCaches } from '../../src/context-pack/assemble.js';
import { getContainedFileSession } from '../../src/shared/contained-file.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'poc-edit-unit-lifetime-'));
const file = path.join(root, 'source.js'), text = '\tfunction original() { return "界😀"; }\r\n';
fs.writeFileSync(file, text);
const options = { repoRoot: root, seed: { type: 'chunk', chunkUid: 'seed' }, includeGraph: false,
  indexSignature: 'retained-edit-generation', taskPolicy: { schemaVersion: 1, task: 'edit-safe', granularity: 'file' },
  chunkMeta: [{ file: 'source.js', chunkUid: 'seed', start: 1, end: 2,
    fileHash: createHash('sha1').update(text).digest('hex'), fileHashAlgo: 'sha1' }] };
const originalOpen = fs.openSync, originalClose = fs.closeSync, originalRead = fs.readSync;
let held = null, closeDenied = true, closes = 0, reads = 0, opens = 0;
try {
  fs.openSync = function (target, ...args) {
    const fd = originalOpen.call(fs, target, ...args);
    if (path.resolve(String(target)) === file) { held = fd; opens++; }
    return fd;
  };
  fs.readSync = function (fd, ...args) { if (fd === held) reads++; return originalRead.call(fs, fd, ...args); };
  fs.closeSync = function (fd) {
    if (fd === held) { closes++; if (closeDenied) throw Object.freeze(Object.assign(new Error('original close rejected'), { code: 'ENOENT' })); }
    return originalClose.call(fs, fd);
  };
  let failure;
  try { assembleCompositeContextPack(options); assert.fail('original pending close must escape ordinary missing-source classification'); }
  catch (error) { failure = error; }
  assert.equal(failure.cacheOwnershipReleased(), false); assert.equal(closes, 1);
  const beforeReads = reads, beforeOpens = opens;
  closeDenied = false; getContainedFileSession(failure).releaseAfterCloseSync();
  assert.equal(failure.cacheOwnershipReleased(), true); assert.equal(closes, 2);
  assert.equal(reads, beforeReads); assert.equal(opens, beforeOpens, 'recovery closes the original descriptor without reopening or replay');
  held = null;
  assert.equal(assembleCompositeContextPack(options).primary.excerpt, text);
  const controller = new AbortController();
  fs.readSync = function (fd, ...args) {
    const value = originalRead.call(fs, fd, ...args); if (fd === held) controller.abort(); return value;
  };
  const beforeClose = closes;
  assert.throws(() => assembleCompositeContextPack({ ...options, signal: controller.signal }), { code: 'ABORT_ERR' });
  assert.equal(closes, beforeClose + 1, 'cancellation settles the exact open descriptor');
  held = null;
  fs.readSync = originalRead;
  assert.equal(assembleCompositeContextPack(options).primary.excerpt, text, 'cancelled assembly published no substitute source');
} finally {
  fs.openSync = originalOpen; fs.closeSync = originalClose; fs.readSync = originalRead;
  if (held !== null) { try { originalClose(held); } catch {} }
  clearContextPackCaches(); fs.rmSync(root, { recursive: true, force: true });
}
console.log('Edit-unit admission retains original source descriptor ownership and releases cancelled reads.');
