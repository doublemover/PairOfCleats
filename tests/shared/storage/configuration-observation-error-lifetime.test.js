import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { resolveStorageLayout } from '../../../src/shared/storage/layout.js';
import { planStorageConfiguration, applyStorageConfiguration } from '../../../src/shared/storage/configuration.js';
import { readStorageLocator } from '../../../src/shared/storage/locator-read.js';
import { addStorageFailureContext } from '../../../src/shared/storage/operation-error.js';
import { getStorageDirectorySession } from '../../../src/shared/storage/directory.js';

const contains = (error, expected) => {
  const pending = [error], seen = new Set();
  while (pending.length) {
    const current = pending.pop(); if (current === expected) return true;
    if (!current || typeof current !== 'object' || seen.has(current)) continue;
    seen.add(current); pending.push(current.cause, ...(Array.isArray(current.errors) ? current.errors : []));
  }
  return false;
};

// UNVALIDATED: actual configuration/directory/lock owners, no user storage.
const temporary = await makeTempDir('poc-config-observation-failure-');
try {
  let closed = false;
  const receiverPrimary = Object.freeze(Object.assign(new Error('frozen context-only primary'), {
    cacheOwnershipPending: true, cacheOwnershipReleased() { return this === receiverPrimary && closed; }
  }));
  const contextual = addStorageFailureContext(receiverPrimary, { recovery: { sourcePreserved: true } });
  assert.equal(contextual.cause, receiverPrimary);
  assert.equal(contextual.cacheOwnershipReleased(), false);
  closed = true;
  assert.equal(contextual.cacheOwnershipReleased(), true, 'context-only composition must call the original observer on its original receiver');
  for (const cacheOwnershipReleased of [undefined, () => { throw new Error('unknown primary owner'); }]) {
    const unknown = Object.freeze(Object.assign(new Error('frozen unknown context-only primary'), {
      cacheOwnershipPending: true, ...(cacheOwnershipReleased ? { cacheOwnershipReleased } : {})
    }));
    assert.equal(addStorageFailureContext(unknown, { recovery: { sourcePreserved: true } }).cacheOwnershipReleased(), false);
  }
  const home = path.join(temporary, 'home');
  const source = path.join(home, 'empty-models');
  const destination = path.join(temporary, 'destination');
  await fs.mkdir(source, { recursive: true });
  await fs.mkdir(destination);
  const plan = await planStorageConfiguration({ layout: resolveStorageLayout({ home, env: {} }), category: 'models', currentPath: source, target: destination });
  assert.equal(plan.ready, true);
  const primary = Object.freeze(Object.assign(new Error('frozen source observation failed'), { code: 'EIO' }));
  const secondary = Object.freeze(Object.assign(new Error('destination close diagnostic failed'), { code: 'EACCES' }));
  const lockPath = path.join(home, 'config', 'storage-locator.lock');
  const lstat = fs.lstat, opendir = fs.opendir, remove = fs.rm;
  let announce, permit, completed = false, denyRelease = true, denyClose = true;
  const closing = new Promise(resolve => { announce = resolve; });
  const permitted = new Promise(resolve => { permit = resolve; });
  let failure;
  try {
    fs.lstat = async (target, ...args) => { if (target === source) throw primary; return lstat(target, ...args); };
    fs.opendir = async (target, ...args) => {
      const directory = await opendir(target, ...args);
      if (target !== destination) return directory;
      return { read: directory.read.bind(directory), close: async () => {
        announce(); await permitted;
        if (denyClose) throw secondary;
        await directory.close();
      } };
    };
    fs.rm = async (target, options) => {
      if (denyRelease && target === lockPath) throw Object.assign(new Error('fixture operation lock removal denied'), { code: 'EPERM' });
      return remove(target, options);
    };
    const running = applyStorageConfiguration(plan, { approvedPlanId: plan.planId, home, category: 'models', target: destination })
      .catch(error => { failure = error; }).finally(() => { completed = true; });
    await closing;
    assert.equal(completed, false, 'a rejected source observation cannot abandon the independently owned destination directory');
    assert.equal((await lstat(lockPath)).isFile(), true, 'configuration keeps its coordinator through every observation close');
    permit();
    await running;
    const pending = [failure], seen = new Set();
    while (pending.length) { const error = pending.pop(); if (!error || seen.has(error)) continue; seen.add(error);
      pending.push(error.cause, ...(Array.isArray(error.errors) ? error.errors : [])); }
    assert.equal(seen.has(primary), true);
    assert.equal(seen.has(secondary), true);
    assert.equal(failure.code, 'EIO');
    assert.equal(failure.storageOperationLocks.length, 1);
    assert.equal(failure.storageOperationLocks[0].lockPath, lockPath);
    assert.equal(Object.keys(failure).includes('storageOperationLocks'), false, 'actual metadata capabilities are not serialized diagnostic data');
    assert.equal(readStorageLocator(home).status, 'missing');
    denyRelease = false;
    await assert.rejects(failure.storageOperationLocks[0].release(), /Original published lock work prohibits metadata release/,
      'metadata recovery cannot replace the original unresolved directory close');
    const directorySession = [...seen].map(getStorageDirectorySession).find(Boolean);
    assert.ok(directorySession);
    denyClose = false;
    await directorySession.releaseAfterClose();
    assert.equal(await failure.storageOperationLocks[0].release(), true, 'only the original metadata lock capability can retry its failed cleanup');
    await assert.rejects(lstat(lockPath), { code: 'ENOENT' });
    assert.deepEqual(await fs.readdir(source), []);
    assert.deepEqual(await fs.readdir(destination), []);
  } finally { permit(); fs.lstat = lstat; fs.opendir = opendir; fs.rm = remove; }
  const readFailure = Object.freeze(Object.assign(new Error('frozen directory read failed'), { code: 'EIO' }));
  const closeFailure = Object.freeze(Object.assign(new Error('frozen directory close failed'), { code: 'ENOENT' }));
  try {
    fs.opendir = async (target, ...args) => {
      const directory = await opendir(target, ...args);
      if (target !== destination) return directory;
      return { read: async () => { throw readFailure; }, close: async () => { await directory.close(); throw closeFailure; } };
    };
    await assert.rejects(planStorageConfiguration({ layout: resolveStorageLayout({ home, env: {} }),
      category: 'models', currentPath: source, target: destination }), error => contains(error, readFailure)
        && contains(error, closeFailure) && error.code === 'EIO' && Boolean(getStorageDirectorySession(error)),
    'an observed directory read/close failure retains both originals rather than becoming a missing-directory preview');
  } finally { fs.opendir = opendir; }
} finally { await rmDirRecursive(temporary); }
console.log('Configuration drains independent observations and preserves frozen primary/cleanup failures.');
