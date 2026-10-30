import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { replaceDir } from '../../../src/shared/io/replace-dir.js';
import { getContainedFileSession } from '../../../src/shared/contained-file-resource.js';
import { getStorageDirectorySession } from '../../../src/shared/storage/directory.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';

// UNVALIDATED: actual directory replacement, captured native prerequisites and
// disposable namespace changes. No child process or physical link is created.
const root = await makeTempDir('poc-directory-replacement-');
const rename = fs.rename, copy = fs.cp, remove = fs.rm, open = fs.open, lstat = fs.lstat;
const disposal = new Map(); let sequence = 0;
const restore = () => { fs.rename = rename; fs.cp = copy; fs.rm = remove; fs.open = open; fs.lstat = lstat; };
const rejected = async action => {
  let present = false, failure;
  try { await action(); } catch (error) { present = true; failure = error; }
  assert.equal(present, true); return failure;
};
const contains = (error, expected) => {
  const queue = [error], seen = new Set();
  while (queue.length) {
    const current = queue.pop(); if (current === expected) return true;
    if (current === null || !['object', 'function'].includes(typeof current) || seen.has(current)) continue;
    seen.add(current);
    for (const field of ['cause', 'errors']) {
      const descriptor = Object.getOwnPropertyDescriptor(current, field);
      if (!descriptor || !('value' in descriptor)) continue;
      if (field === 'errors' && Array.isArray(descriptor.value)) queue.push(...descriptor.value);
      else if (field === 'cause') queue.push(descriptor.value);
    }
  }
  return false;
};
const fixture = async () => {
  restore(); const directory = path.join(root, String(sequence++)), source = path.join(directory, 'source'), final = path.join(directory, 'final');
  await fs.mkdir(source, { recursive: true }); await fs.mkdir(final);
  await fs.writeFile(path.join(source, 'value'), 'new'); await fs.writeFile(path.join(final, 'value'), 'old');
  // Exercise the documented unsupported directory-open branch deterministically
  // on both Windows and POSIX. These controls do not claim directory durability.
  fs.open = async (file, ...args) => { if (file === directory) throw Object.assign(new Error('directory sync unsupported fixture'), { code: 'EPERM' }); return open(file, ...args); };
  return { directory, source, final };
};
const names = async directory => (await fs.readdir(directory)).filter(name => name.startsWith('.final.bak-')).map(name => path.join(directory, name));
try {
  for (const keepBackup of [false, true]) {
    const { directory, source, final } = await fixture(); let renames = 0, copies = 0;
    fs.rename = async (...args) => { renames++; return rename(...args); };
    fs.cp = async (...args) => { copies++; return copy(...args); };
    const result = await replaceDir(source, final, { keepBackup });
    assert.equal(await fs.readFile(path.join(final, 'value'), 'utf8'), 'new');
    assert.equal(renames, 2); assert.equal(copies, 0);
    if (keepBackup) { assert.equal(await fs.readFile(path.join(result.backupPath, 'value'), 'utf8'), 'old'); }
    else { assert.equal(result.backupPath, null); assert.deepEqual(await names(directory), []); }
  }
  {
    const { source, final } = await fixture(); let attempts = 0, copies = 0;
    await fs.mkdir(path.join(source, 'nested'));
    await fs.mkdir(path.join(source, 'empty'));
    await fs.writeFile(path.join(source, 'nested', 'payload'), 'nested new');
    const original = Object.assign(new Error('ordinary cross-volume rename'), { code: 'EXDEV' });
    fs.rename = async (from, to) => { if (from === source && to === final) { attempts++; throw original; } return rename(from, to); };
    fs.cp = async (from, to, options) => {
      copies++; assert.notEqual(to, final); assert.equal(options.force, false); assert.equal(options.errorOnExist, true);
      return copy(from, to, options);
    };
    const result = await replaceDir(source, final, { keepBackup: true });
    assert.equal(attempts, 20, 'existing two bounded retry windows precede fallback'); assert.equal(copies, 3, 'each root child retains exclusive destination copying');
    assert.equal(await fs.readFile(path.join(final, 'value'), 'utf8'), 'new');
    assert.equal(await fs.readFile(path.join(final, 'nested', 'payload'), 'utf8'), 'nested new');
    assert.deepEqual(await fs.readdir(path.join(final, 'empty')), []);
    assert.equal(await fs.readFile(path.join(result.backupPath, 'value'), 'utf8'), 'old');
    await assert.rejects(fs.lstat(source), { code: 'ENOENT' });
  }
  {
    const { directory, source, final } = await fixture(); let copies = 0;
    const original = Object.assign(new Error('quota-owned promotion denied'), { code: 'EXDEV' });
    fs.rename = async (from, to) => { if (from === source && to === final) throw original; return rename(from, to); };
    fs.cp = async (...args) => { copies++; return copy(...args); };
    const failure = await rejected(() => replaceDir(source, final, { keepBackup: true, allowCopyFallback: false }));
    assert.equal(failure, original, 'ordinary extensible failure identity remains compatible'); assert.equal(copies, 0);
    assert.equal(await fs.readFile(path.join(final, 'value'), 'utf8'), 'old'); assert.deepEqual(await names(directory), []);
  }
  for (const primary of [undefined, null, false, 0, '', Object.freeze(new Error('frozen native rename failure'))]) {
    const { source, final } = await fixture();
    fs.rename = async (from, to) => { if (from === source && to === final) throw primary; return rename(from, to); };
    const failure = await rejected(() => replaceDir(source, final)); assert.equal(contains(failure, primary), true);
    assert.equal(await fs.readFile(path.join(final, 'value'), 'utf8'), 'old');
    assert.equal(await fs.readFile(path.join(source, 'value'), 'utf8'), 'new');
  }
  {
    const { directory, source, final } = await fixture(); let ready = false, calls = 0, copies = 0, removals = 0, codes = 0;
    const primary = { cacheOwnershipPending: false, cacheOwnershipReleased() { assert.equal(this, primary); return ready; },
      get code() { codes++; return 'EXDEV'; } };
    fs.rename = async (from, to) => { calls++; if (from === source && to === final) throw primary; return rename(from, to); };
    fs.cp = async (...args) => { copies++; return copy(...args); }; fs.rm = async (...args) => { removals++; return remove(...args); };
    const failure = await rejected(() => replaceDir(source, final));
    assert.equal(calls, 2, 'backup plus one pending native promotion only'); assert.equal(codes, 0);
    assert.equal(copies, 0); assert.equal(removals, 0); assert.equal(failure.cacheOwnershipReleased(), false);
    primary.cacheOwnershipReleased = () => true; assert.equal(failure.cacheOwnershipReleased(), false);
    const [backup] = await names(directory); assert.equal(await fs.readFile(path.join(backup, 'value'), 'utf8'), 'old');
    assert.equal(failure.recoveryPaths.includes(backup), true); ready = true; assert.equal(failure.cacheOwnershipReleased(), true);
    assert.equal(calls, 2, 'settlement observation does not replay restore/publication');
  }
  {
    const { directory, source, final } = await fixture(); let ready = false, copies = 0, removals = 0, staged;
    const primary = Object.assign(new Error('copy still owns native work'), { cacheOwnershipReleased() { return ready; } });
    fs.rename = async (from, to) => { if (from === source && to === final) throw Object.assign(new Error('cross-volume'), { code: 'EXDEV' }); return rename(from, to); };
    fs.cp = async (_from, to) => { copies++; staged = path.dirname(to); await fs.writeFile(path.join(staged, 'partial'), 'partial'); throw primary; };
    fs.rm = async (...args) => { removals++; return remove(...args); };
    const failure = await rejected(() => replaceDir(source, final));
    assert.equal(copies, 1); assert.equal(removals, 0); assert.equal(failure.cacheOwnershipReleased(), false);
    assert.equal(await fs.readFile(path.join(staged, 'partial'), 'utf8'), 'partial');
    assert.equal(failure.recoveryPaths.includes(staged), true);
    const backups = (await names(directory)).filter(file => file !== staged); assert.equal(backups.length, 1);
    assert.equal(await fs.readFile(path.join(backups[0], 'value'), 'utf8'), 'old');
    primary.cacheOwnershipReleased = () => true; assert.equal(failure.cacheOwnershipReleased(), false);
    ready = true; assert.equal(failure.cacheOwnershipReleased(), false, 'settled copy work does not close its independently retained directory');
    const directorySession = getStorageDirectorySession(failure); assert.ok(directorySession);
    await directorySession.releaseAfterClose();
    assert.equal(failure.cacheOwnershipReleased(), true); assert.equal(copies, 1); assert.equal(removals, 0);
  }
  {
    const { directory, source, final } = await fixture(); let removals = 0;
    const primary = Object.freeze(Object.assign(new Error('failed promotion with a foreign current'), { code: 'EINVAL' }));
    fs.rename = async (from, to) => {
      if (from === source && to === final) { await fs.mkdir(final); await fs.writeFile(path.join(final, 'foreign'), 'foreign'); throw primary; }
      return rename(from, to);
    };
    fs.rm = async (...args) => { removals++; return remove(...args); };
    const failure = await rejected(() => replaceDir(source, final));
    assert.equal(contains(failure, primary), true); assert.equal(removals, 0);
    assert.equal(await fs.readFile(path.join(final, 'foreign'), 'utf8'), 'foreign');
    const [backup] = await names(directory); assert.equal(await fs.readFile(path.join(backup, 'value'), 'utf8'), 'old');
    assert.equal(failure.recoveryPaths.includes(backup), true);
  }
  {
    const { source, final } = await fixture(); let backup, saved, removals = 0;
    fs.rename = async (from, to) => {
      const result = await rename(from, to);
      if (from === final) backup = to;
      if (from === source) {
        saved = backup + '.saved'; await rename(backup, saved); await fs.mkdir(backup); await fs.writeFile(path.join(backup, 'foreign'), 'foreign');
      }
      return result;
    };
    fs.rm = async (...args) => { removals++; return remove(...args); };
    const failure = await rejected(() => replaceDir(source, final));
    assert.equal(failure.directoryReplacementState, 'committed'); assert.equal(removals, 0);
    assert.equal(await fs.readFile(path.join(final, 'value'), 'utf8'), 'new');
    assert.equal(await fs.readFile(path.join(backup, 'foreign'), 'utf8'), 'foreign');
    assert.equal(await fs.readFile(path.join(saved, 'value'), 'utf8'), 'old');
  }
  {
    const { directory, source, final } = await fixture(); const marker = path.join(directory, 'not-a-directory');
    await fs.writeFile(marker, 'negative parent identity'); let closes = 0, allowClose = false, renames = 0, removals = 0;
    const closeFailure = Object.freeze(new Error('independent original parent close failed'));
    fs.open = async (file, ...args) => {
      if (file !== directory) return open(file, ...args);
      const handle = await open(marker, 'r'), close = handle.close; disposal.set(handle, () => close.call(handle));
      handle.close = async function () {
        assert.equal(this, handle); closes++; if (!allowClose) throw closeFailure;
        const result = await close.call(handle); disposal.delete(handle); return result;
      };
      return handle;
    };
    fs.rename = async (...args) => { renames++; return rename(...args); }; fs.rm = async (...args) => { removals++; return remove(...args); };
    const failure = await rejected(() => replaceDir(source, final)); const session = getContainedFileSession(failure); assert.ok(session);
    assert.equal(failure.directoryReplacementState, 'committed'); assert.equal(contains(failure, closeFailure), true);
    assert.equal(closes, 1); assert.equal(removals, 0); assert.equal(renames, 2);
    assert.equal(await fs.readFile(path.join(final, 'value'), 'utf8'), 'new');
    const [backup] = await names(directory); assert.equal(await fs.readFile(path.join(backup, 'value'), 'utf8'), 'old');
    allowClose = true; await session.releaseAfterClose(); assert.equal(closes, 2); assert.equal(renames, 2); assert.equal(removals, 0);
  }
  {
    const { source, final } = await fixture(); let ready = true, restores = 0;
    const primary = Object.assign(new Error('original observer changes during rollback lookup'), { code: 'EXDEV', cacheOwnershipReleased() { return ready; } });
    fs.rename = async (from, to) => {
      if (from === source && to === final) throw primary;
      if (to === final) restores++; return rename(from, to);
    };
    fs.lstat = async (file, ...args) => {
      try { return await lstat(file, ...args); }
      catch (error) { if (file === final) ready = false; throw error; }
    };
    const failure = await rejected(() => replaceDir(source, final, { allowCopyFallback: false }));
    assert.equal(restores, 0); assert.equal(failure.cacheOwnershipReleased(), false);
    primary.cacheOwnershipReleased = () => true; assert.equal(failure.cacheOwnershipReleased(), false);
    ready = true; assert.equal(failure.cacheOwnershipReleased(), true); assert.equal(restores, 0);
  }
  {
    const { source } = await fixture(); const nested = path.join(source, 'nested');
    await assert.rejects(replaceDir(source, nested), { code: 'EINVAL' });
    assert.equal(await fs.readFile(path.join(source, 'value'), 'utf8'), 'new');
  }
} finally {
  restore(); for (const close of disposal.values()) { try { await close(); } catch {} }
  await rmDirRecursive(root);
}
