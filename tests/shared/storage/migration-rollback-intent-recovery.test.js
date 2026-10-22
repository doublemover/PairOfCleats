import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { CACHE_OWNER_FILE } from '../../../src/shared/cache-deletion.js';
import { createStorageMigrationPlan } from '../../../src/shared/storage/migration-plan.js';
import { applyStorageMigration, applyStorageMigrationRollback, readStorageMigrationStatus } from '../../../src/shared/storage/migration.js';
import { readStorageLocator } from '../../../src/shared/storage/locator-read.js';

const temporary = await makeTempDir('poc-rollback-intent-recovery-');
try {
  const home = path.join(temporary, 'home');
  const source = path.join(home, 'fixture-assets');
  await fs.mkdir(source, { recursive: true });
  await fs.writeFile(path.join(home, CACHE_OWNER_FILE), JSON.stringify({ owner: 'pairofcleats', layoutVersion: 1 }));
  await fs.writeFile(path.join(source, 'saved.bin'), 'fixture source retained across both rollback boundaries');
  const owner = { id: 'rollback-fixture-byte-owner', version: 1,
    inspect: async () => ({ complete: true, quiescent: true, referencesPortable: true, permissionsCompatible: true, identity: 'fixture@1' }),
    verifyDestination: async ({ root }) => (await fs.readFile(path.join(root, 'saved.bin'), 'utf8')).startsWith('fixture source') };
  const plan = await createStorageMigrationPlan({ category: 'models', source, home,
    destination: path.join(home, 'target'), recoveryRoot: path.join(home, 'recovery'),
    coordinationRoot: path.join(home, 'state', 'storage-access'), authorityRoots: [home], owner });
  assert.equal(plan.ready, true);
  const options = { approvedPlanId: plan.planId, authorityRoots: [home], owner,
    checkFreeSpace: async () => ({ complete: true, availableBytes: 1024 * 1024, reserveSatisfied: true }) };
  const applied = await applyStorageMigration(plan, options);
  const selected = applied.selectedPath;
  const sourceBytes = await fs.readFile(path.join(source, 'saved.bin'));
  await assert.rejects(() => applyStorageMigrationRollback(plan, { ...options, hooks: {
    afterRollbackPrepared: () => { throw new Error('fixture interruption after rollback intent'); }
  } }), /after rollback intent/);
  assert.equal((await readStorageMigrationStatus(plan, { authorityRoots: [home] })).stage, 'rollback-prepared');
  assert.equal(readStorageLocator(home).value.categories.models.path, selected, 'intent alone never changes the selected complete generation');
  const journal = path.join(plan.recoveryRoot, `${plan.planId}.json`);
  const intentBytes = await fs.readFile(journal);
  await assert.rejects(() => applyStorageMigration(plan, options), /pending rollback/);
  assert.deepEqual(await fs.readFile(journal), intentBytes, 'forward resume cannot overwrite rollback recovery intent');
  const locatorFile = path.join(home, 'config', 'storage-locations.json');
  const selectedBytes = await fs.readFile(locatorFile);
  const selectionWithNewCategory = readStorageLocator(home).value;
  selectionWithNewCategory.categories.extensions = { path: path.join(home, 'newer-extension-selection'),
    migrationId: 'b'.repeat(64), owner: 'different-reviewed-category-operation' };
  await fs.writeFile(locatorFile, JSON.stringify(selectionWithNewCategory));
  const newerBytes = await fs.readFile(locatorFile);
  await assert.rejects(() => applyStorageMigrationRollback(plan, options), /changed after rollback intent/);
  assert.deepEqual(await fs.readFile(journal), intentBytes, 'resume cannot rebase or replace its saved rollback intent');
  assert.deepEqual(await fs.readFile(locatorFile), newerBytes, 'a later category selection is preserved');
  await fs.writeFile(locatorFile, selectedBytes);
  await assert.rejects(() => applyStorageMigrationRollback(plan, { ...options, hooks: {
    afterRollbackSelection: () => { throw new Error('fixture interruption after rollback pointer'); }
  } }), /after rollback pointer/);
  assert.equal(readStorageLocator(home).value.categories.models, undefined);
  assert.equal((await readStorageMigrationStatus(plan, { authorityRoots: [home] })).stage, 'rollback-prepared', 'pointer publication is not settlement');
  const resumed = await applyStorageMigrationRollback(plan, options);
  assert.equal(resumed.complete, true);
  assert.equal(resumed.resumed, true);
  assert.equal((await readStorageMigrationStatus(plan, { authorityRoots: [home] })).stage, 'rolled-back');
  const duplicate = await applyStorageMigrationRollback(plan, options);
  assert.equal(duplicate.complete, true);
  assert.equal(duplicate.mutationPerformed, false);
  assert.deepEqual(await fs.readFile(path.join(source, 'saved.bin')), sourceBytes);
  assert.deepEqual(await fs.readFile(path.join(selected, 'saved.bin')), sourceBytes);
  await assert.rejects(() => readStorageMigrationStatus({ ...plan, planId: '../config/storage-locations' }, { authorityRoots: [home] }), /intact reviewed plan/);
  const known = JSON.parse(await fs.readFile(journal));
  await fs.writeFile(journal, JSON.stringify({ ...known, pinned: 'unknown future recovery owner' }));
  const unknown = await fs.readFile(journal);
  await assert.rejects(() => applyStorageMigration(plan, options), /unknown or incompatible/);
  await assert.rejects(() => applyStorageMigrationRollback(plan, options), /unknown or incompatible/);
  assert.deepEqual(await fs.readFile(journal), unknown, 'unknown journal fields cannot be replaced by failure recording');
  assert.deepEqual(await fs.readFile(path.join(selected, 'saved.bin')), sourceBytes);
} finally { await rmDirRecursive(temporary); }
console.log('migration rollback intent recovery passed');
