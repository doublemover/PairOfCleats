import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { CACHE_OWNER_FILE } from '../../../src/shared/cache-deletion.js';
import { createStorageMigrationPlan } from '../../../src/shared/storage/migration-plan.js';
import { applyStorageMigration, applyStorageMigrationRollback } from '../../../src/shared/storage/migration.js';
import { readStorageLocator } from '../../../src/shared/storage/locator-read.js';

const temporary = await makeTempDir('poc-migration-selection-owner-');
try {
  const home = path.join(temporary, 'home');
  const source = path.join(home, 'source');
  await fs.mkdir(source, { recursive: true });
  await fs.writeFile(path.join(home, CACHE_OWNER_FILE), JSON.stringify({ owner: 'pairofcleats', layoutVersion: 1 }));
  await fs.writeFile(path.join(source, 'bytes'), 'retained fixture evidence');
  const owner = { id: 'selection-fixture-owner', version: 1,
    inspect: async () => ({ complete: true, quiescent: true, referencesPortable: true, permissionsCompatible: true, identity: 'fixture@1' }),
    verifyDestination: async ({ root }) => await fs.readFile(path.join(root, 'bytes'), 'utf8') === 'retained fixture evidence' };
  const plan = await createStorageMigrationPlan({ category: 'models', source, home, owner,
    destination: path.join(home, 'target'), recoveryRoot: path.join(home, 'recovery'), authorityRoots: [home],
    coordinationRoot: path.join(home, 'state', 'storage-access') });
  const options = { approvedPlanId: plan.planId, authorityRoots: [home], owner,
    checkFreeSpace: async () => ({ complete: true, availableBytes: 1024 * 1024, reserveSatisfied: true }) };
  const applied = await applyStorageMigration(plan, options);
  const locatorFile = path.join(home, 'config', 'storage-locations.json');
  const original = readStorageLocator(home).value;
  for (const patch of [{ path: source }, { owner: 'different-category-owner' }]) {
    await fs.writeFile(locatorFile, JSON.stringify({ ...original, categories: { ...original.categories,
      models: { ...original.categories.models, ...patch } } }));
    const mismatched = await fs.readFile(locatorFile);
    await assert.rejects(() => applyStorageMigration(plan, options), /different path or category owner/);
    await assert.rejects(() => applyStorageMigrationRollback(plan, options), /mismatched category/);
    assert.deepEqual(await fs.readFile(locatorFile), mismatched, 'same migration ID cannot confer authority over a different locator target');
    assert.equal(await fs.readFile(path.join(source, 'bytes'), 'utf8'), 'retained fixture evidence');
    assert.equal(await fs.readFile(path.join(applied.selectedPath, 'bytes'), 'utf8'), 'retained fixture evidence');
  }
  await fs.writeFile(locatorFile, JSON.stringify(original));
  const markerFile = path.join(path.dirname(applied.selectedPath), '.migration-owner.json');
  await fs.writeFile(markerFile, JSON.stringify({ schemaVersion: 1, planId: plan.planId, pinned: true }));
  const protectedMarker = await fs.readFile(markerFile);
  const selectedLocator = await fs.readFile(locatorFile);
  await assert.rejects(() => applyStorageMigration(plan, options), /unknown retained metadata/);
  await assert.rejects(() => applyStorageMigrationRollback(plan, options), /unknown retained metadata/);
  assert.deepEqual(await fs.readFile(markerFile), protectedMarker);
  assert.deepEqual(await fs.readFile(locatorFile), selectedLocator);
  assert.equal(await fs.readFile(path.join(applied.selectedPath, 'bytes'), 'utf8'), 'retained fixture evidence');
} finally { await rmDirRecursive(temporary); }
console.log('migration exact selected path and owner protection passed');
