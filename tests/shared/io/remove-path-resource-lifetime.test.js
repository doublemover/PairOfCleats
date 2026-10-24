import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { removePathWithRetry } from '../../../src/shared/io/remove-path-with-retry.js';
import { removeFileOrThrow } from '../../../src/shared/bundle-io/support.js';
import { persistenceFileIdentity } from '../../../src/shared/io/file-identity.js';
import { persistenceDirectoryIdentity } from '../../../src/shared/io/directory-identity.js';
import { createContainedFileResource, getContainedFileSession } from '../../../src/shared/contained-file-resource.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';

// UNVALIDATED: actual removal and bundle cleanup consumers with original native
// resource failures. All physical changes are confined to this disposable root.
const root = await makeTempDir('poc-remove-resource-'), remove = fs.rm, lstat = fsSync.lstatSync;
const disposal = new Map(); let sequence = 0;
const fixture = async () => { const file = path.join(root, String(sequence++)); await fs.writeFile(file, 'old'); return file; };
const rejected = async action => {
  let present = false, failure;
  try { await action(); } catch (error) { present = true; failure = error; }
  assert.equal(present, true); return failure;
};
const values = error => {
  const queue = [error], seen = new Set(), result = [];
  while (queue.length) {
    const current = queue.pop(); result.push(current);
    if (current === null || !['object', 'function'].includes(typeof current) || seen.has(current)) continue;
    seen.add(current);
    for (const field of ['cause', 'errors']) {
      const descriptor = Object.getOwnPropertyDescriptor(current, field); if (!descriptor || !('value' in descriptor)) continue;
      if (field === 'errors' && Array.isArray(descriptor.value)) queue.push(...descriptor.value);
      else if (field === 'cause') queue.push(descriptor.value);
    }
  }
  return result;
};
const contains = (error, expected) => values(error).some(value => value === expected);
const hasCode = (error, expected) => values(error).some(value => value !== null && typeof value === 'object'
  && Object.getOwnPropertyDescriptor(value, 'code')?.value === expected);
const options = { attempts: 4, baseDelayMs: 1, maxDelayMs: 1 };
try {
  {
    const file = await fixture(), numeric = lstat(file);
    assert.throws(() => persistenceFileIdentity(numeric, { multipleLinks: true }), { code: 'ERR_PERSISTENCE_FILE_CHANGED' });
    assert.throws(() => persistenceDirectoryIdentity(lstat(root)), { code: 'ERR_PERSISTENCE_DIRECTORY_CHANGED' });
    fsSync.lstatSync = () => numeric; let calls = 0;
    const result = await removePathWithRetry(file, { ...options, rm: async () => { calls++; } });
    fsSync.lstatSync = lstat;
    assert.equal(result.ok, false); assert.equal(result.attempts, 0); assert.equal(calls, 0);
    assert.equal(hasCode(result.error, 'ERR_REMOVE_PATH_IDENTITY_UNAVAILABLE'), true);
  }
  {
    const file = await fixture(), removed = await removePathWithRetry(file, options);
    assert.equal(removed.ok, true); assert.equal(removed.attempts, 1);
    const absent = await removePathWithRetry(file, options); assert.equal(absent.ok, true); assert.equal(absent.attempts, 0);
    const directory = path.join(root, String(sequence++)); await fs.mkdir(directory); await fs.writeFile(path.join(directory, 'child'), 'value');
    assert.equal((await removePathWithRetry(directory, options)).ok, true);
  }
  for (const marker of [undefined, false, true]) {
    let ready = false, calls = 0, probes = 0, codes = 0;
    const primary = { cacheOwnershipReleased() { assert.equal(this, primary); return ready; },
      get code() { codes++; return 'EBUSY'; } };
    if (marker !== undefined) primary.cacheOwnershipPending = marker;
    const result = await removePathWithRetry('virtual', { ...options,
      exists() { probes++; return probes === 1; }, rm: async () => { calls++; throw primary; } });
    assert.equal(result.ok, false); assert.equal(result.attempts, 1); assert.equal(calls, 1); assert.equal(probes, 1); assert.equal(codes, 0);
    primary.cacheOwnershipReleased = () => true; assert.equal(result.error.cacheOwnershipReleased(), false);
    ready = true; assert.equal(result.error.cacheOwnershipReleased(), true); assert.equal(calls, 1);
  }
  {
    let ready = true, calls = 0, codes = 0;
    const primary = { cacheOwnershipReleased() { return ready; }, get code() {
      codes++; ready = false; this.cacheOwnershipReleased = () => true; return 'EBUSY';
    } };
    const result = await removePathWithRetry('virtual', { ...options, exists: () => true, rm: async () => { calls++; throw primary; } });
    assert.equal(result.ok, false); assert.equal(calls, 1); assert.equal(codes, 1); assert.equal(result.error.cacheOwnershipReleased(), false);
    ready = true; assert.equal(result.error.cacheOwnershipReleased(), true);
  }
  for (const primary of [undefined, null, false, 0, '', Object.freeze(new Error('frozen remove failure'))]) {
    let calls = 0;
    const result = await removePathWithRetry('virtual', { ...options, exists: () => true, rm: async () => { calls++; throw primary; } });
    assert.equal(result.ok, false); assert.equal(result.attempts, 1); assert.equal(calls, 1); assert.equal(contains(result.error, primary), true);
  }
  for (const primary of [null, Object.freeze(Object.assign(new Error('probe denied'), { code: 'EACCES' }))]) {
    let probes = 0, calls = 0;
    const result = await removePathWithRetry('virtual', { ...options,
      exists() { if (++probes === 1) return true; throw primary; }, rm: async () => { calls++; } });
    assert.equal(result.ok, false); assert.equal(result.attempts, 1); assert.equal(calls, 1); assert.equal(contains(result.error, primary), true);
  }
  {
    let calls = 0;
    const result = await removePathWithRetry('virtual', { ...options, exists: () => Promise.resolve(false), rm: async () => { calls++; } });
    assert.equal(result.ok, false); assert.equal(result.attempts, 0); assert.equal(calls, 0); assert.equal(result.error.cacheOwnershipReleased(), false);
  }
  {
    let calls = 0, probes = 0; const primary = Object.assign(new Error('I/O failed even if pathname later disappears'), { code: 'EIO' });
    const result = await removePathWithRetry('virtual', { ...options, exists: () => ++probes === 1,
      rm: async () => { calls++; throw primary; } });
    assert.equal(result.ok, false); assert.equal(calls, 1); assert.equal(probes, 1); assert.equal(contains(result.error, primary), true);
  }
  {
    const file = await fixture(), saved = file + '.saved'; let calls = 0;
    const primary = Object.assign(new Error('busy before root replacement'), { code: 'EBUSY' });
    const result = await removePathWithRetry(file, { ...options, rm: async target => {
      calls++; await fs.rename(target, saved); await fs.writeFile(target, 'foreign');
      fsSync.lstatSync = () => assert.fail('original lstat method must remain captured'); throw primary;
    } });
    fsSync.lstatSync = lstat;
    assert.equal(result.ok, false); assert.equal(calls, 1); assert.equal(contains(result.error, primary), true);
    assert.equal(hasCode(result.error, 'ERR_REMOVE_PATH_CHANGED'), true);
    assert.equal(await fs.readFile(file, 'utf8'), 'foreign'); assert.equal(await fs.readFile(saved, 'utf8'), 'old');
  }
  {
    const parent = path.join(root, String(sequence++)), saved = parent + '.saved'; await fs.mkdir(parent);
    const file = path.join(parent, 'file'); await fs.writeFile(file, 'old'); let calls = 0;
    const result = await removePathWithRetry(file, { ...options, rm: async () => {
      calls++; await fs.rename(parent, saved); await fs.mkdir(parent); throw Object.assign(new Error('busy during parent replacement'), { code: 'EBUSY' });
    } });
    assert.equal(result.ok, false); assert.equal(calls, 1); assert.equal(hasCode(result.error, 'ERR_PERSISTENCE_DIRECTORY_CHANGED'), true);
    assert.equal(await fs.readFile(path.join(saved, 'file'), 'utf8'), 'old');
  }
  {
    const file = await fixture(); let calls = 0;
    const result = await removePathWithRetry(file, { ...options, rm: async target => {
      calls++; await remove(target); await fs.writeFile(target, 'foreign');
    } });
    assert.equal(result.ok, false); assert.equal(calls, 1); assert.equal(hasCode(result.error, 'ERR_REMOVE_PATH_CHANGED'), true);
    assert.equal(await fs.readFile(file, 'utf8'), 'foreign');
  }
  {
    const file = await fixture(); let ready = false, calls = 0;
    const primary = Object.assign(new Error('removed bundle pathname but native work remains pending'), { cacheOwnershipReleased() { return ready; } });
    fs.rm = async (target, ...args) => { calls++; await remove(target, ...args); throw primary; };
    const failure = await rejected(() => removeFileOrThrow(file)); fs.rm = remove;
    assert.equal(contains(failure, primary), true); assert.equal(calls, 1); assert.equal(failure.cacheOwnershipReleased(), false);
    primary.cacheOwnershipReleased = () => true; assert.equal(failure.cacheOwnershipReleased(), false);
    ready = true; assert.equal(failure.cacheOwnershipReleased(), true);
  }
  {
    const file = await fixture(), handle = await fs.open(file, 'r'), close = handle.close; let allowClose = false, closes = 0, calls = 0;
    disposal.set(handle, () => close.call(handle));
    handle.close = async function () {
      closes++; if (!allowClose) throw Object.freeze(new Error('actual original descriptor close failed'));
      const result = await close.call(handle); disposal.delete(handle); return result;
    };
    const resource = createContainedFileResource({ handle, sync: false });
    const original = await rejected(() => resource.run(() => undefined)), session = getContainedFileSession(original); assert.ok(session);
    const result = await removePathWithRetry(file, { ...options, rm: async () => { calls++; throw original; } });
    assert.equal(result.ok, false); assert.equal(getContainedFileSession(result.error), session); assert.equal(calls, 1); assert.equal(closes, 1);
    allowClose = true; await session.releaseAfterClose(); assert.equal(closes, 2); assert.equal(calls, 1);
    assert.equal(result.error.cacheOwnershipReleased(), true); assert.equal(await fs.readFile(file, 'utf8'), 'old');
  }
} finally {
  fs.rm = remove; fsSync.lstatSync = lstat;
  for (const close of disposal.values()) { try { await close(); } catch {} }
  await rmDirRecursive(root);
}
