import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { compactDatabase } from '../../../tools/build/compact-sqlite-index.js';
import { resolveRepoCacheRootPath } from '../../../src/shared/repo-paths.js';
import { inspectStorageAccess, withExclusiveStorageAccess } from '../../../src/shared/storage/access.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { setupSqliteBuildFixture } from '../../storage/sqlite/helpers/build-fixture.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';

const selected = process.env.PAIROFCLEATS_TEST_ID?.split('native-compaction-session/')[1];
assert.ok(['success', 'frozen-primary'].includes(selected));
const fixture = await setupSqliteBuildFixture({ artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
  tempLabel: 'native-compaction-session-seed', chunkCount: 3 });
const { dir } = await prepareIsolatedTestCacheDir(`native-compaction-session-${selected}`);
const repoRoot = path.join(dir, 'repo'), home = path.join(dir, 'home'), cache = path.join(dir, 'cache');
await fs.mkdir(repoRoot);
applyTestEnv({ extraEnv: { PAIROFCLEATS_HOME: home, PAIROFCLEATS_TRUSTED_CONFIG: null } });
const userConfig = { cache: { root: cache } }, repo = resolveRepoCacheRootPath(repoRoot, userConfig);
const target = path.join(repo, 'builds', 'generation', 'index-sqlite', 'index-code.db');
await fs.mkdir(path.dirname(target), { recursive: true });
await fs.copyFile(fixture.outPath, target);
const coordinationRoot = path.join(home, 'state', 'storage-access');
const protection = async expected => {
  for (const root of [cache, path.join(cache, 'repos'), repo, target]) {
    assert.equal((await inspectStorageAccess(root, { coordinationRoot })).protected, expected);
  }
};
const input = { storageContext: { repoRoot, userConfig }, repoRoot, dbPath: target, mode: 'code',
  vectorExtension: { enabled: false }, logger: { log() {}, warn(message) { assert.fail(message); } } };
const originalClose = fixture.Database.prototype.close, originalExec = fixture.Database.prototype.exec;
const closed = new Set();
const primary = Object.freeze(new Error('original compaction write failed'));
const cleanup = Object.freeze(new Error('original replacement native close failed'));
const closeCounts = new Map();
const contains = (value, expected, seen = new Set()) => {
  if (value === expected) return true;
  if (!value || typeof value !== 'object' || seen.has(value)) return false;
  seen.add(value);
  return contains(value.cause, expected, seen) || value instanceof AggregateError && value.errors.some(error => contains(error, expected, seen));
};
try {
  const before = await fs.readFile(target);
  const held = await withExclusiveStorageAccess(cache, async () => {
    await assert.rejects(compactDatabase(input), { code: 'ERR_REPO_CACHE_CLEANUP_BUSY' });
    assert.deepEqual(await fs.readFile(target), before, 'category exclusion precedes every native access and replacement');
    return true;
  }, { coordinationRoot });
  assert.equal(held.result, true);
  fixture.Database.prototype.close = async function () {
    if (this.name === target || this.name.startsWith(`${target}.compact-`)) {
      await protection(true);
      assert.equal((await withExclusiveStorageAccess(cache, () => assert.fail('actual compaction handles still own the category'),
        { coordinationRoot })).protected, true);
      closed.add(this);
      closeCounts.set(this, (closeCounts.get(this) || 0) + 1);
      if (selected === 'frozen-primary' && this.name !== target) throw cleanup;
    }
    return originalClose.call(this);
  };
  fixture.Database.prototype.exec = function (sql) {
    if (selected === 'frozen-primary' && this.name.startsWith(`${target}.compact-`)) throw primary;
    return originalExec.call(this, sql);
  };
  if (selected === 'frozen-primary') {
    let failure;
    await assert.rejects(compactDatabase(input), error => { failure = error; return contains(error, primary) && contains(error, cleanup); });
    assert.equal(primary.nativeCleanupError, undefined, 'a frozen work failure retains its identity and exact cleanup cause');
    assert.equal(failure.nativeDatabaseLifetime.isSettled(), false);
    await assert.rejects(failure.nativeDatabaseLifetime.recoverStorageMetadata(), error => contains(error, primary) && contains(error, cleanup));
    for (const count of closeCounts.values()) assert.equal(count, 1, 'unconfirmed original native close is never repeated');
    assert.deepEqual(await fs.readFile(target), before, 'failed replacement preserves the original published database');
    await protection(true);
  } else {
    assert.equal((await compactDatabase(input)).skipped, false);
    await protection(false);
  }
  assert.ok(closed.size >= 2, 'the actual source and replacement native handles were observed');
  for (const database of closed) if (selected === 'success' || database.name === target) assert.equal(database.open, false);
  fixture.Database.prototype.close = originalClose;
  const readback = new fixture.Database(target, { readonly: true });
  try {
    assert.deepEqual(readback.prepare('SELECT id, file FROM chunks ORDER BY id').all().map(row => row.file),
      ['src/file-0.js', 'src/file-1.js', 'src/file-2.js']);
  } finally { readback.close(); }
} finally {
  fixture.Database.prototype.close = originalClose;
  fixture.Database.prototype.exec = originalExec;
  for (const database of closed) if (database.open) originalClose.call(database);
  await fs.rm(fixture.tempRoot, { recursive: true, force: true });
}
console.log(`Actual SQLite compaction ${selected} retains launch-selected storage and original work/cleanup ownership.`);
