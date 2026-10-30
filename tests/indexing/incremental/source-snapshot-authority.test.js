import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import nativeFs from 'node:fs';
import path from 'node:path';
import { sha1 } from '../../../src/shared/hash.js';
import { readIncrementalSourceSnapshot, isIncrementalSourceMiss } from '../../../src/index/build/incremental/source-snapshot.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';

const { dir } = await prepareIsolatedTestCacheDir('incremental-source-authority');
const root = path.join(dir, 'selected'); await fs.mkdir(root);
const file = path.join(root, 'source.js'), outside = path.join(dir, 'outside.js');
const bytes = Buffer.from('export const answer = 42;\n');
await fs.writeFile(file, bytes); await fs.writeFile(outside, bytes);
let stat = await fs.stat(file), reads = 0, outsideOpens = 0, behavior = null;
const open = fs.open, lstat = nativeFs.lstatSync;
const primary = Object.freeze(Object.assign(new Error('controlled source read'), { code: 'EIO' }));
const closeFailure = Object.freeze(new Error('controlled source close'));
const contains = (error, expected, seen = new Set()) => error === expected || Boolean(error && typeof error === 'object'
  && !seen.has(error) && (seen.add(error), [error.cause, ...(error.errors || [])].some(item => contains(item, expected, seen))));
try {
  fs.open = async (target, ...args) => {
    if (path.relative(String(target), outside) === '') outsideOpens++;
    const handle = await open.call(fs, target, ...args);
    if (path.relative(String(target), file) === '') {
      const read = handle.read, close = handle.close, selected = behavior;
      handle.read = async function (...args) {
        if (selected === 'read-close') throw primary;
        const result = await read.apply(this, args); if (result.bytesRead > 0) reads++;
        if (selected instanceof AbortController) selected.abort();
        return result;
      };
      if (selected === 'read-close' || selected === 'close') handle.close = async function () {
        await close.call(this); throw closeFailure;
      };
    }
    return handle;
  };
  const cache = new Map([['source.js', { size: stat.size, mtimeMs: stat.mtimeMs, hash: 'forged', buffer: Buffer.from('forged') }]]);
  const input = () => ({ repoRoot: root, absPath: file, relKey: 'source.js', fileStat: stat, sharedReadState: cache });
  const first = await readIncrementalSourceSnapshot(input());
  assert.equal(first.hash, sha1(bytes)); assert.deepEqual(first.buffer, bytes); assert.equal(reads, 1);
  first.buffer.fill(0);
  assert.deepEqual((await readIncrementalSourceSnapshot(input())).buffer, bytes, 'returned buffers cannot mutate the private receipt');
  assert.equal(reads, 1, 'unchanged bundle/import consumers retain one payload read');
  const stolen = new Map(cache);
  await readIncrementalSourceSnapshot({ ...input(), sharedReadState: stolen });
  assert.equal(reads, 2, 'public entries cannot transfer admission to another read scope');
  await assert.rejects(readIncrementalSourceSnapshot({ ...input(), absPath: outside, sharedReadState: new Map(cache) }), { code: 'ERR_UNSAFE_FILE_PATH' });
  assert.equal(outsideOpens, 0);

  const backup = path.join(root, 'source.old'); await fs.rename(file, backup); await fs.writeFile(file, bytes);
  await fs.utimes(file, stat.atime, stat.mtime);
  stat = { size: bytes.length, mtimeMs: (await fs.stat(file)).mtimeMs };
  assert.deepEqual((await readIncrementalSourceSnapshot(input())).buffer, bytes);
  assert.equal(reads, 3, 'same-byte replacement requires a fresh actual object receipt');
  const oldStat = stat; await fs.appendFile(file, 'growth');
  const beforeGrowth = reads;
  await assert.rejects(readIncrementalSourceSnapshot({ ...input(), fileStat: oldStat }),
    error => ['ERR_FILE_CHANGED', 'ERR_FILE_TOO_LARGE'].includes(error.code));
  assert.equal(reads, beforeGrowth, 'growth rejected before source payload allocation/read');
  await fs.writeFile(file, bytes); stat = await fs.stat(file);

  nativeFs.lstatSync = (target, ...args) => {
    const result = lstat.call(nativeFs, target, ...args);
    return path.relative(String(target), file) === '' ? Object.create(result, { isSymbolicLink: { value: () => true } }) : result;
  };
  await assert.rejects(readIncrementalSourceSnapshot({ ...input(), sharedReadState: new Map() }), { code: 'ERR_UNSAFE_FILE_PATH' });
  nativeFs.lstatSync = lstat;
  for (const failure of ['read-close', 'close']) {
    behavior = failure; const scope = new Map();
    await assert.rejects(readIncrementalSourceSnapshot({ ...input(), sharedReadState: scope }), error => {
      assert.equal(error.cacheOwnershipPending, true); assert.ok(contains(error, closeFailure));
      if (failure === 'read-close') assert.ok(contains(error, primary));
      assert.throws(() => isIncrementalSourceMiss(error), pending => pending.cacheOwnershipPending === true);
      return true;
    });
    assert.equal(scope.size, 0, 'failed close never publishes a shared receipt');
  }
  behavior = new AbortController();
  await assert.rejects(readIncrementalSourceSnapshot({ ...input(), sharedReadState: new Map(), signal: behavior.signal }), { code: 'ABORT_ERR' });
} finally { fs.open = open; nativeFs.lstatSync = lstat; }
console.log('incremental source snapshot authority passed');
