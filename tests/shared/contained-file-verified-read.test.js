import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { openContainedFile, verifyContainedFileHandle, readVerifiedContainedFile, readVerifiedContainedFileSync } from '../../src/shared/contained-file.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'verified-contained-'));
try {
  const file = path.join(root, 'data.json');
  const bytes = Buffer.from('{"value":1}');
  fs.writeFileSync(file, bytes);
  const hash = createHash('sha256').update(bytes).digest('hex');
  const metrics = {};
  const result = await readVerifiedContainedFile(root, file, {
    expectedHash: hash, expectedBytes: bytes.length, maxBytes: bytes.length, metrics
  });
  assert.deepEqual(result.buffer, bytes);
  assert.equal(result.hash, hash);
  assert.equal(metrics.verificationBytes, bytes.length);
  assert.equal(JSON.parse(result.buffer).value, 1);
  assert.throws(() => readVerifiedContainedFileSync(root, file, { maxBytes: bytes.length - 1 }),
    { code: 'ERR_FILE_TOO_LARGE' });
  await assert.rejects(readVerifiedContainedFile(root, file, { expectedHash: '0'.repeat(64) }),
    { code: 'ERR_FILE_INTEGRITY' });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(readVerifiedContainedFile(root, file, { signal: controller.signal }), { code: 'ABORT_ERR' });

  assert.equal(typeof result.stat.ino, 'number', 'verified reads retain their existing public stat representation');
  const alternate = path.join(root, 'same-bytes-different-object.json');
  const alias = path.join(root, 'same-object-alias.json');
  fs.writeFileSync(alternate, bytes);
  fs.linkSync(file, alias);
  const nativeFstat = fs.fstatSync;
  const nativeStat = fs.statSync;
  const originalId = nativeStat(file, { bigint: true }).ino;
  const alternateId = nativeStat(alternate, { bigint: true }).ino;
  const wideOriginal = 2n ** 53n;
  const wideAlternate = wideOriginal + 1n;
  assert.notEqual(originalId, alternateId);
  assert.equal(Number(wideOriginal), Number(wideAlternate));
  const withWideIdentity = (stat, exact) => {
    if (exact.ino === originalId || exact.ino === alternateId) {
      const value = exact.ino === originalId ? wideOriginal : wideAlternate;
      stat.ino = typeof stat.ino === 'bigint' ? value : Number(value);
    }
    return stat;
  };
  fs.fstatSync = (fd, options) => {
    const stat = nativeFstat(fd, options);
    return withWideIdentity(stat, options?.bigint ? stat : nativeFstat(fd, { bigint: true }));
  };
  fs.statSync = (filename, options) => {
    const stat = nativeStat(filename, options);
    return withWideIdentity(stat, options?.bigint ? stat : nativeStat(filename, { bigint: true }));
  };
  let exactHandle;
  try {
    exactHandle = await openContainedFile(root, file);
    assert.doesNotThrow(() => verifyContainedFileHandle(exactHandle, root, file));
    assert.doesNotThrow(() => verifyContainedFileHandle(exactHandle, root, alias), 'a real hard link retains descriptor authority');
    assert.throws(() => verifyContainedFileHandle(exactHandle, root, alternate), { code: 'ERR_UNSAFE_FILE_PATH' },
      'same bytes and colliding numeric IDs cannot substitute a different physical object');
    assert.deepEqual(readVerifiedContainedFileSync(root, file).buffer, bytes);
    assert.deepEqual((await readVerifiedContainedFile(root, file)).buffer, bytes);
  } finally {
    await exactHandle?.close();
    fs.fstatSync = nativeFstat;
    fs.statSync = nativeStat;
  }


  const originalRead = fs.readSync;
  let observedFd;
  fs.readSync = (fd, ...args) => {
    observedFd = fd;
    const read = originalRead(fd, ...args);
    fs.appendFileSync(file, ' ');
    return read;
  };
  try {
    assert.throws(() => readVerifiedContainedFileSync(root, file), { code: 'ERR_FILE_CHANGED' });
  } finally { fs.readSync = originalRead; }
  assert.throws(() => fs.fstatSync(observedFd), { code: 'EBADF' });
  fs.writeFileSync(file, bytes);
  fs.readSync = (fd, ...args) => {
    observedFd = fd;
    const read = originalRead(fd, ...args);
    const replacement = path.join(root, 'replacement');
    fs.writeFileSync(replacement, '{"value":2}');
    fs.renameSync(replacement, file);
    return read;
  };
  try {
    // Windows prevents replacement of the open file itself; POSIX reaches descriptor verification.
    assert.throws(() => readVerifiedContainedFileSync(root, file), { code: process.platform === 'win32' ? 'EPERM' : 'ERR_UNSAFE_FILE_PATH' });
  } finally { fs.readSync = originalRead; }
  assert.throws(() => fs.fstatSync(observedFd), { code: 'EBADF' });
  if (process.platform !== 'win32') {
    const retained = await openContainedFile(root, file);
    const retainedFd = retained.fd;
    const moved = path.join(root, 'moved');
    try {
      fs.renameSync(file, moved);
      fs.symlinkSync(moved, file);
      assert.equal(fs.statSync(file).ino, fs.fstatSync(retained.fd).ino);
      assert.throws(() => verifyContainedFileHandle(retained, root, file), { code: 'ERR_UNSAFE_FILE_PATH' });
    } finally {
      await retained.close();
      fs.unlinkSync(file);
      fs.renameSync(moved, file);
    }
    assert.throws(() => fs.fstatSync(retainedFd), { code: 'EBADF' });
    const link = path.join(root, 'link'); fs.symlinkSync(file, link);
    await assert.rejects(readVerifiedContainedFile(root, link), { code: 'ERR_UNSAFE_FILE_PATH' });
  }
} finally { fs.rmSync(root, { recursive: true, force: true }); }
console.log('verified contained byte reads test passed');
