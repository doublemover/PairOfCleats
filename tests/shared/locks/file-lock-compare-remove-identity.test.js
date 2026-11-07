import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createLockPayload, readLockRecord, readLockInfo, removeLockFileSyncIfOwned } from '../../../src/shared/locks/file-lock-info.js';
import { removeLockFileIfOwned } from '../../../src/shared/locks/file-lock-owner.js';
import { removeStaleLockFile } from '../../../src/shared/locks/file-lock-stale.js';
import { acquireFileLock } from '../../../src/shared/locks/file-lock.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';

// UNVALIDATED: real metadata bytes, actual descriptors, exact replacement races.
const root = await makeTempDir('poc-lock-compare-remove-'), file = path.join(root, 'metadata.lock');
const saved = path.join(root, 'saved.lock'), payload = createLockPayload({ scope: 'compare-remove' });
const contents = JSON.stringify(payload);
const open = fsp.open, remove = fsp.rm, closeSync = fs.closeSync, openSync = fs.openSync, removeSync = fs.rmSync;
const rejected = async action => {
  let failed = false, failure;
  try { await action(); } catch (value) { failed = true; failure = value; }
  assert.equal(failed, true); return failure;
};
const restore = () => { fsp.open = open; fsp.rm = remove; fs.openSync = openSync; fs.closeSync = closeSync; fs.rmSync = removeSync; };
try {
  await fsp.writeFile(file, contents);
  assert.equal(await removeLockFileIfOwned(file, { lockId: 'wrong' }), false);
  assert.equal(await removeLockFileIfOwned(file, payload), true);
  await fsp.writeFile(file, contents); assert.equal(removeLockFileSyncIfOwned(file, payload), true);
  for (const force of [false, true]) {
    for (const rewrite of [false, true]) {
      await fsp.writeFile(file, contents); let closed = false, removals = 0;
      fsp.open = async (name, ...args) => {
        const actual = await open(name, ...args); if (name !== file) return actual;
        const close = actual.close;
        actual.close = async function () {
          const result = await close.call(actual);
          if (!closed) {
            closed = true;
            if (rewrite) await fsp.writeFile(file, JSON.stringify({ ...payload, concurrent: 'changed same object' }));
            else { await fsp.rename(file, saved); await fsp.writeFile(file, contents, { flag: 'wx' }); }
          }
          return result;
        };
        return actual;
      };
      fsp.rm = async (name, ...args) => { if (name === file) removals += 1; return remove(name, ...args); };
      assert.equal(await removeLockFileIfOwned(file, payload, { force }), false);
      assert.equal(removals, 0); assert.equal(closed, true); assert.equal((await fsp.stat(file)).isFile(), true);
      if (!rewrite) assert.equal(await fsp.readFile(saved, 'utf8'), contents);
      restore(); await fsp.unlink(file); if (!rewrite) await fsp.unlink(saved);
    }
  }
  for (const force of [false, true]) {
    await fsp.writeFile(file, contents); let descriptor = null, replaced = false, removals = 0;
    fs.openSync = (name, ...args) => { const fd = openSync(name, ...args); if (name === file) descriptor = fd; return fd; };
    fs.closeSync = fd => {
      const result = closeSync(fd);
      if (fd === descriptor && !replaced) {
        replaced = true; fs.renameSync(file, saved); fs.writeFileSync(file, contents, { flag: 'wx' });
      }
      return result;
    };
    fs.rmSync = (name, ...args) => { if (name === file) removals += 1; return removeSync(name, ...args); };
    assert.equal(removeLockFileSyncIfOwned(file, payload, { force }), false);
    assert.equal(removals, 0); assert.equal(await fsp.readFile(file, 'utf8'), contents);
    assert.equal(await fsp.readFile(saved, 'utf8'), contents); restore(); await fsp.unlink(file); await fsp.unlink(saved);
  }
  for (const original of ['{corrupt', contents]) {
    await fsp.writeFile(file, original); const baseline = await readLockRecord(file);
    await fsp.rename(file, saved);
    await fsp.writeFile(file, original === contents ? contents : JSON.stringify(createLockPayload({ fresh: true })), { flag: 'wx' });
    let removals = 0;
    fsp.rm = async (name, ...args) => { if (name === file) removals += 1; return remove(name, ...args); };
    assert.equal((await removeStaleLockFile({ lockPath: file, info: baseline.value, staleMs: 1, expectedIdentity: baseline.identity })).removed, false);
    assert.equal(removals, 0); restore(); await fsp.unlink(file); await fsp.unlink(saved);
  }
  {
    await fsp.writeFile(file, '{corrupt'); const old = new Date(Date.now() - 60000); await fsp.utimes(file, old, old);
    let decisions = 0, removals = 0;
    fsp.rm = async (name, ...args) => { if (name === file) removals += 1; return remove(name, ...args); };
    const held = await acquireFileLock({ lockPath: file, waitMs: 0, staleMs: 1000, staleRemovalImpl: async input => {
      decisions += 1; assert.equal(Object.isFrozen(input.expectedIdentity), true);
      await fsp.rename(file, saved); await fsp.writeFile(file, JSON.stringify(createLockPayload({ fresh: true })), { flag: 'wx' });
      return removeStaleLockFile(input);
    } });
    assert.equal(held, null); assert.equal(decisions, 1); assert.equal(removals, 0);
    assert.equal((await readLockInfo(file)).fresh, true); restore(); await fsp.unlink(file); await fsp.unlink(saved);
  }
  {
    await fsp.writeFile(file, contents); let removals = 0;
    const primary = Object.freeze(Object.assign(new Error('metadata is unreadable, not corrupt'), { code: 'EACCES' }));
    fsp.open = async (name, ...args) => { if (name === file) throw primary; return open(name, ...args); };
    fsp.rm = async (name, ...args) => { if (name === file) removals += 1; return remove(name, ...args); };
    assert.equal(await readLockInfo(file), null, 'ordinary diagnostic compatibility remains');
    assert.equal(await removeLockFileIfOwned(file, null, { force: true }), false); assert.equal(removals, 0);
    assert.equal(await rejected(() => removeLockFileIfOwned(file, null, { force: true, swallowErrors: false })), primary);
    assert.equal(removals, 0); restore(); await fsp.unlink(file);
  }
  {
    await fsp.writeFile(file, '{corrupt'); assert.equal(await removeLockFileIfOwned(file, null, { force: true }), true);
    await fsp.writeFile(file, JSON.stringify(createLockPayload({ resourceSettlementVersion: 1 })));
    assert.equal(await removeLockFileIfOwned(file, null, { force: true }), false);
    assert.equal(removeLockFileSyncIfOwned(file, null, { force: true }), false); await fsp.unlink(file);
  }
  {
    await fsp.writeFile(file, contents); let attempts = 0;
    fsp.rm = async (name, ...args) => { if (name === file) { attempts += 1; return false; } return remove(name, ...args); };
    const failure = await rejected(() => removeLockFileIfOwned(file, payload));
    assert.equal(failure.cacheOwnershipPending, true); assert.equal(failure.cacheOwnershipReleased(), false);
    assert.equal(attempts, 1); assert.equal((await fsp.stat(file)).isFile(), true); restore(); await fsp.unlink(file);
  }
} finally { restore(); await rmDirRecursive(root); }
