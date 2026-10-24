import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createPackedChecksumValidator } from '../../../src/shared/artifact-io/checksum.js';
import { verifyManifestChecksum, verifyManifestChecksumFromFile } from '../../../src/shared/artifact-io/loaders/core-binary-columnar-checksum.js';
import { loadJsonArrayArtifactRows } from '../../../src/shared/artifact-io/loaders.js';
import { encodeBinaryRowFrames } from '../../../src/shared/artifact-io/binary-columnar.js';
import { getContainedFileSession } from '../../../src/shared/contained-file-resource.js';
import { writePiecesManifest } from '../../helpers/artifact-io-fixture.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';

// UNVALIDATED: actual checksum/row-loader consumers and disposable fds only.
// No whole index, native binding, child, network, physical link or benchmark.
const caught = action => {
  let failed = false, error;
  try { action(); } catch (value) { failed = true; error = value; }
  assert.equal(failed, true); return error;
};
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
const root = await makeTempDir('poc-streamed-checksum-resource-');
const originalOpen = fs.openSync, originalRead = fs.readSync, originalClose = fs.closeSync, originalReadFile = fs.readFileSync;
const disposal = new Set();
try {
  const file = path.join(root, 'inert.bin'), bytes = Buffer.alloc(64 * 1024 + 19, 7); fs.writeFileSync(file, bytes);
  const checksum = buffer => `sha256:${createHash('sha256').update(buffer).digest('hex')}`;
  const validator = (expected = checksum(bytes), counters = null) => {
    const original = createPackedChecksumValidator({ checksum: expected });
    return { update(buffer) { if (counters) counters.updates += 1; return original.update(buffer); },
      verify() { if (counters) counters.verifies += 1; return original.verify(); } };
  };
  for (const containedRoot of [root, null]) {
    {
      let fd, reads = 0, closes = 0;
      fs.openSync = (target, ...args) => { const opened = originalOpen(target, ...args); if (target === file) fd = opened; return opened; };
      fs.readSync = (opened, buffer, offset, length, position) => {
        if (opened !== fd) return originalRead(opened, buffer, offset, length, position);
        reads += 1; assert.ok(length <= 64 * 1024);
        return originalRead(opened, buffer, offset, Math.min(length, 1024), position);
      };
      fs.closeSync = opened => { if (opened === fd) closes += 1; return originalClose(opened); };
      fs.readFileSync = (target, ...args) => { if (target === file) assert.fail('checksum cannot materialize full payload'); return originalReadFile(target, ...args); };
      const counters = { updates: 0, verifies: 0 };
      verifyManifestChecksumFromFile({ validator: validator(undefined, counters), artifactPath: file, containedRoot, baseName: 'fixture' });
      assert.ok(reads > 2); assert.equal(counters.updates, reads); assert.equal(counters.verifies, 1); assert.equal(closes, 1);
      fs.openSync = originalOpen; fs.readSync = originalRead; fs.closeSync = originalClose; fs.readFileSync = originalReadFile;
    }
    for (const primary of [undefined, null, false, 0, '']) {
      let fd, closes = 0, reads = 0;
      const secondary = Object.freeze(new Error('independent checksum descriptor close failure'));
      fs.openSync = (target, ...args) => {
        const opened = originalOpen(target, ...args); if (target === file) { fd = opened; disposal.add(opened); } return opened;
      };
      fs.readSync = (opened, ...args) => { if (opened === fd) { reads += 1; throw primary; } return originalRead(opened, ...args); };
      fs.closeSync = opened => { if (opened === fd) { closes += 1; throw secondary; } return originalClose(opened); };
      const counters = { updates: 0, verifies: 0 };
      const failure = caught(() => verifyManifestChecksumFromFile({ validator: validator(undefined, counters), artifactPath: file, containedRoot, baseName: 'fixture' }));
      assert.equal(failure.code, 'ERR_ARTIFACT_READ'); assert.equal(contains(failure, primary), true); assert.equal(contains(failure, secondary), true);
      const session = getContainedFileSession(failure); assert.ok(session);
      caught(() => session.releaseAfterCloseSync()); assert.equal(closes, 1); assert.equal(reads, 1); assert.equal(counters.verifies, 0);
      originalClose(fd); disposal.delete(fd); assert.equal(session.isSettled(), false);
      fs.openSync = originalOpen; fs.readSync = originalRead; fs.closeSync = originalClose;
    }
    for (const badChecksum of [false, true]) {
      let fd, closes = 0;
      const secondary = Object.freeze(new Error('original close rejects after checksum verification'));
      fs.openSync = (target, ...args) => {
        const opened = originalOpen(target, ...args); if (target === file) { fd = opened; disposal.add(opened); } return opened;
      };
      fs.closeSync = opened => { if (opened === fd) { closes += 1; throw secondary; } return originalClose(opened); };
      const counters = { updates: 0, verifies: 0 };
      const failure = caught(() => verifyManifestChecksumFromFile({
        validator: validator(badChecksum ? `sha256:${'0'.repeat(64)}` : undefined, counters),
        artifactPath: file, containedRoot, baseName: 'fixture'
      }));
      assert.equal(failure.code, badChecksum ? 'ERR_ARTIFACT_CORRUPT' : 'ERR_ARTIFACT_READ');
      assert.equal(contains(failure, secondary), true); assert.equal(counters.verifies, 1); assert.equal(closes, 1);
      caught(() => getContainedFileSession(failure).releaseAfterCloseSync()); assert.equal(counters.verifies, 1); assert.equal(closes, 1);
      originalClose(fd); disposal.delete(fd); fs.openSync = originalOpen; fs.closeSync = originalClose;
    }
    {
      let fd, nativeSettled = false, closes = 0;
      const primary = Object.assign(new Error('original checksum read still owns native work'), {
        cacheOwnershipPending: false, cacheOwnershipReleased() { assert.equal(this, primary); return nativeSettled; }
      });
      fs.openSync = (target, ...args) => {
        const opened = originalOpen(target, ...args); if (target === file) { fd = opened; disposal.add(opened); } return opened;
      };
      fs.readSync = (opened, ...args) => { if (opened === fd) throw primary; return originalRead(opened, ...args); };
      fs.closeSync = opened => { if (opened === fd) closes += 1; originalClose(opened); disposal.delete(opened); };
      const counters = { updates: 0, verifies: 0 };
      const failure = caught(() => verifyManifestChecksumFromFile({ validator: validator(undefined, counters), artifactPath: file, containedRoot, baseName: 'fixture' }));
      const session = getContainedFileSession(failure); assert.equal(closes, 0);
      primary.cacheOwnershipReleased = () => true;
      caught(() => session.releaseAfterCloseSync()); assert.equal(closes, 0);
      nativeSettled = true; session.releaseAfterCloseSync(); assert.equal(closes, 1); assert.equal(counters.verifies, 0);
      assert.equal(failure.cacheOwnershipReleased(), true);
      fs.openSync = originalOpen; fs.readSync = originalRead; fs.closeSync = originalClose;
    }
    for (const progress of [0, -1, NaN, 0.5, 64 * 1024 + 1]) {
      let fd;
      fs.openSync = (target, ...args) => { const opened = originalOpen(target, ...args); if (target === file) fd = opened; return opened; };
      fs.readSync = (opened, ...args) => opened === fd ? progress : originalRead(opened, ...args);
      const failure = caught(() => verifyManifestChecksumFromFile({ validator: validator(), artifactPath: file, containedRoot, baseName: 'fixture' }));
      assert.equal(failure.code, 'ERR_ARTIFACT_READ'); assert.equal(getContainedFileSession(failure), null);
      fs.openSync = originalOpen; fs.readSync = originalRead;
    }
  }
  for (const value of [undefined, null, false, 0, '']) {
    const failure = caught(() => verifyManifestChecksum({ validator: { update() { throw value; }, verify() { assert.fail('not admitted'); } },
      buffer: bytes, baseName: 'fixture', artifactPath: file }));
    assert.equal(failure.code, 'ERR_ARTIFACT_CORRUPT'); assert.equal(contains(failure, value), true);
  }
  {
    const dir = path.join(root, 'actual-family'); await fsp.mkdir(dir);
    const rows = [{ id: 0, value: 'first' }, { id: 1, value: 'second' }];
    const encoded = encodeBinaryRowFrames(rows.map(row => Buffer.from(JSON.stringify(row))));
    const data = path.join(dir, 'sample.binary-columnar.bin');
    await fsp.writeFile(data, encoded.dataBuffer);
    await fsp.writeFile(path.join(dir, 'sample.binary-columnar.offsets.bin'), encoded.offsetsBuffer);
    await fsp.writeFile(path.join(dir, 'sample.binary-columnar.lengths.varint'), encoded.lengthsBuffer);
    await fsp.writeFile(path.join(dir, 'sample.binary-columnar.meta.json'), JSON.stringify({ fields: {
      format: 'binary-columnar-v1', count: rows.length, data: path.basename(data),
      offsets: 'sample.binary-columnar.offsets.bin', lengths: 'sample.binary-columnar.lengths.varint'
    } }));
    await writePiecesManifest(dir, [
      { name: 'sample', path: path.basename(data), format: 'binary-columnar', checksum: checksum(encoded.dataBuffer) },
      { name: 'sample_binary_columnar_offsets', path: 'sample.binary-columnar.offsets.bin', format: 'binary', checksum: checksum(encoded.offsetsBuffer) },
      { name: 'sample_binary_columnar_lengths', path: 'sample.binary-columnar.lengths.varint', format: 'varint', checksum: checksum(encoded.lengthsBuffer) },
      { name: 'sample_binary_columnar_meta', path: 'sample.binary-columnar.meta.json', format: 'json' }
    ]);
    let fd, opens = 0, emitted = 0;
    fs.openSync = (target, ...args) => {
      const opened = originalOpen(target, ...args); if (target === data) { fd = opened; opens += 1; disposal.add(opened); } return opened;
    };
    fs.closeSync = opened => { if (opened === fd) throw new Error('actual streamed checksum close failure'); return originalClose(opened); };
    const failure = await rejected(async () => { for await (const row of loadJsonArrayArtifactRows(dir, 'sample', { strict: true })) { void row; emitted += 1; } });
    assert.equal(failure.code, 'ERR_ARTIFACT_READ'); assert.ok(getContainedFileSession(failure));
    assert.equal(opens, 1); assert.equal(emitted, 0, 'failed checksum descriptor close cannot start a row decode pass');
    originalClose(fd); disposal.delete(fd); fs.openSync = originalOpen; fs.closeSync = originalClose;
    const actual = []; for await (const row of loadJsonArrayArtifactRows(dir, 'sample', { strict: true })) actual.push(row);
    assert.deepEqual(actual, rows);
  }
  assert.deepEqual(await fsp.readFile(file), bytes);
} finally {
  fs.openSync = originalOpen; fs.readSync = originalRead; fs.closeSync = originalClose; fs.readFileSync = originalReadFile;
  for (const fd of disposal) { try { originalClose(fd); } catch {} }
  await rmDirRecursive(root);
}
console.log('streamed-checksum-resource-lifetime passed');
