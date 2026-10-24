import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { assertSafeCacheDeletion, CACHE_OWNER_FILE } from '../../../src/shared/cache-deletion.js';
import { getContainedFileSession } from '../../../src/shared/contained-file.js';
import { createStorageMigrationPlan, storageMigrationOwnerProof } from '../../../src/shared/storage/migration-plan.js';
import { readStorageFailureContext } from '../../../src/shared/storage/operation-error.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';

// UNVALIDATED: actual disposable authority/descriptor/plan consumers. No migration apply.
const caught = action => {
  let failed = false, failure;
  try { action(); } catch (error) { failed = true; failure = error; }
  assert.equal(failed, true); return failure;
};
const rejected = async action => {
  let failed = false, failure;
  try { await action(); } catch (error) { failed = true; failure = error; }
  assert.equal(failed, true); return failure;
};
const contains = (failure, expected) => {
  const queue = [failure], seen = new Set();
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
    queue.push(...(readStorageFailureContext(current)?.inspectionErrors || []));
  }
  return false;
};
const pending = marker => {
  const state = { ready: false, codeReads: 0 };
  const error = Object.defineProperties(new Error('original fixture resource'), {
    ...(marker === undefined ? {} : { cacheOwnershipPending: { value: marker } }),
    cacheOwnershipReleased: { value() { assert.equal(this, error); return state.ready; }, writable: true },
    code: { get() { state.codeReads++; return 'ENOENT'; } }
  });
  return { state, error };
};
const root = await makeTempDir('poc-migration-marker-outcomes-');
const originals = { openSync: fs.openSync, readSync: fs.readSync, closeSync: fs.closeSync,
  open: fsp.open, opendir: fsp.opendir };
const retained = new Set();
const restore = () => { fs.openSync = originals.openSync; fs.readSync = originals.readSync;
  fs.closeSync = originals.closeSync; fsp.open = originals.open; fsp.opendir = originals.opendir; };
try {
  const home = path.join(root, 'home'), source = path.join(home, 'source');
  await fsp.mkdir(source, { recursive: true });
  const marker = path.join(home, CACHE_OWNER_FILE), data = path.join(source, 'fixture.bin');
  const markerText = JSON.stringify({ owner: 'pairofcleats', layoutVersion: 1 });
  await fsp.writeFile(marker, markerText); await fsp.writeFile(data, 'source bytes');
  let ownerCalls = 0;
  const receipt = () => ({ complete: true, quiescent: true, referencesPortable: true,
    permissionsCompatible: true, identity: 'fixture-owner-v1' });
  const owner = { id: 'fixture-copy-owner', version: 1,
    inspect: async function () { assert.equal(this, owner); ownerCalls++; return receipt(); },
    verifyDestination: async () => true };
  const input = { category: 'models', source, home, destination: path.join(home, 'destination'),
    recoveryRoot: path.join(home, 'recovery'), authorityRoots: [home], owner,
    coordinationRoot: path.join(home, 'state', 'storage-access') };
  assert.equal(assertSafeCacheDeletion(source, [home]), source);
  assert.equal((await createStorageMigrationPlan(input)).ready, true);
  for (const text of ['{', 'null', JSON.stringify({ owner: 'someone-else', layoutVersion: 1 }), ' '.repeat(65537)]) {
    await fsp.writeFile(marker, text);
    assert.match(caught(() => assertSafeCacheDeletion(source, [home])).message, /outside user-authorized/u);
  }
  await fsp.unlink(marker);
  assert.match(caught(() => assertSafeCacheDeletion(source, [home])).message, /outside user-authorized/u);
  assert.equal(assertSafeCacheDeletion(source, [home], { allowUnmarked: true }), source);
  await fsp.writeFile(marker, markerText);

  for (const flag of [undefined, false, true]) {
    const { error, state } = pending(flag); let attempts = 0;
    fs.openSync = (target, ...args) => {
      if (target === marker) { attempts++; throw error; } return originals.openSync(target, ...args);
    };
    const failure = caught(() => assertSafeCacheDeletion(source, [home, home]));
    assert.equal(contains(failure, error), true); assert.equal(attempts, 1); assert.equal(state.codeReads, 0);
    error.cacheOwnershipReleased = () => true; assert.equal(failure.cacheOwnershipReleased(), false);
    state.ready = true; assert.equal(failure.cacheOwnershipReleased(), true); restore();
  }
  for (const primitive of [undefined, null, false, 0, '']) {
    fs.openSync = (target, ...args) => { if (target === marker) throw primitive; return originals.openSync(target, ...args); };
    assert.match(caught(() => assertSafeCacheDeletion(source, [home])).message, /outside user-authorized/u); restore();
    const proof = await storageMigrationOwnerProof({ ...owner, inspect: async () => { throw primitive; } }, {});
    assert.equal(proof.complete, false); assert.equal(proof.error.code, 'ERR_STORAGE_CATEGORY_INSPECTION');
    assert.equal(proof.error.message, String(primitive));
  }
  for (const field of ['code', 'message']) {
    const secondary = pending(false), primary = Object.freeze(Object.defineProperty(new Error('failed owner metadata'), field,
      { get() { throw secondary.error; } }));
    const failure = await rejected(() => storageMigrationOwnerProof({ ...owner, inspect: async () => { throw primary; } }, {}));
    assert.equal(contains(failure, primary), true); assert.equal(contains(failure, secondary.error), true);
    secondary.error.cacheOwnershipReleased = () => true; assert.equal(failure.cacheOwnershipReleased(), false);
    secondary.state.ready = true; assert.equal(failure.cacheOwnershipReleased(), true);
  }
  {
    const primary = Object.freeze(Object.defineProperty(new Error('unreadable marker lifecycle'), 'cacheOwnershipReleased',
      { get() { throw false; } }));
    fs.openSync = (target, ...args) => { if (target === marker) throw primary; return originals.openSync(target, ...args); };
    const failure = caught(() => assertSafeCacheDeletion(source, [home]));
    assert.equal(contains(failure, primary), true); assert.equal(contains(failure, false), true);
    assert.equal(failure.cacheOwnershipReleased(), false); restore();
  }

  for (const mode of ['read', 'close']) {
    let fd, reads = 0, closes = 0;
    const primary = mode === 'read' ? pending(undefined) : { error: Object.freeze(new Error('actual marker close failed')) };
    fs.openSync = (target, ...args) => {
      const opened = originals.openSync(target, ...args); if (target === marker) { fd = opened; retained.add(fd); } return opened;
    };
    fs.readSync = (opened, ...args) => { if (opened === fd) { reads++; if (mode === 'read') throw primary.error; }
      return originals.readSync(opened, ...args); };
    fs.closeSync = opened => {
      if (opened === fd) { closes++; if (mode === 'close') throw primary.error; retained.delete(opened); }
      return originals.closeSync(opened);
    };
    const failure = caught(() => assertSafeCacheDeletion(source, [home]));
    const session = getContainedFileSession(failure); assert.ok(session); assert.equal(contains(failure, primary.error), true);
    assert.equal(closes, mode === 'read' ? 0 : 1); assert.equal(reads, 1);
    if (mode === 'read') {
      primary.error.cacheOwnershipReleased = () => true;
      await rejected(() => session.releaseAfterClose()); assert.equal(closes, 0);
      primary.state.ready = true; await session.releaseAfterClose(); assert.equal(closes, 1);
      assert.equal(failure.cacheOwnershipReleased(), true);
    } else {
      await rejected(() => session.releaseAfterClose()); assert.equal(closes, 1);
      assert.equal(failure.cacheOwnershipReleased(), false);
    }
    assert.equal(reads, 1, 'explicit descriptor recovery never rereads or reparses authority'); restore();
  }

  for (const location of ['owner', 'authority', 'manifest']) {
    const { error, state } = pending(false); let sourceScans = 0; const previousCalls = ownerCalls;
    fsp.opendir = async (target, ...args) => { if (target === source) sourceScans++;
      if (location === 'manifest' && target === source) throw error;
      return originals.opendir(target, ...args); };
    fsp.open = async (target, ...args) => { if (location === 'authority' && target === marker) throw error;
      return originals.open(target, ...args); };
    const selectedOwner = location === 'owner' ? { ...owner, inspect: async () => { throw error; } } : owner;
    const failure = await rejected(() => createStorageMigrationPlan({ ...input, owner: selectedOwner }));
    assert.equal(contains(failure, error), true); assert.equal(state.codeReads, 0);
    if (location !== 'manifest') assert.equal(sourceScans, 0, 'no source manifest scan follows unsettled authority or category ownership');
    if (location === 'authority') assert.equal(ownerCalls, previousCalls);
    error.cacheOwnershipReleased = () => true; assert.equal(failure.cacheOwnershipReleased(), false);
    state.ready = true; assert.equal(failure.cacheOwnershipReleased(), true); restore();
  }
  {
    const original = pending(undefined); let fieldReads = 0;
    const value = Object.defineProperties(receipt(), {
      cacheOwnershipReleased: { value: original.error.cacheOwnershipReleased.bind(original.error), writable: true },
      quiescent: { get() { fieldReads++; return true; } }
    });
    const failure = await rejected(() => storageMigrationOwnerProof({ ...owner, inspect: async () => value }, {}));
    assert.equal(fieldReads, 0); value.cacheOwnershipReleased = () => true;
    assert.equal(failure.cacheOwnershipReleased(), false); original.state.ready = true;
    assert.equal(failure.cacheOwnershipReleased(), true);
  }
  {
    let ready = true, inspections = 0;
    const value = Object.defineProperties(receipt(), {
      cacheOwnershipReleased: { value() { assert.equal(this, value); return ready; }, writable: true },
      identity: { get() { ready = false; value.cacheOwnershipReleased = () => true; return 'fixture-owner-v1'; } }
    });
    const selectedOwner = Object.defineProperty({ ...owner }, 'inspect', {
      get() { inspections++; assert.equal(inspections, 1); return async function () { assert.equal(this, selectedOwner); return value; }; }
    });
    const failure = await rejected(() => storageMigrationOwnerProof(selectedOwner, {}));
    assert.equal(inspections, 1); assert.equal(failure.cacheOwnershipReleased(), false);
    ready = true; assert.equal(failure.cacheOwnershipReleased(), true);
  }
  assert.equal((await createStorageMigrationPlan(input)).ready, true);
  assert.equal(await fsp.readFile(data, 'utf8'), 'source bytes');
  for (const category of ['cache', 'repos', 'cas', 'state', 'config']) {
    await assert.rejects(createStorageMigrationPlan({ ...input, category }), /specific migration owner/u);
  }
} finally {
  restore();
  // Disposable fixture disposal is not a retry/settlement witness for a failed numeric close.
  for (const fd of retained) originals.closeSync(fd);
  await rmDirRecursive(root);
}
console.log('Storage marker and migration preview preserve original resource failures.');
