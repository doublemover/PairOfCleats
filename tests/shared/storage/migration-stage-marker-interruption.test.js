import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { CACHE_OWNER_FILE } from '../../../src/shared/cache-deletion.js';
import { createStorageMigrationPlan } from '../../../src/shared/storage/migration-plan.js';
import { applyStorageMigration, readStorageMigrationStatus } from '../../../src/shared/storage/migration.js';

const temporary = await makeTempDir('poc-storage-stage-interruption-');
try {
  const source = path.join(temporary, 'legacy-models');
  await fs.mkdir(source);
  await fs.writeFile(path.join(temporary, CACHE_OWNER_FILE), JSON.stringify({ owner: 'pairofcleats', layoutVersion: 1 }));
  await fs.writeFile(path.join(source, 'model.bin'), 'preserved-model');
  const owner = { id: 'fixture-stage-owner', version: 1,
    inspect: async () => ({ complete: true, quiescent: true, referencesPortable: true, permissionsCompatible: true, identity: 'fixture' }),
    verifyDestination: async ({ root }) => (await fs.readFile(path.join(root, 'model.bin'), 'utf8')) === 'preserved-model' };
  const plan = await createStorageMigrationPlan({ category: 'models', source, destination: path.join(temporary, 'assets', 'models'),
    home: temporary, recoveryRoot: path.join(temporary, 'recovery'), coordinationRoot: path.join(temporary, 'state', 'access'),
    authorityRoots: [temporary], owner });
  const input = { approvedPlanId: plan.planId, authorityRoots: [temporary], owner,
    checkFreeSpace: async () => ({ complete: true, availableBytes: 1000000, reserveSatisfied: true }) };
  await assert.rejects(applyStorageMigration(plan, { ...input, hooks: { afterStageDirectory: async stage => {
    await fs.writeFile(path.join(stage, 'retained-unmarked-evidence'), 'retain-unknown-stage');
    throw new Error('fixture exit before marker');
  } } }), /exit before marker/);
  const first = await readStorageMigrationStatus(plan, { authorityRoots: [temporary] });
  assert.equal(await fs.readFile(path.join(first.staging, 'retained-unmarked-evidence'), 'utf8'), 'retain-unknown-stage');
  const resumed = await applyStorageMigration(plan, input);
  assert.equal(resumed.complete, true);
  assert.equal(resumed.abandonedStages.includes(first.staging), true);
  assert.equal(await fs.readFile(path.join(first.staging, 'retained-unmarked-evidence'), 'utf8'), 'retain-unknown-stage', 'unknown staging is neither adopted nor deleted');
  assert.equal(await fs.readFile(path.join(source, 'model.bin'), 'utf8'), 'preserved-model');
} finally { await rmDirRecursive(temporary); }
console.log('storage stage-marker interruption preserves unknown evidence passed');
