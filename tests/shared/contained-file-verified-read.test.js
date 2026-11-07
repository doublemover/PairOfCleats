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
  const open = fs.promises.open;
  let asyncStats = 0, result;
  try {
    fs.promises.open = async (...args) => {
      const handle = await open(...args), stat = handle.stat.bind(handle);
      handle.stat = (...options) => { asyncStats++; return stat(...options); };
      return handle;
    };
    result = await readVerifiedContainedFile(root, file, {
      expectedHash: hash, expectedBytes: bytes.length, maxBytes: bytes.length, metrics
    });
    assert.equal(asyncStats, 0, 'verified metadata uses the same captured fd-stat primitive as descriptor admission');
  } finally { fs.promises.open = open; }
  assert.deepEqual(result.buffer, bytes);
  assert.equal(result.hash, hash);
  assert.equal(metrics.verificationBytes, bytes.length);
  assert.equal(JSON.parse(result.buffer).value, 1);
  if (process.platform === 'win32') {
    // These are actual files and reads, with only native admission held. Four
    // independent existing readers must reach the same original probe before
    // any is released; a synchronous ancestry walk cannot satisfy this.
    const lstat = fs.promises.lstat, gate = Promise.withResolvers();
    let holding = true, admitted = 0;
    fs.promises.lstat = async (...args) => {
      if (holding && args[0] === root) { admitted++; await gate.promise; }
      return lstat.call(fs.promises, ...args);
    };
    const reads = Array.from({ length: 4 }, () => readVerifiedContainedFile(root, file, { expectedHash: hash }));
    try {
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(admitted, 4, 'Windows asynchronous ancestry admission must not serialize existing readers');
    } finally {
      holding = false; gate.resolve();
      const results = await Promise.allSettled(reads);
      fs.promises.lstat = lstat;
      for (const result of results) {
        assert.equal(result.status, 'fulfilled'); assert.deepEqual(result.value.buffer, bytes);
      }
    }
    const nested = path.join(root, 'nested'), nestedFile = path.join(nested, 'data');
    fs.mkdirSync(nested); fs.writeFileSync(nestedFile, bytes);
    const realpath = fs.promises.realpath;
    for (const scenario of ['root-link', 'ancestor-link', 'leaf-link', 'ancestor-escape', 'original-probe-error']) {
      let opens = 0;
      const probeError = Object.freeze(new Error('original asynchronous ancestry probe failed'));
      fs.promises.lstat = async (...args) => {
        const stat = await lstat.call(fs.promises, ...args);
        const link = scenario === 'root-link' ? root : scenario === 'ancestor-link' ? nested
          : scenario === 'leaf-link' ? nestedFile : null;
        if (args[0] === link) stat.isSymbolicLink = () => true;
        if (scenario === 'original-probe-error' && args[0] === nested) throw probeError;
        return stat;
      };
      fs.promises.realpath = async (...args) => scenario === 'ancestor-escape' && args[0] === nested
        ? path.join(path.dirname(root), 'outside-original-root') : realpath.call(fs.promises, ...args);
      fs.promises.open = (...args) => { opens++; return open.call(fs.promises, ...args); };
      try {
        await assert.rejects(readVerifiedContainedFile(root, nestedFile), error => scenario === 'original-probe-error'
          ? error === probeError : error.code === 'ERR_UNSAFE_FILE_PATH');
        assert.equal(opens, 0, `${scenario} must reject before opening payload`);
      } finally {
        fs.promises.lstat = lstat; fs.promises.realpath = realpath; fs.promises.open = open;
      }
    }

    // Hold the actual post-open probe, then fail it. The exact descriptor must
    // remain open until that original observation settles, and close once
    // without publishing bytes. No real link or privilege change is needed.
    const entered = Promise.withResolvers(), release = Promise.withResolvers();
    const probeError = Object.freeze(new Error('original post-open ancestry failure'));
    const rejectedMetrics = {};
    let admittedFd = null, closes = 0, watchdog;
    fs.promises.open = async (...args) => {
      const handle = await open.call(fs.promises, ...args), close = handle.close.bind(handle);
      admittedFd = handle.fd;
      handle.close = async () => { closes++; return close(); };
      return handle;
    };
    fs.promises.lstat = async (...args) => {
      if (admittedFd !== null && args[0] === root) {
        entered.resolve(); await release.promise; throw probeError;
      }
      return lstat.call(fs.promises, ...args);
    };
    const pending = readVerifiedContainedFile(root, nestedFile, { metrics: rejectedMetrics });
    const observed = pending.then(value => ({ value }), error => ({ error }));
    try {
      await Promise.race([entered.promise, new Promise((_, reject) => {
        watchdog = setTimeout(() => reject(new Error('Original post-open probe was not observed')), 1000);
      })]);
      assert.equal(closes, 0);
      assert.equal(fs.fstatSync(admittedFd).isFile(), true);
      assert.equal(rejectedMetrics.verificationBytes, undefined);
    } finally {
      clearTimeout(watchdog); release.resolve();
      const result = await observed;
      fs.promises.lstat = lstat; fs.promises.open = open;
      assert.equal(result.error, probeError);
      assert.equal(closes, 1);
      assert.throws(() => fs.fstatSync(admittedFd), { code: 'EBADF' });
      assert.equal(rejectedMetrics.verificationBytes, undefined);
    }
  }
  let changedFd;
  try {
    fs.promises.open = async (...args) => {
      const handle = await open(...args), read = handle.read.bind(handle);
      changedFd = handle.fd;
      handle.read = async (...span) => {
        const value = await read(...span);
        fs.appendFileSync(file, ' ');
        return value;
      };
      return handle;
    };
    await assert.rejects(readVerifiedContainedFile(root, file), { code: 'ERR_FILE_CHANGED' });
    assert.throws(() => fs.fstatSync(changedFd), { code: 'EBADF' });
  } finally { fs.promises.open = open; fs.writeFileSync(file, bytes); }
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
