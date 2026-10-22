import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { CACHE_OWNER_FILE } from '../../../src/shared/cache-deletion.js';
import { repoAccessPaths } from '../../../src/shared/cache/repo-access.js';
import { createStorageMigrationPlan } from '../../../src/shared/storage/migration-plan.js';
import { applyStorageMigration } from '../../../src/shared/storage/migration.js';
import { inspectStorageAccess } from '../../../src/shared/storage/access.js';

// UNVALIDATED: actual tiny copy/file-close/exclusion owners, no user assets.
const temporary = await makeTempDir('poc-migration-transfer-exclusion-');
const open = fs.open, remove = fs.rm;
try {
  const home = path.join(temporary, 'home'), source = path.join(home, 'source'), destination = path.join(home, 'destination');
  const coordinationRoot = path.join(home, 'state', 'storage-access'), recoveryRoot = path.join(home, 'recovery');
  await fs.mkdir(source, { recursive: true });
  await fs.writeFile(path.join(home, CACHE_OWNER_FILE), JSON.stringify({ owner: 'pairofcleats', layoutVersion: 1 }));
  await fs.writeFile(path.join(source, 'fixture.bin'), 'exact retained migration bytes');
  const owner = { id: 'fixture-transfer-owner', version: 1,
    inspect: async () => ({ complete: true, quiescent: true, referencesPortable: true, permissionsCompatible: true, identity: 'fixture-v1' }),
    verifyDestination: async ({ root }) => await fs.readFile(path.join(root, 'fixture.bin'), 'utf8') === 'exact retained migration bytes' };
  const plan = await createStorageMigrationPlan({ category: 'models', source, destination, home, recoveryRoot, coordinationRoot,
    authorityRoots: [home], owner });
  assert.equal(plan.ready, true);
  const sourceLock = repoAccessPaths(source, { coordinationRoot }).lockPath;
  let denyClose = true, denyLock = false, closes = 0;
  fs.open = async (target, ...args) => {
    const handle = await open(target, ...args);
    if (args[0] !== 'wx' || !String(target).startsWith(destination + path.sep) || path.basename(target) !== 'fixture.bin') return handle;
    return new Proxy(handle, { get(original, property) {
      if (property === 'close') return async () => { closes++; if (denyClose) throw Object.assign(new Error('actual migration output close denied'), { code: 'EACCES' }); await original.close(); };
      const value = Reflect.get(original, property, original);
      return typeof value === 'function' ? value.bind(original) : value;
    } });
  };
  fs.rm = async (target, options) => {
    if (denyLock && target === sourceLock) throw Object.assign(new Error('actual retained source exclusion unlink denied'), { code: 'EACCES' });
    return remove(target, options);
  };
  const input = { approvedPlanId: plan.planId, authorityRoots: [home], owner,
    checkFreeSpace: async () => ({ complete: true, availableBytes: 1024 * 1024, reserveSatisfied: true }) };
  let failure;
  try { await applyStorageMigration(plan, input); } catch (error) { failure = error; }
  assert.equal(failure.cacheOwnershipReleased(), false);
  assert.equal((await inspectStorageAccess(source, { coordinationRoot })).protected, true);
  assert.equal((await inspectStorageAccess(destination, { coordinationRoot })).protected, true);
  assert.equal(Object.keys(failure).includes('storageMigrationTransferSession'), false);
  const held = failure.storageMigrationTransferSession;
  denyClose = false; denyLock = true;
  let latest;
  try { await held.releaseAfterClose(); } catch (error) { latest = error; }
  assert.equal(latest.storageMigrationTransferSession, held);
  assert.equal(closes, 2);
  assert.equal((await inspectStorageAccess(source, { coordinationRoot })).protected, true);
  assert.equal((await inspectStorageAccess(destination, { coordinationRoot })).protected, false,
    'failed source metadata removal does not skip the other exact exclusion cleanup');
  assert.equal(failure.cacheOwnershipReleased(), false, 'file close alone cannot confirm retained exclusion removal');
  denyLock = false;
  assert.deepEqual(await Promise.all([held.releaseAfterClose(), latest.storageMigrationTransferSession.releaseAfterClose()]), [true, true]);
  assert.equal(closes, 2);
  assert.equal(failure.cacheOwnershipReleased(), true);
  assert.equal((await inspectStorageAccess(source, { coordinationRoot })).protected, false);
  fs.open = open;
  assert.equal((await applyStorageMigration(plan, input)).complete, true);
  assert.equal(await fs.readFile(path.join(source, 'fixture.bin'), 'utf8'), 'exact retained migration bytes');
} finally { fs.open = open; fs.rm = remove; await rmDirRecursive(temporary); }
console.log('Migration retains existing exclusions through actual transfer descriptor closure.');
