import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { getRepoId } from '../../../src/shared/repo-paths.js';
import { acquireFileLock } from '../../../src/shared/locks/file-lock.js';
import { createLockReleaseHandle } from '../../../src/index/lock-release.js';
import { acquireIndexStorageSession, attachIndexStorageSession } from '../../../src/index/build/storage-session.js';
import { inspectStorageAccess } from '../../../src/shared/storage/access.js';

// UNVALIDATED: actual metadata lock/timer and category session, no child/native work.
const temporary = await makeTempDir('poc-index-metadata-timeout-');
try {
  const repoRoot = path.join(temporary, 'repo');
  const home = path.join(temporary, 'home');
  const cache = path.join(temporary, 'cache');
  await fs.mkdir(repoRoot);
  const repoCacheRoot = path.join(cache, 'repos', getRepoId(repoRoot));
  const coordinationRoot = path.join(home, 'state', 'storage-access');
  const context = { repoRoot, userConfig: { cache: { root: cache } }, env: { PAIROFCLEATS_HOME: home } };
  const storage = acquireIndexStorageSession(repoCacheRoot, context);
  const raw = await acquireFileLock({ lockPath: path.join(repoCacheRoot, 'locks', 'index.lock'),
    metadata: { scope: 'index', resourceSettlementVersion: 1 } });
  const releaseRaw = raw.release;
  let complete;
  const completion = new Promise(resolve => { complete = resolve; });
  raw.release = async options => { const result = await releaseRaw(options); complete(); return result; };
  const base = createLockReleaseHandle({ lock: raw, releaseLabel: 'index-lock.release', releaseTimeoutMs: 5 });
  const owner = attachIndexStorageSession(base, storage);
  const remove = fs.rm;
  let announce, permit;
  const removing = new Promise(resolve => { announce = resolve; });
  const permitted = new Promise(resolve => { permit = resolve; });
  let removals = 0;
  try {
    fs.rm = async (target, options) => {
      if (target === raw.lockPath) { removals++; announce(); await permitted; }
      return remove(target, options);
    };
    const pending = owner.release();
    pending.catch(() => {});
    await removing;
    let failure;
    try { await pending; } catch (error) { failure = error; }
    assert.equal(failure.code, 'BUILD_CLEANUP_TIMEOUT');
    assert.equal(failure.cacheOwnershipReleased(), false);
    assert.equal((await inspectStorageAccess(cache, { coordinationRoot })).protected, true);
    permit();
    await completion;
    assert.equal(await failure.indexStorageOwner.release(), true);
    assert.equal(failure.cacheOwnershipReleased(), true, 'the actual late metadata removal and category release settle the original error');
    assert.equal(removals, 1, 'late success is observed instead of attempting another unlink of an absent lock');
    assert.equal((await inspectStorageAccess(cache, { coordinationRoot })).protected, false);
  } finally { permit(); fs.rm = remove; await owner.release(); }

  const independent = Object.freeze(Object.assign(new Error('independent unknown resource'), {
    code: 'BUILD_CLEANUP_TIMEOUT', meta: { label: 'index-lock.release' }, cacheOwnershipPending: true
  }));
  let attempts = 0;
  const secondStorage = acquireIndexStorageSession(repoCacheRoot, context);
  const separate = attachIndexStorageSession({ release: async () => { if (++attempts === 1) throw independent; return true; } }, secondStorage);
  let unknown;
  try { await separate.release(); } catch (error) { unknown = error; }
  assert.equal(unknown.cause, independent);
  assert.equal(await separate.release(), true);
  assert.equal(unknown.cacheOwnershipReleased(), false, 'code/label and a later metadata success do not settle an unbranded independent marker');
} finally { await rmDirRecursive(temporary); }
console.log('Owned metadata release timeout observes exact late completion without qualifying unknown resources.');
