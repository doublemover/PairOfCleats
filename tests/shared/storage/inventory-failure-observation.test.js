import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { CACHE_OWNER_FILE } from '../../../src/shared/cache-deletion.js';
import { classifyStorageRootFailure, inspectStorageRootFailure, observeStorageVolume } from '../../../src/shared/storage/root-availability.js';
import { inspectStorageInventory, inspectStorageOwnership } from '../../../src/shared/storage/inventory.js';
import { inspectStorageLayout } from '../../../src/shared/storage/operator.js';
import { isStorageObservationFailure } from '../../../src/shared/storage/failure-observation.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';

// UNVALIDATED: disposable actual root/inventory/ownership owners, no native run.
const caught = action => {
  let failed = false, error;
  try { action(); } catch (value) { failed = true; error = value; }
  assert.equal(failed, true); return error;
};
const rejected = async action => {
  let failed = false, error;
  try { await action(); } catch (value) { failed = true; error = value; }
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
const root = await makeTempDir('poc-inventory-failure-observation-'), originalStat = fs.lstat, originalOpen = fs.open;
try {
  const measured = path.join(root, 'measured'), later = path.join(root, 'later');
  const volume = path.parse(measured).root;
  await fs.mkdir(measured); await fs.mkdir(later);
  const file = path.join(measured, 'inert-data'); await fs.writeFile(file, 'alpha');
  const inputs = [{ id: 'measured', category: 'cache', path: measured }, { id: 'later', category: 'cache', path: later }];
  const layout = { descriptors: { cache: { category: 'cache', path: measured, retention: 'derived' } } };
  const baseline = await inspectStorageInventory({ roots: inputs, includeFiles: true });
  assert.equal(baseline.complete, true); assert.equal(baseline.items[0].logicalBytes, 5);
  assert.equal(baseline.items[0].ownership.deletionAuthority, false);
  assert.equal((await inspectStorageLayout(layout)).items[0].status, 'present-unscanned');
  for (const value of [undefined, null, false, 0, '']) {
    fs.lstat = async (target, ...args) => { if (target === measured) throw value; return originalStat(target, ...args); };
    const report = await inspectStorageInventory({ roots: inputs });
    assert.equal(report.complete, false); assert.equal(report.items[0].status, 'inaccessible');
    assert.equal(report.items[0].errors[0].code, 'ERR_STORAGE_SCAN');
    assert.equal(report.items[0].errors[0].message, String(value));
    assert.equal(report.totals.logicalAttributedBytes, null);
    const metadata = await inspectStorageLayout(layout);
    assert.equal(metadata.items[0].error.code, 'ERR_STORAGE_INSPECTION');
    assert.equal(metadata.items[0].complete, false);
    fs.lstat = async (target, ...args) => { if (target === volume) throw value; return originalStat(target, ...args); };
    const unavailable = await observeStorageVolume(measured);
    assert.equal(unavailable.status, 'unavailable-or-offline');
    assert.equal(unavailable.error.code, 'ERR_STORAGE_ROOT_AVAILABILITY');
  }
  fs.lstat = originalStat;
  for (const marker of [undefined, false, true]) {
    for (const consume of [() => inspectStorageInventory({ roots: inputs }), () => inspectStorageLayout(layout)]) {
      let settled = false, volumeReads = 0, laterReads = 0, codeReads = 0;
      const primary = Object.defineProperties(new Error('original registered-root observation'), {
        ...(marker === undefined ? {} : { cacheOwnershipPending: { value: marker } }),
        cacheOwnershipReleased: { value() { assert.equal(this, primary); return settled; }, writable: true },
        code: { get() { codeReads += 1; return 'ENOENT'; } }
      });
      fs.lstat = async (target, ...args) => {
        if (target === measured) throw primary;
        if (target === volume) volumeReads += 1;
        if (target === later) laterReads += 1;
        return originalStat(target, ...args);
      };
      const failure = await rejected(consume);
      assert.equal(contains(failure, primary), true); assert.equal(isStorageObservationFailure(failure), true);
      assert.equal(codeReads, 0); assert.equal(volumeReads, 0); assert.equal(laterReads, 0);
      primary.cacheOwnershipReleased = () => true;
      assert.equal(failure.cacheOwnershipReleased(), false); settled = true;
      assert.equal(failure.cacheOwnershipReleased(), true);
    }
  }
  fs.lstat = originalStat;
  for (const phase of ['entry', 'revalidation']) {
    let settled = false, rootReads = 0, entryReads = 0;
    const primary = Object.freeze(Object.assign(new Error(`original ${phase} stat observation`), {
      cacheOwnershipReleased() { assert.equal(this, primary); return settled; }
    }));
    fs.lstat = async (target, ...args) => {
      if (target === measured) {
        rootReads += 1;
        if (phase === 'revalidation' && rootReads === 3) throw primary;
      }
      if (target === file && phase === 'entry') { entryReads += 1; throw primary; }
      return originalStat(target, ...args);
    };
    const failure = await rejected(() => inspectStorageInventory({ roots: inputs }));
    assert.equal(contains(failure, primary), true); assert.equal(failure.cacheOwnershipReleased(), false);
    assert.equal(phase === 'entry' ? entryReads : rootReads, phase === 'entry' ? 1 : 3);
    settled = true; assert.equal(failure.cacheOwnershipReleased(), true);
  }
  fs.lstat = originalStat;
  {
    let settled = true, codeReads = 0;
    const primary = Object.defineProperties(new Error('missing root awaits independent volume'), {
      code: { get() { codeReads += 1; return 'ENOENT'; } },
      cacheOwnershipReleased: { value() { assert.equal(this, primary); return settled; }, writable: true }
    });
    fs.lstat = async (target, ...args) => {
      if (target === volume) { settled = false; primary.cacheOwnershipReleased = () => true; }
      return originalStat(target, ...args);
    };
    const failure = await rejected(() => inspectStorageRootFailure(measured, primary));
    assert.equal(failure.cacheOwnershipReleased(), false); assert.equal(codeReads, 1);
    settled = true; assert.equal(failure.cacheOwnershipReleased(), true);
  }
  fs.lstat = originalStat;
  {
    let volumeSettled = false, rootSettled = true;
    const absent = Object.freeze(Object.assign(new Error('ordinary missing root'), { code: 'ENOENT',
      cacheOwnershipReleased() { assert.equal(this, absent); return rootSettled; } }));
    const secondary = Object.assign(new Error('original volume observation owns native work'), {
      cacheOwnershipReleased() { assert.equal(this, secondary); return volumeSettled; }
    });
    fs.lstat = async (target, ...args) => { if (target === volume) throw secondary; return originalStat(target, ...args); };
    const failure = await rejected(() => inspectStorageRootFailure(measured, absent));
    assert.equal(contains(failure, absent), true); assert.equal(contains(failure, secondary), true);
    secondary.cacheOwnershipReleased = () => true;
    assert.equal(failure.cacheOwnershipReleased(), false); volumeSettled = true;
    assert.equal(failure.cacheOwnershipReleased(), true); rootSettled = false;
    assert.equal(failure.cacheOwnershipReleased(), false);
  }
  fs.lstat = originalStat;
  for (const value of [undefined, null, false, 0, '']) {
    const absent = Object.freeze(Object.assign(new Error('classification primary'), { code: 'ENOENT' }));
    const failure = caught(() => classifyStorageRootFailure(absent, Object.defineProperty({}, 'status', {
      get() { throw value; }
    })));
    assert.equal(failure.cause, absent); assert.equal(failure.errors[1].cause, value);
    assert.equal(Object.hasOwn(failure.errors[1], 'cause'), true);
  }
  const marker = path.join(measured, CACHE_OWNER_FILE);
  await fs.writeFile(marker, JSON.stringify({ owner: 'pairofcleats', layoutVersion: 1 }));
  const markerBytes = await fs.readFile(marker);
  assert.equal((await inspectStorageOwnership(measured)).status, 'marked');
  for (const value of [undefined, null, false, 0, '']) {
    fs.open = async (target, ...args) => { if (target === marker) throw value; return originalOpen(target, ...args); };
    const report = await inspectStorageOwnership(measured);
    assert.equal(report.status, 'unreadable'); assert.equal(report.error.code, 'ERR_STORAGE_SCAN');
    assert.equal(report.deletionAuthority, false);
  }
  {
    let settled = false;
    const primary = Object.assign(new Error('original marker observation'), {
      code: 'ENOENT', cacheOwnershipReleased() { assert.equal(this, primary); return settled; }
    });
    fs.open = async (target, ...args) => { if (target === marker) throw primary; return originalOpen(target, ...args); };
    const failure = await rejected(() => inspectStorageOwnership(measured));
    assert.equal(failure.cause, primary); primary.cacheOwnershipReleased = () => true;
    assert.equal(failure.cacheOwnershipReleased(), false); settled = true;
    assert.equal(failure.cacheOwnershipReleased(), true);
  }
  fs.open = originalOpen;
  assert.deepEqual(await fs.readFile(marker), markerBytes); assert.equal(await fs.readFile(file, 'utf8'), 'alpha');
  assert.equal((await inspectStorageInventory({ roots: inputs })).complete, true);
} finally { fs.lstat = originalStat; fs.open = originalOpen; await rmDirRecursive(root); }
console.log('inventory-failure-observation passed');
