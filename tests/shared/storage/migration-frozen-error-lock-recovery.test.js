import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { CACHE_OWNER_FILE } from '../../../src/shared/cache-deletion.js';
import { createStorageMigrationPlan, storageMigrationOwnerProof } from '../../../src/shared/storage/migration-plan.js';
import { applyStorageMigration, applyStorageMigrationRollback, readStorageMigrationStatus } from '../../../src/shared/storage/migration.js';
import { readStorageLocator } from '../../../src/shared/storage/locator-read.js';

// UNVALIDATED: actual fixture copy/journal/locator/lock owners, no user assets.
const temporary = await makeTempDir('poc-migration-frozen-recovery-');
const contains = (error, expected) => {
  const pending = [error], seen = new Set();
  while (pending.length) { const item = pending.pop(); if (!item || seen.has(item)) continue;
    if (item === expected) return true; seen.add(item); pending.push(item.cause, ...(Array.isArray(item.errors) ? item.errors : [])); }
  return false;
};
try {
  const home = path.join(temporary, 'home'), source = path.join(home, 'source'), destination = path.join(home, 'destination');
  const recoveryRoot = path.join(home, 'recovery'), coordinationRoot = path.join(home, 'state', 'storage-access');
  await fs.mkdir(source, { recursive: true });
  await fs.writeFile(path.join(home, CACHE_OWNER_FILE), JSON.stringify({ owner: 'pairofcleats', layoutVersion: 1 }));
  await fs.writeFile(path.join(source, 'fixture.bin'), 'retained fixture source');
  const owner = { id: 'fixture-owned-copy', version: 1,
    inspect: async () => ({ complete: true, quiescent: true, referencesPortable: true, permissionsCompatible: true, identity: 'fixture-v1' }),
    verifyDestination: async ({ root }) => await fs.readFile(path.join(root, 'fixture.bin'), 'utf8') === 'retained fixture source' };
  const input = { category: 'models', source, destination, home, recoveryRoot, coordinationRoot, authorityRoots: [home], owner };
  const pendingResource = Object.freeze(Object.assign(new Error('category owner resource remains pending'), {
    cacheOwnershipPending: true, cacheOwnershipReleased: () => false
  }));
  await assert.rejects(storageMigrationOwnerProof({ ...owner, inspect: async () => { throw pendingResource; } }, {}),
    error => contains(error, pendingResource), 'unknown resource lifetime cannot become an ordinary blocked owner diagnostic');
  const openDirectory = fs.opendir;
  let sourceScans = 0;
  try {
    fs.opendir = async (target, ...args) => { if (target === source) sourceScans++; return openDirectory(target, ...args); };
    await assert.rejects(createStorageMigrationPlan({ ...input, owner: { ...owner, inspect: async () => { throw pendingResource; } } }),
      error => contains(error, pendingResource));
    assert.equal(sourceScans, 0, 'a pending category owner stops before later source work');
  } finally { fs.opendir = openDirectory; }
  const plan = await createStorageMigrationPlan(input);
  assert.equal(plan.ready, true);
  const operationPath = path.join(recoveryRoot, `${plan.planId}.json.lock`);
  const locatorPath = path.join(home, 'config', 'storage-locator.lock');
  const remove = fs.rm;
  const denied = new Set([operationPath]);
  const copyFailure = Object.freeze(Object.assign(new Error('frozen interrupted copy'), { code: 'EIO' }));
  let interrupted;
  try {
    fs.rm = async (target, options) => { if (denied.has(target)) throw Object.assign(new Error('fixture metadata release denied'), { code: 'EACCES' }); return remove(target, options); };
    try { await applyStorageMigration(plan, { approvedPlanId: plan.planId, authorityRoots: [home], owner,
      checkFreeSpace: async () => ({ complete: true, availableBytes: 1024 * 1024, reserveSatisfied: true }),
      hooks: { afterFile: () => { throw copyFailure; } } }); }
    catch (error) { interrupted = error; }
    assert.equal(contains(interrupted, copyFailure), true);
    assert.equal(interrupted.code, 'EIO');
    assert.equal(interrupted.recovery.sourcePreserved, true);
    assert.deepEqual(interrupted.storageOperationLocks.map(lock => lock.lockPath), [operationPath]);
    assert.equal((await readStorageMigrationStatus(plan, { authorityRoots: [home] })).stage, 'interrupted');
    assert.equal(readStorageLocator(home).status, 'missing');
    denied.clear();
    assert.equal(await interrupted.storageOperationLocks[0].release(), true);
    const applied = await applyStorageMigration(plan, { approvedPlanId: plan.planId, authorityRoots: [home], owner,
      checkFreeSpace: async () => ({ complete: true, availableBytes: 1024 * 1024, reserveSatisfied: true }) });
    assert.equal(applied.complete, true);
    const selected = readStorageLocator(home).value.categories.models.path;
    const rollbackFailure = Object.freeze(Object.assign(new Error('frozen prepared rollback'), { code: 'EIO' }));
    denied.add(operationPath); denied.add(locatorPath);
    let rollback;
    try { await applyStorageMigrationRollback(plan, { approvedPlanId: plan.planId, authorityRoots: [home], owner,
      hooks: { afterRollbackPrepared: () => { throw rollbackFailure; } } }); }
    catch (error) { rollback = error; }
    assert.equal(contains(rollback, rollbackFailure), true);
    assert.equal(rollback.recovery.sourcePreserved, true);
    assert.deepEqual(rollback.storageOperationLocks.map(lock => lock.lockPath).sort(), [operationPath, locatorPath].sort());
    assert.equal(readStorageLocator(home).value.categories.models.path, selected);
    assert.equal((await readStorageMigrationStatus(plan, { authorityRoots: [home] })).stage, 'rollback-prepared');
    denied.clear();
    for (const lock of rollback.storageOperationLocks) assert.equal(await lock.release(), true);
    const settled = await applyStorageMigrationRollback(plan, { approvedPlanId: plan.planId, authorityRoots: [home], owner });
    assert.equal(settled.stage, 'rolled-back');
    assert.equal(await fs.readFile(path.join(source, 'fixture.bin'), 'utf8'), 'retained fixture source');
    assert.equal(await fs.readFile(path.join(selected, 'fixture.bin'), 'utf8'), 'retained fixture source');
  } finally { fs.rm = remove; }
} finally { await rmDirRecursive(temporary); }
console.log('Migration and rollback retain frozen primary failures and exact metadata lock recovery.');
