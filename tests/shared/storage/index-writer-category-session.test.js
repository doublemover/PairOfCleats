import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { acquireIndexLock } from '../../../src/index/build/lock.js';
import { getRepoId } from '../../../src/shared/repo-paths.js';
import { inspectStorageAccess, withExclusiveStorageAccess } from '../../../src/shared/storage/access.js';
import { repoAccessPaths } from '../../../src/shared/cache/repo-access.js';
import { resolveStorageLayout } from '../../../src/shared/storage/layout.js';
import { planStorageConfiguration, applyStorageConfiguration } from '../../../src/shared/storage/configuration.js';
import { readStorageLocator } from '../../../src/shared/storage/locator-read.js';

// UNVALIDATED: actual file/lease owners only; no index, native or child runs.
const temporary = await makeTempDir('poc-index-category-session-');
try {
  const repoRoot = path.join(temporary, 'repository');
  const home = path.join(temporary, 'home');
  const cache = path.join(temporary, 'explicit-cache');
  const coordinationRoot = path.join(home, 'state', 'storage-access');
  await fsp.mkdir(repoRoot);
  const repoCacheRoot = path.join(cache, 'repos', getRepoId(repoRoot));
  const storageContext = { repoRoot, userConfig: { cache: { root: cache } }, env: { PAIROFCLEATS_HOME: home } };
  const inspect = root => inspectStorageAccess(root, { coordinationRoot });
  const acquire = () => acquireIndexLock({ repoCacheRoot, storageContext });
  const lock = await acquire();
  assert.equal(await acquire(), null, 'a busy index lock releases only its own newly admitted category leases');
  assert.equal(lock.payload.resourceSettlementVersion, 1, 'launch-context writer locks always retain resource settlement semantics');
  for (const root of [cache, path.join(cache, 'repos'), repoCacheRoot]) assert.equal((await inspect(root)).protected, true);
  for (const root of [temporary, home, path.join(temporary, 'unselected-cache')]) assert.equal((await inspect(root)).protected, false,
    'a shared physical parent does not gain launch authorization');
  assert.equal((await withExclusiveStorageAccess(cache, () => assert.fail('active writer prevents category exclusion'), { coordinationRoot })).protected, true);
  const categoryLeases = path.join(repoAccessPaths(cache, { coordinationRoot }).leases);
  const [leaseName] = await fsp.readdir(categoryLeases);
  const leaseFile = path.join(categoryLeases, leaseName);
  const metadata = JSON.parse(await fsp.readFile(leaseFile, 'utf8'));
  await fsp.writeFile(leaseFile, JSON.stringify({ ...metadata, pid: 2147483647 }));
  assert.equal((await inspect(cache)).owners[0].status, 'resource-settlement-unconfirmed', 'PID death cannot authorize category migration');
  assert.equal((await withExclusiveStorageAccess(cache, () => assert.fail('dead parent is not resource settlement'), { coordinationRoot })).protected, true);

  const remove = fsp.rm;
  let announce, finish;
  const removing = new Promise(resolve => { announce = resolve; });
  const permitted = new Promise(resolve => { finish = resolve; });
  try {
    fsp.rm = async (target, options) => {
      if (target === lock.lockPath) { announce(); await permitted; }
      return remove(target, options);
    };
    const releasing = lock.release();
    const duplicate = lock.release();
    assert.equal(duplicate, releasing, 'concurrent releases share the actual writer release');
    await removing;
    assert.equal((await inspect(cache)).protected, true, 'category remains pinned during exact index-lock removal');
    finish();
    assert.equal(await releasing, true);
    assert.equal(await duplicate, true);
  } finally { finish(); fsp.rm = remove; }
  for (const root of [cache, path.join(cache, 'repos'), repoCacheRoot]) assert.equal((await inspect(root)).protected, false);
  assert.equal(await lock.release(), true);

  const exclusive = await withExclusiveStorageAccess(cache, async () => {
    await assert.rejects(acquire(), { code: 'ERR_REPO_CACHE_CLEANUP_BUSY' }, 'category exclusion also rejects a newly starting writer');
    assert.equal(fs.existsSync(path.join(repoCacheRoot, 'locks', 'index.lock')), false);
    return 'exclusive';
  }, { coordinationRoot });
  assert.equal(exclusive.result, 'exclusive');
  await assert.rejects(acquireIndexLock({ repoCacheRoot: path.join(cache, 'repos', 'unselected'), storageContext }),
    { code: 'ERR_INDEX_STORAGE_SELECTION' });
  assert.equal((await inspect(cache)).protected, false);

  const retryLock = await acquire();
  const syncRemove = fs.rmSync;
  let deny = true;
  try {
    fs.rmSync = (target, options) => {
      if (deny && path.dirname(target) === categoryLeases) throw Object.assign(new Error('fixture lease release denied'), { code: 'EACCES' });
      return syncRemove(target, options);
    };
    let retained;
    try { await retryLock.release(); } catch (error) { retained = error; }
    assert.equal(retained.cacheOwnershipPending, true);
    assert.equal(retained.indexStorageOwner, retryLock);
    assert.equal(retained.cacheOwnershipReleased(), false);
    assert.equal(fs.existsSync(retryLock.lockPath), false, 'category release follows successful exact writer removal');
    assert.equal((await inspect(cache)).protected, true);
    deny = false;
    assert.equal(await retained.indexStorageOwner.release(), true, 'retry does not remove the already-released index lock twice');
    assert.equal(retained.cacheOwnershipReleased(), true);
    assert.equal((await inspect(cache)).protected, false);
  } finally { fs.rmSync = syncRemove; await retryLock.release(); }

  const raceHome = path.join(temporary, 'race-home');
  const raceCache = path.join(raceHome, 'cache');
  const destination = path.join(temporary, 'selected-cache');
  const raceRoot = path.join(raceCache, 'repos', getRepoId(repoRoot));
  const raceCoordination = path.join(raceHome, 'state', 'storage-access');
  await fsp.mkdir(path.join(raceHome, 'state'), { recursive: true });
  const layout = resolveStorageLayout({ home: raceHome, env: {} });
  const plan = await planStorageConfiguration({ layout, category: 'cache', target: destination, repoRoot });
  assert.equal(plan.ready, true);
  const open = fsp.open;
  let changed = false;
  try {
    fsp.open = async (target, ...args) => {
      if (!changed && target === path.join(raceRoot, 'locks', 'index.lock')) {
        changed = true;
        await applyStorageConfiguration(plan, { approvedPlanId: plan.planId, home: raceHome, category: 'cache', target: destination });
      }
      return open(target, ...args);
    };
    await assert.rejects(acquireIndexLock({ repoCacheRoot: raceRoot,
      storageContext: { repoRoot, userConfig: {}, env: { PAIROFCLEATS_HOME: raceHome } } }), { code: 'ERR_INDEX_STORAGE_SELECTION' });
  } finally { fsp.open = open; }
  assert.equal(changed, true);
  assert.equal(readStorageLocator(raceHome).value.categories.cache.path, destination);
  assert.equal(fs.existsSync(path.join(raceRoot, 'locks', 'index.lock')), false, 'changed selection refuses the old writer before work starts');
  assert.equal((await inspectStorageAccess(raceCache, { coordinationRoot: raceCoordination })).protected, false);

  const isolatedRoot = path.join(temporary, 'explicit-low-level-lock');
  const isolated = await acquireIndexLock({ repoCacheRoot: isolatedRoot, requireSettlement: true });
  assert.equal(isolated.storageSession, undefined, 'a low-level path alone never discovers or authorizes a category parent');
  await isolated.release();
} finally { await rmDirRecursive(temporary); }
console.log('Index writer sessions coordinate canonical launch categories without parent discovery.');
