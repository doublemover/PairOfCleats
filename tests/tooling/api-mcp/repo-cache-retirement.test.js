import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRepoCacheManager } from '../../../src/shared/repo-cache-config.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { getPendingSqliteCacheOwners } from '../../../src/retrieval/sqlite-cache-close-owner.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';

const root = await makeTempDir('repo-cache-retirement-'), managers = [], allowClose = [];
applyTestEnv({ cacheRoot: path.join(root, 'cache') });
const originalOwners = new Set(getPendingSqliteCacheOwners());
const contains = (rootError, expected) => {
  const queue = [rootError], seen = new Set();
  while (queue.length) {
    const value = queue.pop(); if (value === expected) return true;
    if (!value || typeof value !== 'object' || seen.has(value)) continue;
    seen.add(value);
    if (Object.hasOwn(value, 'cause')) queue.push(value.cause);
    if (Array.isArray(value.errors)) queue.push(...value.errors);
  }
  return false;
};
const catchFailure = action => {
  let failed = false, value;
  try { action(); } catch (error) { failed = true; value = error; }
  assert.equal(failed, true); return value;
};
const repo = async name => {
  const repoRoot = path.join(root, name);
  await fs.mkdir(repoRoot); await fs.writeFile(path.join(repoRoot, 'package.json'), JSON.stringify({ name }));
  return repoRoot;
};
const managerFor = repoRoot => {
  const manager = createRepoCacheManager({ defaultRepo: repoRoot, repoCache: { maxEntries: 1 } });
  managers.push(manager); return manager;
};
try {
  const firstRepo = await repo('first'), secondRepo = await repo('second');
  const file = path.join(firstRepo, 'authored.db'); await fs.writeFile(file, 'inert identity');
  for (const primary of [null, undefined, false, 0, '', Object.freeze(new Error('original close failed'))]) {
    const manager = managerFor(firstRepo), entry = manager.getRepoCaches(firstRepo);
    let allowed = false, failedCloses = 0, healthyCloses = 0;
    allowClose.push(() => { allowed = true; });
    const db = { close() { assert.equal(this, db); failedCloses++; if (!allowed) throw primary; return db; } };
    entry.sqliteCache.set(file, db);
    entry.sqliteCache.set(`${file}-healthy`, { close() { healthyCloses++; } });
    const failure = catchFailure(() => manager.closeRepoCaches());
    assert.equal(failure.code, 'ERR_REPO_CACHE_RETIREMENT'); assert.equal(contains(failure, primary), true);
    assert.equal(failedCloses, 1); assert.equal(healthyCloses, 1);
    const owner = entry.sqliteCache.pendingOwners()[0];
    assert.equal(owner.db, db); assert.ok(getPendingSqliteCacheOwners().includes(owner));
    assert.equal(failure.cacheOwnershipReleased(), false);
    assert.equal(manager.getRetirementReceipt().failedCloseOwners, 1);
    catchFailure(() => manager.closeRepoCaches()); assert.equal(failedCloses, 1, 'manager drain cannot retry native close');
    allowed = true; owner.release(); assert.equal(failedCloses, 2);
    assert.equal(failure.cacheOwnershipReleased(), true);
    assert.equal(manager.closeRepoCaches().status, 'settled');
    assert.equal(manager.getRetirementReceipt().retiringEntries, 0);
  }
  {
    const manager = managerFor(firstRepo), entry = manager.getRepoCaches(firstRepo);
    let closes = 0;
    const lease = entry.sqliteCache.setAndAcquire(file, { close() { closes++; } });
    const receipt = manager.closeRepoCaches();
    assert.equal(receipt.status, 'retiring'); assert.equal(receipt.activeLeaseOwners, 1);
    assert.equal(receipt.failedCloseOwners, 0); assert.equal(closes, 0);
    assert.notEqual(manager.getRepoCaches(firstRepo), entry);
    lease.release(); assert.equal(closes, 1);
    assert.equal(manager.closeRepoCaches().status, 'settled');
  }
  {
    const manager = managerFor(firstRepo), entry = manager.getRepoCaches(firstRepo);
    let allowed = false, calls = 0; allowClose.push(() => { allowed = true; });
    const sentinel = Object.freeze(new Error('implicit eviction close'));
    entry.sqliteCache.set(file, { close() { calls++; if (!allowed) throw sentinel; } });
    manager.getRepoCaches(secondRepo);
    assert.equal(calls, 1); assert.equal(manager.getRetirementReceipt().failedCloseOwners, 1);
    assert.equal(contains(catchFailure(() => manager.closeRepoCaches()), sentinel), true);
    assert.equal(calls, 1); allowed = true; entry.sqliteCache.pendingOwners()[0].release();
    assert.equal(manager.closeRepoCaches().status, 'settled');
  }
  {
    const manager = managerFor(firstRepo), entry = manager.getRepoCaches(firstRepo);
    const publish = async id => {
      const buildRoot = path.join(entry.buildsRoot, id);
      await fs.mkdir(path.join(buildRoot, 'index-code'), { recursive: true });
      await fs.writeFile(path.join(buildRoot, 'index-code', 'chunk_meta.json'), '[]');
      await fs.writeFile(entry.buildPointerPath, JSON.stringify({ artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
        buildId: id, buildRoot: path.relative(entry.repoCacheRoot, buildRoot).replace(/\\/g, '/') }));
      await manager.refreshBuildPointer(entry);
    };
    await publish('build-a');
    let allowed = false, oldCloses = 0, newCloses = 0; allowClose.push(() => { allowed = true; });
    entry.sqliteCache.set(file, { close() { oldCloses++; if (!allowed) throw new Error('retired generation'); } });
    await publish('build-b');
    assert.equal(entry.buildId, 'build-b'); assert.equal(oldCloses, 1);
    assert.equal(manager.getRetirementReceipt().failedCloseOwners, 1);
    entry.sqliteCache.set(`${file}-new`, { close() { newCloses++; } });
    catchFailure(() => manager.closeRepoCaches()); assert.equal(newCloses, 1); assert.equal(oldCloses, 1);
    allowed = true; entry.sqliteCache.pendingOwners()[0].release();
    assert.equal(manager.closeRepoCaches().status, 'settled');
  }
} finally {
  for (const allow of allowClose) allow();
  for (const owner of getPendingSqliteCacheOwners()) if (!originalOwners.has(owner)) owner.release();
  for (const manager of managers) manager.closeRepoCaches();
  await rmDirRecursive(root);
}
console.log('Real repository manager/LRU/SQLite owners report failed retirement, preserve leases and reconcile original close owners.');
