import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { withTemporaryEnv } from '../../helpers/test-env.js';
import { createManagedCommandFixture } from '../../helpers/managed-command-fixture.js';
import { withStorageDirectory, getStorageDirectorySession, isStorageDirectorySession } from '../../../src/shared/storage/directory.js';
import { inspectStorageInventory } from '../../../src/shared/storage/inventory.js';
import { inspectManagedInstallation } from '../../../tools/tooling/managed-install.js';

// UNVALIDATED: actual disposable Dir owners, with inert read/close failures.
const temporary = await makeTempDir('poc-directory-resource-');
const opendir = fs.opendir;
const contains = (error, expected) => {
  const pending = [error], seen = new Set();
  while (pending.length) {
    const current = pending.pop();
    if (current === expected) return true;
    if (!current || typeof current !== 'object' || seen.has(current)) continue;
    seen.add(current);
    pending.push(current.cause, ...(Array.isArray(current.errors) ? current.errors : []));
  }
  return false;
};
try {
  const first = path.join(temporary, 'first'), second = path.join(temporary, 'second');
  await fs.mkdir(first); await fs.mkdir(second);
  await fs.writeFile(path.join(first, 'one'), 'one');
  await fs.writeFile(path.join(second, 'two'), 'two');
  const primary = Object.freeze(Object.assign(new Error('frozen directory read failed'), { code: 'EIO' }));
  const closeError = Object.freeze(Object.assign(new Error('frozen directory close failed'), { code: 'EACCES' }));
  let deny = true, replace = false, closeAttempts = 0, closeReads = 0, readReads = 0, wrapper;
  fs.opendir = async (target, ...args) => {
    const directory = await opendir(target, ...args);
    if (target !== first) return directory;
    wrapper = { get read() { readReads++; return async function () { assert.equal(this, wrapper); throw primary; }; },
      get close() {
        closeReads++;
        if (replace) return () => assert.fail('recovery cannot adopt replacement close authority');
        return async function () { assert.equal(this, wrapper); closeAttempts++; if (deny) throw closeError; await directory.close(); };
      } };
    return wrapper;
  };
  let failure;
  try { await withStorageDirectory(first, reader => reader.read()); } catch (error) { failure = error; }
  assert.equal(contains(failure, primary), true);
  assert.equal(contains(failure, closeError), true);
  assert.equal(failure.code, 'EIO');
  const held = getStorageDirectorySession(failure);
  assert.equal(isStorageDirectorySession(held), true);
  assert.equal(isStorageDirectorySession({ ...held }), false);
  assert.equal(getStorageDirectorySession({ storageDirectorySession: { ...held } }), null);
  assert.equal(Object.keys(failure).includes('storageDirectorySession'), false);
  assert.equal(held.isSettled(), false);
  replace = true; deny = false;
  assert.deepEqual(await Promise.all([held.releaseAfterClose(), held.releaseAfterClose()]), [
    { resourceId: held.resourceId, settled: true, pending: false }, { resourceId: held.resourceId, settled: true, pending: false }
  ]);
  assert.equal(closeAttempts, 2);
  assert.equal(closeReads, 1); assert.equal(readReads, 1);
  assert.equal(failure.cacheOwnershipReleased(), true);
  await held.releaseAfterClose();
  assert.equal(closeAttempts, 2, 'confirmed original close is not repeated');
  fs.opendir = opendir;

  let announce, permit, closeStarted = false, finished = false, savedReader;
  const reading = new Promise(resolve => { announce = resolve; });
  const permitted = new Promise(resolve => { permit = resolve; });
  fs.opendir = async (target, ...args) => {
    const directory = await opendir(target, ...args);
    return { read: async () => { announce(); await permitted; return directory.read(); },
      close: async () => { closeStarted = true; await directory.close(); } };
  };
  const running = withStorageDirectory(first, reader => { savedReader = reader; void reader.read(); return 'callback returned'; })
    .finally(() => { finished = true; });
  await reading;
  assert.equal(closeStarted, false, 'callback return cannot race an already-admitted real read');
  assert.equal(finished, false);
  permit();
  assert.equal(await running, 'callback returned');
  assert.equal(closeStarted, true);
  await assert.rejects(savedReader.read(), /scope has closed/);
  fs.opendir = opendir;

  for (const known of [true, false]) {
    let confirmed = false, nativeCloses = 0;
    const native = Object.freeze(Object.assign(new Error('original pending directory read owner'), { cacheOwnershipPending: true,
      ...(known ? { cacheOwnershipReleased() { return this === native && confirmed; } } : {}) }));
    fs.opendir = async (target, ...args) => {
      const directory = await opendir(target, ...args);
      return { read: async () => { throw native; }, close: async () => { nativeCloses++; await directory.close(); } };
    };
    let pending;
    try { await withStorageDirectory(first, reader => reader.read()); } catch (error) { pending = error; }
    assert.equal(contains(pending, native), true);
    const owner = getStorageDirectorySession(pending);
    assert.equal(owner.isSettled(), false, 'independent original evidence survives successful exact directory close');
    await assert.rejects(owner.releaseAfterClose(), error => error.cacheOwnershipReleased() === false);
    confirmed = true;
    if (known) {
      await owner.releaseAfterClose();
      assert.equal(pending.cacheOwnershipReleased(), true, 'the captured original observer retains its receiver');
    } else {
      await assert.rejects(owner.releaseAfterClose());
      assert.equal(pending.cacheOwnershipReleased(), false);
    }
    assert.equal(nativeCloses, 1);
    fs.opendir = opendir;
  }

  let denyInventory = true, secondOpened = false;
  fs.opendir = async (target, ...args) => {
    if (target === second) secondOpened = true;
    const directory = await opendir(target, ...args);
    if (target !== first) return directory;
    return { read: async () => { throw primary; }, close: async () => { if (denyInventory) throw closeError; await directory.close(); } };
  };
  let inventoryFailure;
  try { await inspectStorageInventory({ roots: [{ id: 'first', path: first }, { id: 'second', path: second }] }); }
  catch (error) { inventoryFailure = error; }
  assert.equal(contains(inventoryFailure, primary), true);
  assert.equal(contains(inventoryFailure, closeError), true);
  assert.equal(isStorageDirectorySession(getStorageDirectorySession(inventoryFailure)), true,
    'an actual unclosed directory cannot be flattened into ordinary incomplete accounting');
  assert.equal(secondOpened, false, 'inventory stops admitting roots while an actual directory owner remains pending');
  denyInventory = false;
  await inventoryFailure.storageDirectorySession.releaseAfterClose();
  fs.opendir = opendir;
  const inventory = await inspectStorageInventory({ roots: [{ id: 'first', path: first }, { id: 'second', path: second }] });
  assert.equal(inventory.complete, true);
  assert.equal(inventory.items.reduce((sum, item) => sum + item.filesCount, 0), 2);

  await withTemporaryEnv({ PAIROFCLEATS_HOME: path.join(temporary, 'home') }, async () => {
    const fixture = await createManagedCommandFixture(path.join(temporary, 'managed'));
    const root = path.dirname(path.dirname(fixture.command));
    let denied = true;
    fs.opendir = async (target, ...args) => {
      const directory = await opendir(target, ...args);
      if (target !== root) return directory;
      return { read: directory.read.bind(directory), close: async () => { if (denied) throw closeError; await directory.close(); } };
    };
    let inspectionFailure;
    try { await inspectManagedInstallation({ toolingRoot: fixture.toolingRoot, toolId: fixture.toolId }); }
    catch (error) { inspectionFailure = error; }
    assert.equal(isStorageDirectorySession(getStorageDirectorySession(inspectionFailure)), true,
      'actual managed generation inspection retains its exact directory close owner');
    denied = false;
    await inspectionFailure.storageDirectorySession.releaseAfterClose();
    fs.opendir = opendir;
    assert.equal((await inspectManagedInstallation({ toolingRoot: fixture.toolingRoot, toolId: fixture.toolId })).ok, true);
  });
} finally { fs.opendir = opendir; await rmDirRecursive(temporary); }
console.log('Storage directory lifetime preserves actual read and close ownership.');
