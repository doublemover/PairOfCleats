import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { applyStorageProbePolicy, planStorageProbePolicy } from '../../../src/shared/storage/probe-policy.js';
import { readStorageProbePolicy } from '../../../src/shared/storage/probe-policy-read.js';
import { readLockInfo } from '../../../src/shared/locks/file-lock.js';
import { STORAGE_POLICY_VERSION } from '../../../src/contracts/schemas/storage-policy.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';

// UNVALIDATED: actual disposable publication/metadata owners, no native-close proof.
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
const root = await makeTempDir('poc-policy-publication-errors-');
const originalMkdir = fs.mkdir, originalRm = fs.rm;
try {
  let sequence = 0;
  const exercise = async ({ primary, cleanup, cleanupFails = true }) => {
    const home = path.join(root, `home-${sequence++}`), category = 'command-probes';
    const directory = path.join(home, 'config', 'storage-policy-selections');
    const lockPath = path.join(home, 'config', 'storage-policy.lock');
    const cacheFile = path.join(home, 'cache-guard.bin');
    await originalMkdir(home, { recursive: true });
    await fs.writeFile(cacheFile, 'existing-cache-bytes');
    const plan = await planStorageProbePolicy({ home, patch: { enabled: false } });
    let publicationCalls = 0, releaseCalls = 0, denyRelease = cleanupFails;
    fs.mkdir = async (target, ...args) => {
      if (target === directory) { publicationCalls += 1; throw primary; }
      return originalMkdir(target, ...args);
    };
    fs.rm = async (target, ...args) => {
      if (target === lockPath) {
        releaseCalls += 1;
        if (denyRelease) throw cleanup;
      }
      return originalRm(target, ...args);
    };
    try {
      const failure = await rejected(() => applyStorageProbePolicy(plan, {
        approvedPlanId: plan.planId, home, category
      }));
      assert.equal(contains(failure, primary), true, 'publication cause survives cleanup failure, including null/undefined');
      assert.equal(publicationCalls, 1); assert.equal(releaseCalls, 1);
      assert.equal(readStorageProbePolicy(home).status, 'missing');
      assert.equal(await fs.readFile(cacheFile, 'utf8'), 'existing-cache-bytes');
      if (cleanupFails) {
        assert.equal(contains(failure, cleanup), true);
        const releaseFailure = failure.errors.find(error => error.code === 'ERR_FILE_LOCK_RELEASE_FAILED');
        assert.equal(Object.hasOwn(releaseFailure, 'cause'), true);
        assert.equal(releaseFailure.cause, cleanup);
        assert.equal(Object.getOwnPropertyDescriptor(failure, 'storageOperationLocks').enumerable, false);
        assert.equal(failure.storageOperationLocks.length, 1);
        const held = failure.storageOperationLocks[0], info = await readLockInfo(lockPath);
        assert.equal(held.lockPath, lockPath); assert.equal(held.payload.lockId, info.lockId);
        denyRelease = false;
        assert.equal(await held.release(), true);
        assert.equal(releaseCalls, 2); assert.equal(publicationCalls, 1, 'exact metadata retry never republishes');
      } else {
        if (primary !== null && ['object', 'function'].includes(typeof primary)) assert.equal(failure, primary);
        else { assert.equal(Object.hasOwn(failure, 'cause'), true); assert.equal(failure.cause, primary); }
        assert.equal(failure.storageOperationLocks, undefined);
      }
      await assert.rejects(fs.lstat(lockPath), { code: 'ENOENT' });
      assert.equal(readStorageProbePolicy(home).status, 'missing');
      assert.equal(await fs.readFile(cacheFile, 'utf8'), 'existing-cache-bytes');
      return failure;
    } finally { fs.mkdir = originalMkdir; fs.rm = originalRm; }
  };
  for (const primary of [undefined, null, false, 0, '']) {
    await exercise({ primary, cleanup: Object.freeze(new Error('exact metadata removal rejected')) });
    await exercise({ primary, cleanupFails: false });
  }
  for (const cleanup of [undefined, null, false, 0, '']) {
    const primary = Object.freeze(Object.defineProperties(new Error('readonly publication failure'), {
      code: { value: 'EORIGINAL', enumerable: true }, storageOperationLocks: { value: 17 }
    }));
    const failure = await exercise({ primary, cleanup });
    assert.equal(failure.cause, primary); assert.equal(failure.code, 'EORIGINAL');
    assert.equal(Object.getOwnPropertyDescriptor(failure, 'code').writable, false);
    assert.equal(primary.storageOperationLocks, 17);
    assert.throws(() => { failure.code = 'REPLACED'; }, TypeError);
  }
  await exercise({ primary: Object.freeze(new Error('ordinary frozen failure')), cleanupFails: false });

  const home = path.join(root, 'successful-home'), category = 'command-probes';
  const plan = await planStorageProbePolicy({ home, patch: { enabled: false, hardBytes: 0 } });
  const applied = await applyStorageProbePolicy(plan, { approvedPlanId: plan.planId, home, category });
  assert.equal(applied.schemaVersion, STORAGE_POLICY_VERSION); assert.equal(applied.complete, true);
  assert.equal(applied.cacheMutationPerformed, false); assert.equal(applied.existingCacheBytesPreserved, true);
  const selected = readStorageProbePolicy(home);
  assert.equal(selected.status, 'present'); assert.equal(selected.source, 'machine-local-reviewed-policy');
  assert.equal(selected.policy.enabled, false); assert.equal(selected.policy.hardBytes, 0);
  await assert.rejects(fs.lstat(path.join(home, 'config', 'storage-policy.lock')), { code: 'ENOENT' });
} finally {
  fs.mkdir = originalMkdir; fs.rm = originalRm;
  await rmDirRecursive(root);
}
console.log('probe-policy-publication-error-lifetime passed');
