import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { planStorageConfiguration, applyStorageConfiguration } from '../../../src/shared/storage/configuration.js';
import { resolveStorageLayout } from '../../../src/shared/storage/layout.js';
import { readStorageLocator } from '../../../src/shared/storage/locator-read.js';
import { isStorageObservationFailure } from '../../../src/shared/storage/failure-observation.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';

// UNVALIDATED: actual configuration preview/apply and disposable metadata owners.
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
const root = await makeTempDir('poc-config-native-observation-');
const lstat = fs.lstat, mkdir = fs.mkdir, remove = fs.rm;
try {
  const home = path.join(root, 'home'), source = path.join(home, 'tmp');
  const parent = path.join(root, 'missing-parent'), target = path.join(parent, 'selected');
  await mkdir(source, { recursive: true });
  await mkdir(path.join(home, 'config'));
  const layout = resolveStorageLayout({ home, env: {} });
  const preview = () => planStorageConfiguration({ layout, category: 'tmp', target });
  const ordinary = await preview();
  assert.equal(ordinary.ready, true);
  assert.equal(ordinary.destinationObservation.status, 'missing');
  assert.equal(ordinary.destinationObservation.ancestor, root);
  assert.equal(ordinary.mutationPerformed, false);

  for (const failedPath of [target, parent]) {
    for (const marker of [undefined, false, true]) {
      let settled = false, codeReads = 0, parentProbes = 0;
      const primary = Object.defineProperties(new Error('original configuration observation still owns work'), {
        ...(marker === undefined ? {} : { cacheOwnershipPending: { value: marker } }),
        cacheOwnershipReleased: { value() { assert.equal(this, primary); return settled; }, writable: true },
        code: { get() { codeReads += 1; return 'ENOENT'; } }
      });
      fs.lstat = async (file, ...args) => {
        if (file === failedPath) throw primary;
        if (file === path.dirname(failedPath)) parentProbes += 1;
        return lstat(file, ...args);
      };
      const failure = await rejected(preview);
      assert.equal(contains(failure, primary), true);
      assert.equal(isStorageObservationFailure(failure), true);
      assert.equal(codeReads, 0, 'pending operation cannot authorize missing-directory classification');
      assert.equal(parentProbes, 0, 'unknown native work blocks traversal to the next ancestor');
      primary.cacheOwnershipReleased = () => true;
      assert.equal(failure.cacheOwnershipReleased(), false);
      settled = true; assert.equal(failure.cacheOwnershipReleased(), true);
      fs.lstat = lstat;
    }
  }

  for (const failedPath of [target, parent]) {
    for (const inspection of [undefined, null, false, 0, '', Object.freeze(new Error('readonly code inspection rejected'))]) {
      let reads = 0;
      const primary = Object.freeze(Object.defineProperty(new Error('original readonly directory diagnostic'), 'code', {
        get() { assert.equal(this, primary); reads += 1; throw inspection; }
      }));
      fs.lstat = async (file, ...args) => { if (file === failedPath) throw primary; return lstat(file, ...args); };
      const failure = await rejected(preview);
      assert.equal(contains(failure, primary), true); assert.equal(contains(failure, inspection), true);
      assert.equal(reads, 1); fs.lstat = lstat;
    }
  }

  let inspectionSettled = false;
  const inspection = Object.assign(new Error('independent diagnostic work remains pending'), {
    cacheOwnershipPending: false,
    cacheOwnershipReleased() { assert.equal(this, inspection); return inspectionSettled; }
  });
  const readonly = Object.freeze(Object.defineProperty(new Error('frozen missing-directory diagnostic'), 'code', {
    get() { throw inspection; }
  }));
  fs.lstat = async (file, ...args) => { if (file === target) throw readonly; return lstat(file, ...args); };
  const inspected = await rejected(preview);
  assert.equal(contains(inspected, readonly), true); assert.equal(contains(inspected, inspection), true);
  inspection.cacheOwnershipReleased = () => true;
  assert.equal(inspected.cacheOwnershipReleased(), false);
  inspectionSettled = true; assert.equal(inspected.cacheOwnershipReleased(), true);
  fs.lstat = lstat;

  // A previously confirmed original is checked again after the real ancestor
  // await. Replacing its property during that await cannot authorize a preview.
  for (const failedPath of [target, parent]) {
    let settled = true, codeReads = 0, ancestorReads = 0;
    const original = Object.defineProperties(new Error('captured original missing observation'), {
      cacheOwnershipPending: { value: false },
      cacheOwnershipReleased: { value() { assert.equal(this, original); return settled; }, writable: true },
      code: { get() { codeReads += 1; return 'ENOENT'; } }
    });
    fs.lstat = async (file, ...args) => {
      if (file === failedPath) throw original;
      const stat = await lstat(file, ...args);
      if (file === root) { ancestorReads += 1; settled = false; original.cacheOwnershipReleased = () => true; }
      return stat;
    };
    const failure = await rejected(preview);
    assert.equal(contains(failure, original), true);
    assert.equal(codeReads, 1); assert.equal(ancestorReads, 1);
    assert.equal(failure.cacheOwnershipReleased(), false);
    settled = true; assert.equal(failure.cacheOwnershipReleased(), true);
    fs.lstat = lstat;
  }

  let priorSettled = true;
  const prior = Object.assign(new Error('earlier missing-directory operation'), {
    code: 'ENOENT', cacheOwnershipPending: false,
    cacheOwnershipReleased() { assert.equal(this, prior); return priorSettled; }
  });
  const later = Object.freeze(Object.assign(new Error('different ancestor operation rejected'), { code: 'EACCES' }));
  fs.lstat = async (file, ...args) => {
    if (file === target) throw prior;
    if (file === parent) {
      await lstat(root, ...args); priorSettled = false; prior.cacheOwnershipReleased = () => true; throw later;
    }
    return lstat(file, ...args);
  };
  const laterFailure = await rejected(preview);
  assert.equal(contains(laterFailure, prior), true); assert.equal(contains(laterFailure, later), true);
  assert.equal(laterFailure.code, 'EACCES'); assert.equal(laterFailure.cacheOwnershipReleased(), false);
  priorSettled = true; assert.equal(laterFailure.cacheOwnershipReleased(), true);
  fs.lstat = lstat;

  // Real coordinator removal fails independently after a falsey apply failure.
  // Retrying its exact returned metadata handle must never replay publication.
  let sequence = 0;
  const exerciseApply = async (primary, cleanup, failCleanup) => {
    const selectedHome = path.join(root, `apply-${sequence++}`), selected = path.join(root, `selected-${sequence}`);
    await mkdir(path.join(selectedHome, 'tmp'), { recursive: true });
    await mkdir(path.join(selectedHome, 'config'));
    const selectedLayout = resolveStorageLayout({ home: selectedHome, env: {} });
    const plan = await planStorageConfiguration({ layout: selectedLayout, category: 'tmp', target: selected });
    const selections = path.join(selectedHome, 'config', 'storage-selections');
    const lockPath = path.join(selectedHome, 'config', 'storage-locator.lock');
    let publications = 0, removals = 0, deny = failCleanup, held;
    fs.mkdir = async (file, ...args) => {
      if (file === selections) { publications += 1; throw primary; }
      return mkdir(file, ...args);
    };
    fs.rm = async (file, ...args) => {
      if (file === lockPath) { removals += 1; if (deny) throw cleanup; }
      return remove(file, ...args);
    };
    try {
      const failure = await rejected(() => applyStorageConfiguration(plan, {
        approvedPlanId: plan.planId, home: selectedHome, category: 'tmp', target: selected
      }));
      assert.equal(contains(failure, primary), true); assert.equal(publications, 1); assert.equal(removals, 1);
      assert.equal(readStorageLocator(selectedHome).status, 'missing');
      if (failCleanup) {
        assert.equal(contains(failure, cleanup), true);
        assert.equal(failure.storageOperationLocks.length, 1);
        assert.equal(Object.getOwnPropertyDescriptor(failure, 'storageOperationLocks').enumerable, false);
        held = failure.storageOperationLocks[0]; assert.equal(held.lockPath, lockPath);
        deny = false; assert.equal(await held.release(), true);
        assert.equal(publications, 1); assert.equal(removals, 2);
      } else if (primary === null || !['object', 'function'].includes(typeof primary)) {
        assert.equal(Object.hasOwn(failure, 'cause'), true); assert.equal(failure.cause, primary);
      } else assert.equal(failure, primary);
      await assert.rejects(lstat(selected), { code: 'ENOENT' });
      await assert.rejects(lstat(lockPath), { code: 'ENOENT' });
    } finally {
      deny = false; if (held) await held.release();
      fs.mkdir = mkdir; fs.rm = remove;
    }
  };
  for (const primary of [undefined, null, false, 0, '']) {
    await exerciseApply(primary, Object.freeze(new Error('actual metadata removal rejected')), true);
    await exerciseApply(primary, undefined, false);
  }
  for (const cleanup of [undefined, null, false, 0, '']) {
    await exerciseApply(Object.freeze(Object.assign(new Error('original frozen apply failure'), { code: 'EORIGINAL' })), cleanup, true);
  }
  assert.equal((await preview()).ready, true);
  assert.equal(readStorageLocator(home).status, 'missing');
  await assert.rejects(lstat(target), { code: 'ENOENT' });
} finally {
  fs.lstat = lstat; fs.mkdir = mkdir; fs.rm = remove;
  await rmDirRecursive(root);
}
console.log('configuration-native-observation passed');
