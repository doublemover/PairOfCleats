import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { CACHE_OWNER_FILE } from '../../../src/shared/cache-deletion.js';
import { repoAccessPaths } from '../../../src/shared/cache/repo-access.js';
import { createStorageMigrationPlan } from '../../../src/shared/storage/migration-plan.js';
import { applyStorageMigration } from '../../../src/shared/storage/migration.js';
import { inspectStorageAccess } from '../../../src/shared/storage/access.js';
import { getStorageDirectorySession } from '../../../src/shared/storage/directory.js';

// UNVALIDATED: actual tiny migration/directory/exclusion owners, no user assets.
const temporary = await makeTempDir('poc-migration-directory-exclusion-');
const opendir = fs.opendir, remove = fs.rm;
try {
  const home = path.join(temporary, 'home'), source = path.join(home, 'source'), destination = path.join(home, 'destination');
  const coordinationRoot = path.join(home, 'state', 'storage-access'), recoveryRoot = path.join(home, 'recovery');
  await fs.mkdir(source, { recursive: true });
  await fs.writeFile(path.join(home, CACHE_OWNER_FILE), JSON.stringify({ owner: 'pairofcleats', layoutVersion: 1 }));
  await fs.writeFile(path.join(source, 'fixture.bin'), 'original directory migration bytes');
  const owner = { id: 'fixture-directory-owner', version: 1,
    inspect: async () => ({ complete: true, quiescent: true, referencesPortable: true, permissionsCompatible: true, identity: 'fixture-v1' }),
    verifyDestination: async ({ root }) => await fs.readFile(path.join(root, 'fixture.bin'), 'utf8') === 'original directory migration bytes' };
  const plan = await createStorageMigrationPlan({ category: 'models', source, destination, home, recoveryRoot, coordinationRoot,
    authorityRoots: [home], owner });
  assert.equal(plan.ready, true);
  const sourceLock = repoAccessPaths(source, { coordinationRoot }).lockPath;
  let denyClose = true, denyMetadata = false, closes = 0, closeReads = 0, replace = false;
  fs.opendir = async (target, ...args) => {
    const directory = await opendir(target, ...args);
    if (target !== source) return directory;
    return { read: directory.read.bind(directory), get close() {
      closeReads++;
      if (replace) return () => assert.fail('migration retry cannot change the actual original directory close owner');
      return async () => { closes++; if (denyClose) throw Object.freeze(Object.assign(new Error('source Dir close denied'), { code: 'EACCES' })); await directory.close(); };
    } };
  };
  fs.rm = async (target, options) => {
    if (denyMetadata && target === sourceLock) throw Object.assign(new Error('source exclusion removal denied'), { code: 'EACCES' });
    return remove(target, options);
  };
  const input = { approvedPlanId: plan.planId, authorityRoots: [home], owner,
    checkFreeSpace: async () => ({ complete: true, availableBytes: 1024 * 1024, reserveSatisfied: true }) };
  let failure;
  try { await applyStorageMigration(plan, input); } catch (error) { failure = error; }
  assert.ok(getStorageDirectorySession(failure));
  assert.equal(failure.cacheOwnershipReleased(), false);
  for (const root of [source, destination]) assert.equal((await inspectStorageAccess(root, { coordinationRoot })).protected, true);
  const held = failure.storageMigrationTransferSession;
  denyClose = false; denyMetadata = true; replace = true;
  let latest;
  try { await held.releaseAfterClose(); } catch (error) { latest = error; }
  assert.equal(latest.storageMigrationTransferSession, held);
  assert.equal(closes, 2); assert.equal(closeReads, 1);
  assert.equal((await inspectStorageAccess(source, { coordinationRoot })).protected, true);
  assert.equal((await inspectStorageAccess(destination, { coordinationRoot })).protected, false,
    'one exact exclusion unlink failure does not skip independent exclusion cleanup');
  assert.equal(failure.cacheOwnershipReleased(), false);
  denyMetadata = false;
  assert.deepEqual(await Promise.all([held.releaseAfterClose(), latest.storageMigrationTransferSession.releaseAfterClose()]), [true, true]);
  assert.equal(closes, 2);
  assert.equal(failure.cacheOwnershipReleased(), true);
  assert.equal((await inspectStorageAccess(source, { coordinationRoot })).protected, false);
  fs.opendir = opendir;
  assert.equal((await applyStorageMigration(plan, input)).complete, true);
  assert.equal(await fs.readFile(path.join(source, 'fixture.bin'), 'utf8'), 'original directory migration bytes');
} finally { fs.opendir = opendir; fs.rm = remove; await rmDirRecursive(temporary); }
console.log('Migration retains exact existing exclusions through real directory closure.');
