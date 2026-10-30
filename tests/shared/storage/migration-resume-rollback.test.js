import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { CACHE_OWNER_FILE } from '../../../src/shared/cache-deletion.js';
import { createStorageMigrationPlan } from '../../../src/shared/storage/migration-plan.js';
import { applyStorageMigration, applyStorageMigrationRollback, readStorageMigrationStatus } from '../../../src/shared/storage/migration.js';
import { readStorageLocator } from '../../../src/shared/storage/locator-read.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';

const temporary = await makeTempDir('poc-storage-migration-');
try {
  const home = path.join(temporary, 'home');
  const source = path.join(home, 'legacy-models');
  const destination = path.join(home, 'assets', 'models');
  const recoveryRoot = path.join(home, 'recovery');
  const coordinationRoot = path.join(home, 'state', 'storage-access');
  await fs.mkdir(path.join(source, 'nested'), { recursive: true });
  await fs.mkdir(path.join(source, 'empty'), { recursive: true });
  await fs.writeFile(path.join(home, CACHE_OWNER_FILE), JSON.stringify({ owner: 'pairofcleats', layoutVersion: 1 }));
  await fs.writeFile(path.join(source, 'identity.json'), JSON.stringify({ model: 'fixture@1', sha: 'source-provenance' }));
  await fs.writeFile(path.join(source, 'nested', 'weights.bin'), 'immutable-fixture-bytes');
  const owner = { id: 'fixture-immutable-asset-owner', version: 1,
    inspect: async () => ({ complete: true, quiescent: true, referencesPortable: true, permissionsCompatible: true, identity: 'fixture@1' }),
    verifyDestination: async ({ root }) => (await fs.readFile(path.join(root, 'nested', 'weights.bin'), 'utf8')) === 'immutable-fixture-bytes' };
  const input = { category: 'models', home, source, destination, recoveryRoot, coordinationRoot, authorityRoots: [home], owner };
  const before = await fs.readdir(home, { recursive: true });
  const plan = await createStorageMigrationPlan(input);
  assert.equal(plan.ready, true);
  assert.deepEqual(await fs.readdir(home, { recursive: true }), before, 'planning cannot create staging/journals/leases');
  const samePlan = await createStorageMigrationPlan(input);
  assert.equal(samePlan.planId, plan.planId, 'unchanged inputs produce stable preview identities');
  const free = async () => ({ complete: true, availableBytes: 1024 * 1024, reserveSatisfied: true });
  let interrupted = false;
  await assert.rejects(applyStorageMigration(plan, { approvedPlanId: plan.planId, authorityRoots: [home], owner,
    checkFreeSpace: free, hooks: { afterFile: () => { if (!interrupted) { interrupted = true; throw new Error('fixture interrupted copy'); } } } }), /interrupted copy/);
  assert.equal((await readStorageMigrationStatus(plan, { authorityRoots: [home] })).stage, 'interrupted');
  assert.equal(readStorageLocator(home).status, 'missing', 'failed copy cannot select a partial destination');
  const applied = await applyStorageMigration(plan, { approvedPlanId: plan.planId, authorityRoots: [home], owner, checkFreeSpace: free });
  assert.equal(applied.complete, true);
  assert.equal(await fs.readFile(path.join(source, 'nested', 'weights.bin'), 'utf8'), 'immutable-fixture-bytes');
  const selected = readStorageLocator(home).value.categories.models.path;
  assert.equal(await fs.readFile(path.join(selected, 'nested', 'weights.bin'), 'utf8'), 'immutable-fixture-bytes');
  assert.equal((await fs.stat(path.join(selected, 'empty'))).isDirectory(), true);
  const again = await applyStorageMigration(plan, { approvedPlanId: plan.planId, authorityRoots: [home], owner, checkFreeSpace: free });
  assert.equal(again.selectedPath, selected, 'duplicate resume does not publish or apply twice');
  const rollback = await applyStorageMigrationRollback(plan, { approvedPlanId: plan.planId, authorityRoots: [home], owner });
  assert.equal(rollback.stage, 'rolled-back');
  assert.equal(readStorageLocator(home).value.categories.models, undefined);
  assert.equal(await fs.readFile(path.join(selected, 'nested', 'weights.bin'), 'utf8'), 'immutable-fixture-bytes', 'rollback preserves the verified new copy');
  await assert.rejects(applyStorageMigration(plan, { approvedPlanId: plan.planId, authorityRoots: [home], owner, checkFreeSpace: free }), /new reviewed plan/);
} finally { await rmDirRecursive(temporary); }
console.log('storage migration resume rollback passed');
