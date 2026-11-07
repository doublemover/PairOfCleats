import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import nativeFs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { copyStageMembers, copyUnpublishedStageMembers } from '../../../src/index/build/stage-output.js';
import { getContainedFileSession } from '../../../src/shared/contained-file-resource.js';
import { observeStorageResource } from '../../../src/shared/storage/failure-observation.js';
import { addStorageFailureContext } from '../../../src/shared/storage/operation-error.js';
import { errorGraphIncludes } from '../../helpers/error-graph.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
const selected = process.env.PAIROFCLEATS_TEST_ID?.split('indexing/artifacts/unpublished-copy-native-metadata/')[1];
assert.ok(['work', 'ordinary', 'native-eacces', 'native-pending', 'original-method'].includes(selected));
const { dir } = await prepareIsolatedTestCacheDir('unpublished-copy-native-' + selected);
const sourceRoot = path.join(dir, 'source'), targetRoot = path.join(dir, 'target');
await fs.mkdir(path.join(sourceRoot, 'nested'), { recursive: true }); await fs.mkdir(targetRoot);
const payload = Buffer.from('original private copy bytes: λ\n');
const names = selected === 'work' ? ['nested/one', 'nested/two', 'empty'] : ['nested/one'];
const expected = new Map(names.map(name => [name, name === 'empty' ? Buffer.alloc(0) : payload]));
for (const [name, bytes] of expected) await fs.writeFile(path.join(sourceRoot, name), bytes);
const inventory = [...expected].map(([name, bytes]) => ({ path: name, bytes: bytes.length,
  hash: createHash('sha256').update(bytes).digest('hex') }));
const original = { open: fs.open, stat: fs.stat, lstat: fs.lstat,
  fstatSync: nativeFs.fstatSync, statSync: nativeFs.statSync, lstatSync: nativeFs.lstatSync };
const handles = [], byFd = new Map(), sessions = [];
const counts = { asyncFd: 0, asyncPath: 0, nativeSourceFd: 0, nativeTargetFd: 0, nativeTargetPath: 0,
  nativeParentPath: 0, reads: 0, writes: 0, sourceCloses: 0, targetCloses: 0 };
const same = (left, right) => path.relative(path.resolve(String(left)), path.resolve(String(right))) === '';
const memberRole = filename => names.some(name => same(filename, path.join(sourceRoot, name))) ? 'source'
  : names.some(name => same(filename, path.join(targetRoot, name))) ? 'target' : 'other';
const liveMembers = () => handles.some(handle => handle.role !== 'other' && !handle.closed);
let recovered = false, injected = false, poisoned = false, workError;
const failure = Object.freeze(Object.assign(new Error('original native target metadata admission'), {
  code: 'EACCES', ...(selected === 'native-pending' ? { cacheOwnershipReleased() { assert.equal(this, failure); return recovered; } } : {})
}));
const poison = () => { throw new Error('a later global method cannot replace its original borrowed operation'); };
const captureSessions = error => {
  const visited = new Set();
  const visit = value => {
    if (!value || typeof value !== 'object' || visited.has(value)) return;
    visited.add(value); visit(Object.getOwnPropertyDescriptor(value, 'cause')?.value);
    const children = Object.getOwnPropertyDescriptor(value, 'errors')?.value;
    if (Array.isArray(children)) children.forEach(visit);
    const session = getContainedFileSession(value); if (session && !sessions.includes(session)) sessions.push(session);
  }; visit(error);
};
const nativeFstat = function(fd, options) {
  assert.equal(this, nativeFs);
  const entry = byFd.get(fd);
  if (entry && entry.role !== 'other') {
    assert.equal(entry.closed, false); assert.equal(options?.bigint, true);
    counts[entry.role === 'source' ? 'nativeSourceFd' : 'nativeTargetFd']++;
    if (!injected && entry.role === 'target' && ['native-eacces', 'native-pending'].includes(selected)) {
      injected = true; throw failure;
    }
  }
  return original.fstatSync.call(this, fd, options);
};
nativeFs.fstatSync = nativeFstat;
nativeFs.statSync = function(filename, options) {
  assert.equal(this, nativeFs);
  if (liveMembers() && options?.bigint && names.some(name => same(filename, path.dirname(path.join(targetRoot, name))))) counts.nativeParentPath++;
  return original.statSync.call(this, filename, options);
};
nativeFs.lstatSync = function(filename, options) {
  assert.equal(this, nativeFs);
  if (liveMembers() && options?.bigint && memberRole(filename) === 'target') counts.nativeTargetPath++;
  return original.lstatSync.call(this, filename, options);
};
for (const name of ['stat', 'lstat']) fs[name] = function(filename, ...args) {
  if (liveMembers()) counts.asyncPath++;
  return original[name].call(this, filename, ...args);
};
fs.open = async function(filename, ...args) {
  const handle = await original.open.call(this, filename, ...args);
  let role = memberRole(filename);
  const targetRelative = path.relative(targetRoot, path.resolve(String(filename)));
  if (selected === 'ordinary' && role === 'other' && !path.isAbsolute(targetRelative)
    && targetRelative && targetRelative !== '..' && !targetRelative.startsWith('..' + path.sep)
    && typeof args[0] === 'string' && args[0].includes('w')) role = 'target';
  const entry = { role, closed: false, handle }; handles.push(entry); byFd.set(handle.fd, entry);
  const stat = handle.stat, read = handle.read, write = handle.write, close = handle.close;
  handle.stat = function(...statArgs) {
    if (role !== 'other') counts.asyncFd++;
    return stat.apply(this, statArgs);
  };
  handle.read = function(buffer, offset, length, position) {
    if (role === 'source') {
      counts.reads++;
      if (selected === 'original-method' && !poisoned) { poisoned = true; nativeFs.fstatSync = poison; }
    }
    return read.call(this, buffer, offset, Math.min(length, 3), position);
  };
  handle.write = function(buffer, offset, length, position) {
    if (role === 'target') counts.writes++;
    return write.call(this, buffer, offset, Math.min(length, 2), position);
  };
  handle.close = async function(...closeArgs) {
    const value = await close.apply(this, closeArgs); entry.closed = true;
    if (role === 'source') counts.sourceCloses++;
    if (role === 'target') { counts.targetCloses++; if (selected === 'original-method') nativeFs.fstatSync = nativeFstat; }
    return value;
  };
  return handle;
};
try {
  const copy = selected === 'ordinary' ? copyStageMembers : copyUnpublishedStageMembers;
  const run = () => copy({ sourceRoot, targetRoot, inventory, assertOwned() {} });
  if (['native-eacces', 'native-pending'].includes(selected)) {
    let observed;
    await assert.rejects(run(), error => { observed = error; captureSessions(error); return errorGraphIncludes(error, failure); });
    assert.equal(injected, true, 'the actual new native descriptor admission must receive the controlled fault');
    assert.equal(counts.reads, 0); assert.equal(counts.writes, 0);
    if (selected === 'native-pending') {
      assert.equal(sessions.length, 2); assert.equal(counts.sourceCloses + counts.targetCloses, 0);
      assert.equal(observed.cacheOwnershipReleased(), false);
      recovered = true;
      assert.equal(observed.cacheOwnershipReleased(), false, 'producer observation alone cannot confirm actual descriptor closure');
      for (const session of sessions) await session.releaseAfterClose();
      assert.equal(observed.cacheOwnershipReleased(), true);
    }
    assert.equal(counts.sourceCloses, 1); assert.equal(counts.targetCloses, 1);
  } else {
    await run();
    console.log(JSON.stringify({ selected, metadataCounts: counts }));
    if (selected === 'ordinary') assert.ok(counts.asyncFd > 0, 'the ordinary atomic copy keeps its existing metadata operation owner');
    else {
      assert.equal(counts.asyncFd, 0, 'private copies retain fresh native checks without async descriptor-stat dispatch');
      assert.equal(counts.asyncPath, 0, 'member path/parent checks remain fresh native operations inside the held descriptor callback');
      assert.equal(counts.nativeTargetFd, names.length * 2);
      assert.equal(counts.nativeTargetPath, names.length * 2);
      assert.equal(counts.nativeParentPath, names.length * 2);
      assert.equal(counts.nativeSourceFd, names.length * 3, 'source admission/before-copy/end verification all remain observed');
    }
    assert.equal(counts.sourceCloses, names.length); assert.equal(counts.targetCloses, names.length);
    for (const [name, bytes] of expected) assert.deepEqual(await fs.readFile(path.join(targetRoot, name)), bytes);
  }
} catch (error) { workError = error; }
finally {
  recovered = true;
  try { for (const session of sessions) if (!session.isSettled()) await session.releaseAfterClose(); }
  catch (error) { workError = workError ? addStorageFailureContext(workError, {}, error, { secondaryPresent: true }) : error; }
  fs.open = original.open; fs.stat = original.stat; fs.lstat = original.lstat;
  nativeFs.fstatSync = original.fstatSync; nativeFs.statSync = original.statSync; nativeFs.lstatSync = original.lstatSync;
  try {
    if (workError) observeStorageResource(workError, { phase: 'native-copy-fixture-cleanup' }).requireSettled();
    assert.ok(handles.every(handle => handle.closed), 'actual original descriptors settle before fixture cleanup');
    assert.ok(path.relative(process.cwd(), dir).startsWith('.tmp' + path.sep));
    await fs.rm(dir, { recursive: true, force: true });
  } catch (error) { workError = workError ? addStorageFailureContext(workError, {}, error, { secondaryPresent: true }) : error; }
}
if (workError) throw workError;
console.log('Actual ' + selected + ' copy retains fresh native metadata, exact partial progress and original error/close owners.');
