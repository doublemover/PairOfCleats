import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { loadTokenPostings } from '../../../src/shared/artifact-io/loaders/token-postings.js';
import { encodePackedOffsets, packTfPostings } from '../../../src/shared/packed-postings.js';
import { getContainedFileSession } from '../../../src/shared/contained-file-resource.js';
import { writePiecesManifest } from '../../helpers/artifact-io-fixture.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';

// UNVALIDATED: real packed codec/loader/manifest and disposable tiny fds only.
// No full index, native binding, child, physical link or benchmark runs.
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
const root = await makeTempDir('poc-packed-resource-lifetime-');
const originalOpen = fs.openSync, originalRead = fs.readSync, originalClose = fs.closeSync, originalReadFile = fs.readFileSync;
const disposal = new Set();
try {
  const postings = Array.from({ length: 4 }, (_, id) => [[id, 1], [id + 4, 2]]);
  const packed = packTfPostings(postings, { blockSize: 2 }), offsets = encodePackedOffsets(packed.offsets);
  const checksum = buffer => `sha256:${createHash('sha256').update(buffer).digest('hex')}`;
  let sequence = 0;
  const fixture = async ({ invalidChecksum = false } = {}) => {
    const dir = path.join(root, String(sequence++)); await fsp.mkdir(dir);
    const data = path.join(dir, 'token_postings.packed.bin');
    await fsp.writeFile(data, packed.buffer);
    await fsp.writeFile(path.join(dir, 'token_postings.packed.offsets.bin'), offsets);
    await fsp.writeFile(path.join(dir, 'token_postings.packed.meta.json'), JSON.stringify({
      fields: { blockSize: packed.blockSize, offsets: 'token_postings.packed.offsets.bin', totalDocs: 8, avgDocLen: 1 },
      arrays: { vocab: ['alpha', 'beta', 'gamma', 'omega'], docLengths: new Array(8).fill(1) }
    }));
    await writePiecesManifest(dir, [
      { name: 'token_postings', path: path.basename(data), format: 'packed',
        checksum: invalidChecksum ? `sha256:${'0'.repeat(64)}` : checksum(packed.buffer) },
      { name: 'token_postings_offsets', path: 'token_postings.packed.offsets.bin', format: 'binary', checksum: checksum(offsets) },
      { name: 'token_postings_meta', path: 'token_postings.packed.meta.json', format: 'json' }
    ]);
    return { dir, data };
  };
  for (const strict of [true, false]) {
    {
      const { dir, data } = await fixture();
      let fd, reads = 0, closes = 0;
      fs.openSync = (target, ...args) => {
        const opened = originalOpen(target, ...args); if (target === data) fd = opened; return opened;
      };
      fs.readSync = (opened, buffer, offset, length, position) => {
        if (opened !== fd) return originalRead(opened, buffer, offset, length, position);
        reads += 1; assert.ok(length <= 1024);
        return originalRead(opened, buffer, offset, Math.min(length, 2), position);
      };
      fs.closeSync = opened => { if (opened === fd) closes += 1; return originalClose(opened); };
      fs.readFileSync = (target, ...args) => {
        if (target === data) assert.fail('packed data cannot use whole-file fallback');
        return originalReadFile(target, ...args);
      };
      const result = loadTokenPostings(dir, { strict, packedWindowTokens: 1, packedWindowBytes: 1024 });
      assert.deepEqual(result.postings, postings); assert.ok(reads > postings.length); assert.equal(closes, 1);
      fs.openSync = originalOpen; fs.readSync = originalRead; fs.closeSync = originalClose; fs.readFileSync = originalReadFile;
    }
    for (const primary of [undefined, null, false, 0, '']) {
      const { dir, data } = await fixture();
      let fd, reads = 0, closes = 0;
      const secondary = Object.freeze(Object.assign(new Error('actual packed close failed'), { code: 'ECLOSE' }));
      fs.openSync = (target, ...args) => {
        const opened = originalOpen(target, ...args); if (target === data) { fd = opened; disposal.add(opened); } return opened;
      };
      fs.readSync = (opened, ...args) => { if (opened === fd) { reads += 1; throw primary; } return originalRead(opened, ...args); };
      fs.closeSync = opened => { if (opened === fd) { closes += 1; throw secondary; } return originalClose(opened); };
      const failure = caught(() => loadTokenPostings(dir, { strict, packedWindowTokens: 1 }));
      assert.equal(contains(failure, primary), true); assert.equal(contains(failure, secondary), true);
      assert.equal(reads, 1); assert.equal(closes, 1);
      const session = getContainedFileSession(failure);
      assert.ok(session); caught(() => session.releaseAfterCloseSync());
      assert.equal(reads, 1); assert.equal(closes, 1, 'generation-unknown numeric close is never retried');
      originalClose(fd); disposal.delete(fd); assert.equal(session.isSettled(), false);
      fs.openSync = originalOpen; fs.readSync = originalRead; fs.closeSync = originalClose;
      assert.deepEqual(await fsp.readFile(data), packed.buffer);
    }
    {
      const { dir, data } = await fixture();
      let fd, closes = 0;
      const primary = Object.freeze(new Error('successful packed decode still failed close'));
      fs.openSync = (target, ...args) => {
        const opened = originalOpen(target, ...args); if (target === data) { fd = opened; disposal.add(opened); } return opened;
      };
      fs.closeSync = opened => { if (opened === fd) { closes += 1; throw primary; } return originalClose(opened); };
      const failure = caught(() => loadTokenPostings(dir, { strict }));
      assert.equal(contains(failure, primary), true); assert.equal(closes, 1);
      assert.equal(getContainedFileSession(failure).isSettled(), false, 'decoded postings are withheld when native close is unconfirmed');
      originalClose(fd); disposal.delete(fd); fs.openSync = originalOpen; fs.closeSync = originalClose;
      assert.deepEqual(loadTokenPostings(dir, { strict }).postings, postings);
    }
    {
      const { dir, data } = await fixture({ invalidChecksum: true });
      let fd, closes = 0;
      const secondary = Object.freeze(new Error('checksum failure also failed descriptor close'));
      fs.openSync = (target, ...args) => {
        const opened = originalOpen(target, ...args); if (target === data) { fd = opened; disposal.add(opened); } return opened;
      };
      fs.closeSync = opened => { if (opened === fd) { closes += 1; throw secondary; } return originalClose(opened); };
      const failure = caught(() => loadTokenPostings(dir, { strict }));
      assert.match(failure.cause.message, /checksum mismatch/); assert.equal(contains(failure, secondary), true);
      assert.equal(closes, 1); assert.ok(getContainedFileSession(failure));
      originalClose(fd); disposal.delete(fd); fs.openSync = originalOpen; fs.closeSync = originalClose;
    }
    {
      const { dir, data } = await fixture();
      let fd, closes = 0, nativeSettled = false, reads = 0;
      const primary = Object.assign(new Error('original packed native read remains pending'), {
        cacheOwnershipPending: false, cacheOwnershipReleased() { assert.equal(this, primary); return nativeSettled; }
      });
      fs.openSync = (target, ...args) => {
        const opened = originalOpen(target, ...args); if (target === data) { fd = opened; disposal.add(opened); } return opened;
      };
      fs.readSync = (opened, ...args) => { if (opened === fd) { reads += 1; throw primary; } return originalRead(opened, ...args); };
      fs.closeSync = opened => { if (opened === fd) closes += 1; originalClose(opened); disposal.delete(opened); };
      const failure = caught(() => loadTokenPostings(dir, { strict })), session = getContainedFileSession(failure);
      assert.equal(closes, 0); primary.cacheOwnershipReleased = () => true;
      caught(() => session.releaseAfterCloseSync()); assert.equal(closes, 0);
      nativeSettled = true; session.releaseAfterCloseSync(); assert.equal(closes, 1); assert.equal(reads, 1);
      assert.equal(failure.cacheOwnershipReleased(), true);
      fs.openSync = originalOpen; fs.readSync = originalRead; fs.closeSync = originalClose;
    }
  }
} finally {
  fs.openSync = originalOpen; fs.readSync = originalRead; fs.closeSync = originalClose; fs.readFileSync = originalReadFile;
  for (const fd of disposal) { try { originalClose(fd); } catch {} }
  await rmDirRecursive(root);
}
console.log('packed-postings-resource-lifetime passed');
