import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { readToolingCacheEntry } from '../../../src/index/tooling/cache-storage.js';
import { getContainedFileSession } from '../../../src/shared/contained-file-resource.js';
import { writePersistentCommandProbeCache, readPersistentCommandProbeCache,
  invalidatePersistentCommandProbeCache } from '../../../src/index/tooling/command-probe-persistent-cache.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { ensureTestingEnv, withTemporaryEnv } from '../../helpers/test-env.js';

// Actual disposable cache/producer readers and sync descriptors.
// No executable, physical links, native bindings, children or user-cache work.
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
const root = await makeTempDir('poc-tool-cache-contained-resource-');
const originalOpen = fs.openSync, originalRead = fs.readSync, originalClose = fs.closeSync, originalStat = fs.fstatSync;
const originalLstat = fs.lstatSync;
const disposal = new Set();
try {
  const file = path.join(root, 'entry.json'), bytes = Buffer.from('{"result":"original"}'); fs.writeFileSync(file, bytes);
  assert.equal(readToolingCacheEntry(file).payload.result, 'original');
  assert.throws(() => readToolingCacheEntry(file, bytes.length - 1), { code: 'ERR_TOOLING_CACHE_ENTRY' });
  {
    let opens = 0;
    fs.lstatSync = (target, ...args) => {
      const stat = originalLstat(target, ...args);
      return target === file ? new Proxy(stat, { get(value, key) {
        return key === 'isSymbolicLink' ? () => true : Reflect.get(value, key, value);
      } }) : stat;
    };
    fs.openSync = (...args) => { opens++; return originalOpen(...args); };
    try {
      assert.throws(() => readToolingCacheEntry(file), { code: 'ERR_UNSAFE_FILE_PATH' });
      assert.equal(opens, 0, 'the retained contained-file admission rejects linked metadata before open');
    } finally { fs.lstatSync = originalLstat; fs.openSync = originalOpen; }
  }
  for (const maximum of [-1, Infinity, Number.MAX_SAFE_INTEGER + 1, 1.5]) assert.throws(() => readToolingCacheEntry(file, maximum), TypeError);
  for (const value of [undefined, null, false, 0, '']) {
    let fd, reads = 0, closes = 0;
    const secondary = Object.freeze(new Error('original cache close failure'));
    fs.openSync = (target, ...args) => {
      const opened = originalOpen(target, ...args); if (target === file) { fd = opened; disposal.add(opened); } return opened;
    };
    fs.readSync = (opened, ...args) => { if (opened === fd) { reads += 1; throw value; } return originalRead(opened, ...args); };
    fs.closeSync = opened => { if (opened === fd) { closes += 1; throw secondary; } return originalClose(opened); };
    const failure = caught(() => readToolingCacheEntry(file));
    assert.equal(contains(failure, value), true); assert.equal(contains(failure, secondary), true);
    assert.equal(reads, 1); assert.equal(closes, 1);
    const session = getContainedFileSession(failure);
    caught(() => session.releaseAfterCloseSync()); assert.equal(closes, 1);
    originalClose(fd); disposal.delete(fd);
    assert.equal(session.isSettled(), false, 'fixture disposal does not prove a failed numeric close generation');
  }
  fs.openSync = originalOpen; fs.readSync = originalRead; fs.closeSync = originalClose;
  {
    let fd, nativeSettled = false, closes = 0;
    const primary = Object.assign(new Error('original cache read still owns native work'), {
      cacheOwnershipReleased() { assert.equal(this, primary); return nativeSettled; }
    });
    fs.openSync = (target, ...args) => {
      const opened = originalOpen(target, ...args); if (target === file) { fd = opened; disposal.add(opened); } return opened;
    };
    fs.readSync = (opened, ...args) => { if (opened === fd) throw primary; return originalRead(opened, ...args); };
    fs.closeSync = opened => { closes += 1; originalClose(opened); disposal.delete(opened); };
    const failure = caught(() => readToolingCacheEntry(file)), session = getContainedFileSession(failure);
    assert.equal(closes, 0); primary.cacheOwnershipReleased = () => true;
    caught(() => session.releaseAfterCloseSync()); assert.equal(closes, 0);
    nativeSettled = true; session.releaseAfterCloseSync(); assert.equal(closes, 1);
    assert.equal(failure.cacheOwnershipReleased(), true);
  }
  fs.openSync = originalOpen; fs.readSync = originalRead; fs.closeSync = originalClose;
  for (const progress of [-1, bytes.length + 1, 0.5, NaN, 0]) {
    let fd;
    fs.openSync = (target, ...args) => { const opened = originalOpen(target, ...args); if (target === file) fd = opened; return opened; };
    fs.readSync = (opened, ...args) => opened === fd ? progress : originalRead(opened, ...args);
    assert.throws(() => readToolingCacheEntry(file), /invalid progress|changed during read/);
    assert.throws(() => originalStat(fd), { code: 'EBADF' }, 'ordinary failure confirms the original close');
  }
  fs.openSync = originalOpen; fs.readSync = originalRead;
  {
    let fd, reads = 0;
    fs.openSync = (target, ...args) => { const opened = originalOpen(target, ...args); if (target === file) fd = opened; return opened; };
    fs.fstatSync = (opened, ...args) => {
      const value = originalStat(opened, ...args);
      if (opened !== fd || args[0]?.bigint) return value;
      return new Proxy(value, { get(target, key) { return key === 'nlink' ? 2 : Reflect.get(target, key, target); } });
    };
    fs.readSync = (opened, ...args) => { if (opened === fd) reads += 1; return originalRead(opened, ...args); };
    assert.throws(() => readToolingCacheEntry(file), { code: 'ERR_TOOLING_CACHE_ENTRY' });
    assert.equal(reads, 0, 'shared-file admission stays before payload read without creating physical links');
  }
  fs.openSync = originalOpen; fs.readSync = originalRead; fs.fstatSync = originalStat;
  await withTemporaryEnv(ensureTestingEnv({ PAIROFCLEATS_HOME: path.join(root, 'home') }), async () => {
    const command = path.join(root, 'inert-consumer'); fs.writeFileSync(command, 'never executed');
    const base = { providerId: 'contained-cache-fixture', command, args: [], cwd: root, probeEnv: {},
      toolingConfig: { cache: { dir: path.join(root, 'cache') } }, attempted: [{ ok: true }] };
    assert.equal(writePersistentCommandProbeCache(base), true); assert.equal(readPersistentCommandProbeCache(base)?.cached, true);
    const directory = path.join(root, 'cache', 'command-probes'), [name] = fs.readdirSync(directory);
    const entry = path.join(directory, name), originalBytes = fs.readFileSync(entry);
    for (const consume of [() => readPersistentCommandProbeCache(base), () => writePersistentCommandProbeCache(base),
      () => invalidatePersistentCommandProbeCache(base)]) {
      let fd, closes = 0;
      fs.openSync = (target, ...args) => {
        const opened = originalOpen(target, ...args); if (target === entry) { fd = opened; disposal.add(opened); } return opened;
      };
      fs.closeSync = opened => {
        if (opened === fd) { closes += 1; throw new Error('actual cache consumer close fault'); }
        return originalClose(opened);
      };
      const failure = caught(consume);
      assert.ok(getContainedFileSession(failure)); assert.equal(failure.cacheOwnershipReleased(), false);
      assert.equal(closes, 1, 'actual descriptor failure propagates rather than an optional miss/false result');
      originalClose(fd); disposal.delete(fd);
      fs.openSync = originalOpen; fs.closeSync = originalClose;
      assert.deepEqual(fs.readFileSync(entry), originalBytes);
    }
    assert.equal(readPersistentCommandProbeCache(base)?.cached, true);
    const firstEnvironment = { ...base, toolingConfig: { cache: { dir: path.join(root, 'env-cache') } }, probeEnv: { MODE: 'one' } };
    const secondEnvironment = { ...firstEnvironment, probeEnv: { MODE: 'two' } };
    assert.equal(writePersistentCommandProbeCache(firstEnvironment), true);
    assert.equal(writePersistentCommandProbeCache(secondEnvironment), true);
    assert.equal(invalidatePersistentCommandProbeCache(firstEnvironment), true);
    assert.equal(readPersistentCommandProbeCache(firstEnvironment), null);
    assert.equal(readPersistentCommandProbeCache(secondEnvironment)?.cached, true, 'invalidation uses the original environment key and preserves other environments');
    assert.equal(invalidatePersistentCommandProbeCache(secondEnvironment), true);
  });
  assert.deepEqual(fs.readFileSync(file), bytes);
} finally {
  fs.openSync = originalOpen; fs.readSync = originalRead; fs.closeSync = originalClose; fs.fstatSync = originalStat; fs.lstatSync = originalLstat;
  for (const fd of disposal) { try { originalClose(fd); } catch {} }
  await rmDirRecursive(root);
}
console.log('tooling-cache-contained-resource passed');
