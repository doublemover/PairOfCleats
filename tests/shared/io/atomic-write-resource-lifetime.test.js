import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { atomicWriteText, atomicWriteJson, atomicWriteChunks } from '../../../src/shared/io/atomic-write.js';
import { getContainedFileSession } from '../../../src/shared/contained-file-resource.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';

// UNVALIDATED: real public writer/descriptor/metadata consumers, no subprocesses.
const root = await makeTempDir('poc-atomic-write-resource-'), target = path.join(root, 'state');
const marker = path.join(root, 'parent-negative'); await fs.writeFile(marker, 'not a directory');
const open = fs.open, unlink = fs.unlink, lstat = fs.lstat;
const disposal = new Map();
const rejected = async action => {
  let failed = false, failure;
  try { await action(); } catch (value) { failed = true; failure = value; }
  assert.equal(failed, true); return failure;
};
const contains = (failure, expected) => {
  const queue = [failure], seen = new Set();
  while (queue.length) {
    const current = queue.pop(); if (current === expected) return true;
    if (current === null || !['object', 'function'].includes(typeof current) || seen.has(current)) continue;
    seen.add(current);
    for (const field of ['cause', 'errors']) {
      const descriptor = Object.getOwnPropertyDescriptor(current, field); if (!descriptor || !('value' in descriptor)) continue;
      if (field === 'errors' && Array.isArray(descriptor.value)) queue.push(...descriptor.value);
      else if (field === 'cause') queue.push(descriptor.value);
    }
  }
  return false;
};
const intercept = ({ writeFailure, failWrite = false, closeFailure, failClose = false, nonvoid = false,
  replaceMethods = false } = {}) => {
  const state = { path: null, writes: 0, syncs: 0, closes: 0, opens: 0, closed: false,
    allowWrite: !failWrite, allowClose: !failClose && !nonvoid };
  fs.open = async (name, ...args) => {
    const actual = await open(name, ...args); if (args[0] !== 'wx') return actual;
    state.path = name; state.opens += 1;
    const close = actual.close, writeFile = actual.writeFile, write = actual.write, sync = actual.sync, stat = actual.stat;
    disposal.set(actual, () => close.call(actual));
    actual.writeFile = async function (...next) {
      assert.equal(this, actual); state.writes += 1; if (!state.allowWrite) throw writeFailure;
      return writeFile.call(actual, ...next);
    };
    actual.write = async function (...next) { assert.equal(this, actual); state.writes += 1; return write.call(actual, ...next); };
    actual.sync = async function () { assert.equal(this, actual); state.syncs += 1; return sync.call(actual); };
    actual.close = async function () {
      assert.equal(this, actual); state.closes += 1;
      if (!state.allowClose) { if (nonvoid) return false; throw closeFailure; }
      const result = await close.call(actual); state.closed = true; disposal.delete(actual); return result;
    };
    actual.stat = async function (...next) {
      const result = await stat.call(actual, ...next);
      if (replaceMethods) actual.writeFile = actual.write = actual.sync = actual.close = () => assert.fail('replacement cannot replace captured original method');
      return result;
    };
    return actual;
  };
  return state;
};
const restore = () => { fs.open = open; fs.unlink = unlink; fs.lstat = lstat; };
const removeTemps = async () => {
  for (const name of await fs.readdir(root)) if (name.startsWith('state.tmp-')) await fs.unlink(path.join(root, name));
};
try {
  for (const [write, expected] of [
    [() => atomicWriteText(target, 'new', { mkdir: false }), 'new'],
    [() => atomicWriteJson(target, { value: 0 }, { mkdir: false, spaces: 0, newline: false }), '{"value":0}'],
    [() => atomicWriteChunks(target, async emit => { await emit('n'); await emit(Buffer.from('ew')); }, { mkdir: false }), 'new']
  ]) {
    await fs.writeFile(target, 'old'); const state = intercept({ replaceMethods: true });
    await write(); assert.equal(state.closes, 1); assert.equal(state.closed, true); assert.equal(state.syncs, 1);
    assert.equal(await fs.readFile(target, 'utf8'), expected); restore();
  }
  for (const nonvoid of [false, true]) {
    await fs.writeFile(target, 'old'); const primary = Object.freeze(new Error('original staging close failed'));
    const state = intercept({ failClose: true, closeFailure: primary, nonvoid });
    const failure = await rejected(() => atomicWriteText(target, 'new', { mkdir: false }));
    const session = getContainedFileSession(failure); assert.ok(session);
    assert.equal(failure.atomicWritePublicationState, 'uncommitted'); assert.equal(failure.atomicWriteStagingPath, state.path);
    assert.equal(state.closes, 1); assert.equal(await fs.readFile(target, 'utf8'), 'old');
    assert.equal((await fs.stat(state.path)).isFile(), true); const writes = state.writes;
    state.allowClose = true; await session.releaseAfterClose();
    assert.equal(state.closes, 2); assert.equal(state.writes, writes); assert.equal(state.opens, 1);
    assert.equal(await fs.readFile(target, 'utf8'), 'old', 'close-only recovery never publishes');
    assert.equal((await fs.stat(state.path)).isFile(), true, 'late recovery does not replay cleanup');
    restore(); await removeTemps();
  }
  for (const primary of [undefined, null, false, 0, '', Object.freeze(new Error('frozen original write'))]) {
    const secondary = Object.freeze(new Error('independent staging close failure'));
    const state = intercept({ failWrite: true, writeFailure: primary, failClose: true, closeFailure: secondary });
    const failure = await rejected(() => atomicWriteText(target, 'new', { mkdir: false }));
    assert.equal(contains(failure, primary), true); assert.equal(contains(failure, secondary), true);
    assert.equal(state.closes, 1); state.allowClose = true;
    await getContainedFileSession(failure).releaseAfterClose(); assert.equal(state.writes, 1); restore(); await removeTemps();
  }
  for (const markerValue of [undefined, false, true]) {
    let ready = false;
    const primary = new Error('original write native prerequisite');
    if (markerValue !== undefined) primary.cacheOwnershipPending = markerValue;
    primary.cacheOwnershipReleased = function () { assert.equal(this, primary); return ready; };
    const state = intercept({ failWrite: true, writeFailure: primary });
    const failure = await rejected(() => atomicWriteText(target, 'new', { mkdir: false }));
    const session = getContainedFileSession(failure); assert.ok(session); assert.equal(state.closes, 0);
    primary.cacheOwnershipReleased = () => true; await rejected(() => session.releaseAfterClose()); assert.equal(state.closes, 0);
    ready = true; await session.releaseAfterClose(); assert.equal(state.closes, 1); assert.equal(state.writes, 1);
    restore(); await removeTemps();
  }
  {
    const primary = Object.freeze(new Error('reject linked payload')); let unlinks = 0;
    const state = intercept();
    await fs.unlink(target);
    fs.unlink = async (name, ...args) => { assert.equal(state.closed, true, 'rollback must follow actual original close'); unlinks += 1; return unlink(name, ...args); };
    const failure = await rejected(() => atomicWriteText(target, 'new', { mkdir: false, createOnly: true,
      verifyPublished() { throw primary; } }));
    assert.equal(contains(failure, primary), true); assert.equal(state.closes, 1); assert.equal(unlinks, 2);
    await assert.rejects(fs.stat(target), { code: 'ENOENT' }); restore();
  }
  {
    let ready = false, unlinks = 0;
    const primary = Object.assign(new Error('linked verifier retains native work'), { cacheOwnershipReleased() { return ready; } });
    const state = intercept(); fs.unlink = async (...args) => { unlinks += 1; return unlink(...args); };
    const failure = await rejected(() => atomicWriteText(target, 'new', { mkdir: false, createOnly: true,
      verifyPublished() { throw primary; } }));
    assert.equal(state.closes, 0); assert.equal(unlinks, 0); assert.equal(await fs.readFile(target, 'utf8'), 'new');
    primary.cacheOwnershipReleased = () => true; await rejected(() => getContainedFileSession(failure).releaseAfterClose());
    assert.equal(state.closes, 0); ready = true; await getContainedFileSession(failure).releaseAfterClose();
    assert.equal(state.closes, 1); assert.equal(unlinks, 0); restore(); await fs.unlink(target); await removeTemps();
  }
  {
    let allowClose = false, closes = 0;
    const closeFailure = Object.freeze(new Error('parent request original close failed'));
    fs.open = async (name, ...args) => {
      if (name !== root) return open(name, ...args);
      // An actual file returned for a directory request is a negative identity
      // control. It must fail verification and retain its independent close.
      const actual = await open(marker, 'r'), close = actual.close;
      disposal.set(actual, () => close.call(actual));
      actual.close = async function () { closes += 1; if (!allowClose) throw closeFailure;
        const result = await close.call(actual); disposal.delete(actual); return result; };
      return actual;
    };
    const failure = await rejected(() => atomicWriteText(target, 'committed', { mkdir: false, createOnly: true }));
    assert.equal(failure.atomicWritePublicationState, 'committed'); assert.equal(await fs.readFile(target, 'utf8'), 'committed');
    assert.equal(contains(failure, closeFailure), true); assert.equal(closes, 1);
    allowClose = true; await getContainedFileSession(failure).releaseAfterClose(); assert.equal(closes, 2);
    assert.equal(await fs.readFile(target, 'utf8'), 'committed'); restore(); await fs.unlink(target);
  }
  {
    let ready = false;
    const primary = Object.assign(new Error('unsupported parent open still owns native work'), { code: 'EINVAL', cacheOwnershipReleased() { return ready; } });
    fs.open = async (name, ...args) => { if (name === root) throw primary; return open(name, ...args); };
    const failure = await rejected(() => atomicWriteText(target, 'committed', { mkdir: false }));
    assert.equal(failure.atomicWritePublicationState, 'committed'); assert.equal(failure.cacheOwnershipReleased(), false);
    primary.cacheOwnershipReleased = () => true; assert.equal(failure.cacheOwnershipReleased(), false);
    ready = true; assert.equal(failure.cacheOwnershipReleased(), true); assert.equal(getContainedFileSession(failure), null);
    restore();
  }
  {
    let ready = true, unlinks = 0;
    const primary = Object.assign(new Error('rollback prerequisite changes during metadata lookup'), {
      cacheOwnershipReleased() { return ready; }
    });
    const state = intercept();
    fs.lstat = async (name, ...args) => { const value = await lstat(name, ...args); if (name === state.path) ready = false; return value; };
    fs.unlink = async (...args) => { unlinks += 1; return unlink(...args); };
    const failure = await rejected(() => atomicWriteText(target, 'new', { mkdir: false, beforeCommit() { throw primary; } }));
    assert.equal(state.closes, 1); assert.equal(unlinks, 0, 'original prerequisite must be checked after lookup and before actual unlink');
    primary.cacheOwnershipReleased = () => true; assert.equal(failure.cacheOwnershipReleased(), false);
    ready = true; assert.equal(failure.cacheOwnershipReleased(), true); assert.equal(unlinks, 0); restore(); await removeTemps();
  }
  {
    const primary = Object.freeze(new Error('preserve replaced staging pathname')); let staged, saved;
    const failure = await rejected(() => atomicWriteText(target, 'new', { mkdir: false, beforeCommit: async (_handle, file) => {
      staged = file; saved = file + '.saved'; await fs.rename(file, saved); await fs.writeFile(file, 'foreign'); throw primary;
    } }));
    assert.equal(contains(failure, primary), true); assert.equal(await fs.readFile(staged, 'utf8'), 'foreign');
    assert.equal(await fs.readFile(saved, 'utf8'), 'new'); await fs.unlink(staged); await fs.unlink(saved);
  }
} finally {
  restore(); for (const close of disposal.values()) { try { await close(); } catch {} }
  await rmDirRecursive(root);
}
