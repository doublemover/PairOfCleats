import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { CACHE_OWNER_FILE } from '../../../src/shared/cache-deletion.js';
import { createStorageMigrationPlan } from '../../../src/shared/storage/migration-plan.js';
import { applyStorageMigration } from '../../../src/shared/storage/migration.js';
import { readStorageLocator } from '../../../src/shared/storage/locator-read.js';

const temporary = await makeTempDir('poc-storage-source-change-');
try {
  const source = path.join(temporary, 'legacy-models');
  await fs.mkdir(source);
  await fs.writeFile(path.join(temporary, CACHE_OWNER_FILE), JSON.stringify({ owner: 'pairofcleats', layoutVersion: 1 }));
  await fs.writeFile(path.join(source, 'model.bin'), 'original');
  const owner = { id: 'fixture-quiescent-owner', version: 1,
    inspect: async () => ({ complete: true, quiescent: true, referencesPortable: true, permissionsCompatible: true, identity: 'fixture' }),
    verifyDestination: async () => true };
  const plan = await createStorageMigrationPlan({ category: 'models', source,
    destination: path.join(temporary, 'assets', 'models'), home: temporary,
    recoveryRoot: path.join(temporary, 'recovery'), coordinationRoot: path.join(temporary, 'state', 'access'), authorityRoots: [temporary], owner });
  assert.equal(plan.ready, true);
  await fs.writeFile(path.join(source, 'model.bin'), 'changed-after-preview');
  await assert.rejects(applyStorageMigration(plan, { approvedPlanId: plan.planId, owner, authorityRoots: [temporary],
    checkFreeSpace: async () => ({ complete: true, availableBytes: 1000000, reserveSatisfied: true }) }), /changed since preview/);
  assert.equal(readStorageLocator(temporary).status, 'missing');
  assert.equal(await fs.readFile(path.join(source, 'model.bin'), 'utf8'), 'changed-after-preview');
  const unknownOwner = await createStorageMigrationPlan({ category: 'models', source,
    destination: path.join(temporary, 'other-models'), home: temporary,
    recoveryRoot: path.join(temporary, 'recovery'), authorityRoots: [temporary] });
  assert.equal(unknownOwner.ready, false);
  assert.equal(unknownOwner.blocked.some(item => item.reason === 'category-migration-owner-required'), true);
} finally { await rmDirRecursive(temporary); }
console.log('storage source-change blocks cutover passed');
