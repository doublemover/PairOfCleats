import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import Database from 'better-sqlite3';
import { createSqliteBackend } from '../../../src/retrieval/cli-sqlite.js';
import { createSqliteDbCache } from '../../../src/retrieval/sqlite-cache.js';
import { getPendingSqliteCacheOwners, createSqliteCacheCloseOwner } from '../../../src/retrieval/sqlite-cache-close-owner.js';
import { getPendingNativeStorageReaders } from '../../../src/shared/storage/native-reader.js';
import { inspectStorageAccess, withExclusiveStorageAccess } from '../../../src/shared/storage/access.js';
import { resolveRepoCacheRootPath } from '../../../src/shared/repo-paths.js';
import { CREATE_TABLES_SQL, SCHEMA_VERSION } from '../../../src/storage/sqlite/schema.js';
import { writeSqliteIndexFormat } from '../../../src/storage/sqlite/index-format.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';

const caseId = process.env.PAIROFCLEATS_TEST_ID?.split('native-reader-lifetime/')[1];
const configured = caseId?.startsWith('configured-');
const selected = configured ? caseId.slice('configured-'.length) : caseId;
assert.ok(['cache', 'uncached', 'metadata-failure', 'admission-race', 'launch-homes', 'open-failure', 'native-failure', 'original-cache-close'].includes(selected));
const { dir } = await prepareIsolatedTestCacheDir(`native-reader-${selected}`);
const repoRoot = path.join(dir, 'repo'), cache = path.join(dir, 'cache'), home = path.join(dir, 'home');
await fsp.mkdir(repoRoot);
applyTestEnv({ extraEnv: { PAIROFCLEATS_HOME: home, PAIROFCLEATS_TRUSTED_CONFIG: null } });
const userConfig = { cache: { root: cache } }, storageContext = { repoRoot, userConfig };
const repoCacheRoot = resolveRepoCacheRootPath(repoRoot, userConfig);
const dbPath = configured ? path.join(dir, 'configured-sqlite', 'index-code.db')
  : path.join(repoCacheRoot, 'builds', 'generation', 'index-sqlite', 'index-code.db');
if (configured) userConfig.sqlite = { codeDbPath: dbPath };
const protectedCategory = configured ? path.dirname(dbPath) : cache;
await fsp.mkdir(path.dirname(dbPath), { recursive: true });
const originalClose = Database.prototype.close, originalPrepare = Database.prototype.prepare;
const writer = new Database(dbPath);
try {
  writer.exec(CREATE_TABLES_SQL); writeSqliteIndexFormat(writer); writer.pragma(`user_version = ${SCHEMA_VERSION}`);
  writer.prepare('INSERT INTO chunks (id, chunk_id, mode, file) VALUES (?, ?, ?, ?)').run(1, 'chunk-code', 'code', 'code.js');
} finally { originalClose.call(writer); }
const coordination = launchHome => path.join(launchHome, 'state', 'storage-access');
const protectedAt = async (root, launchHome = home) => (await inspectStorageAccess(root, { coordinationRoot: coordination(launchHome) })).protected;
const assertRoots = async (protectedValue, launchHome = home) => {
  if (selected === 'original-cache-close') protectedValue = false;
  const roots = configured ? [protectedCategory, dbPath, `${dbPath}-wal`, `${dbPath}-shm`, `${dbPath}-journal`]
    : [cache, path.join(cache, 'repos'), repoCacheRoot, dbPath];
  for (const root of roots) {
    assert.equal(await protectedAt(root, launchHome), protectedValue, `${root} must retain its original resource/category lifetime`);
  }
  assert.equal(await protectedAt(dir, launchHome), false, 'shared filesystem parents gain no authority');
  if (configured) assert.equal(await protectedAt(cache, launchHome), false, 'configured backend readers pin their own native namespace');
};
const usesCache = !['uncached', 'native-failure', 'open-failure', 'admission-race'].includes(selected);
const dbCache = usesCache ? createSqliteDbCache() : null;
const options = { useSqlite: true, needsCode: true, needsProse: false, needsExtractedProse: false,
  sqliteCodePath: dbPath, sqliteFtsRequested: false, backendForcedSqlite: true,
  vectorExtension: {}, vectorAnnEnabled: false, dbCache,
  storageContext: selected === 'original-cache-close' ? null : storageContext };
let backend, sibling, database, replacements = 0, nativeCloses = 0, prepares = 0;
let denyNative = selected === 'native-failure', originalSettled = false, reported = () => originalSettled;
const nativeFailure = Object.freeze(Object.defineProperties(new Error('original native close remains outstanding'), {
  cacheOwnershipPending: { value: true }, cacheOwnershipReleased: { get: () => reported }
}));
Database.prototype.close = function () {
  if (this.name === dbPath) { nativeCloses++; if (denyNative) throw nativeFailure; }
  return originalClose.call(this);
};
Database.prototype.prepare = function (...args) {
  if (this.name === dbPath) {
    prepares++;
    // Initialization happens after constructor-time ownership. Neither cache
    // transfer nor later disposal may adopt this replacement.
    if (selected !== 'native-failure') this.close = () => { replacements++; throw new Error('late replacement close must remain unused'); };
  }
  return originalPrepare.apply(this, args);
};
const originalRm = fs.rmSync;
let denyMetadata = false;
try {
  if (selected === 'admission-race') {
    const exclusive = await withExclusiveStorageAccess(protectedCategory, async () => {
      await assert.rejects(createSqliteBackend(options).then(value => { backend = value; return value; }),
        { code: 'ERR_REPO_CACHE_CLEANUP_BUSY' });
      assert.equal(prepares, 0, 'category exclusion rejects before any native initialization');
      return 'exclusive';
    }, { coordinationRoot: coordination(home) });
    assert.equal(exclusive.result, 'exclusive');
    await assertRoots(false);
  } else if (selected === 'open-failure') {
    for (const target of [path.join(path.dirname(dbPath), 'missing.db'), dbPath]) {
      if (target === dbPath) {
        const invalid = new Database(dbPath); try { invalid.exec('DROP TABLE index_format_meta'); } finally { originalClose.call(invalid); }
      }
      await assert.rejects(createSqliteBackend({ ...options, sqliteCodePath: target }),
        error => target === dbPath ? error.code === 'ERR_INDEX_FORMAT_UNSUPPORTED' : error.code === 'ENOENT');
      await assertRoots(false);
    }
  } else {
    backend = await createSqliteBackend(options); database = backend.dbCode;
    if (selected === 'original-cache-close') assert.throws(() => createSqliteCacheCloseOwner(database,
      { canClose: () => true, onClosed() {} }), error => {
      assert.match(error.message, /already has its original native close owner/);
      assert.equal(Object.getOwnPropertyDescriptor(error, 'sqliteCacheOwner').enumerable, false);
      assert.equal(JSON.stringify(error).includes('sqliteCacheOwner'), false);
      return true;
    });
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM chunks').get().count, 1);
    await assertRoots(true);
    if (selected !== 'original-cache-close') assert.equal((await withExclusiveStorageAccess(protectedCategory, () => assert.fail('live readers prevent category relocation'),
      { coordinationRoot: coordination(home) })).protected, true);
    if (selected === 'cache') {
      for (let request = 0; request < 32; request++) {
        const reused = await createSqliteBackend(options);
        assert.equal(reused.dbCode, database); reused.dispose();
      }
      assert.equal(getPendingNativeStorageReaders().filter(owner => owner.target === dbPath).length, 1,
        'warm requests reuse one original launch lease and settlement hook');
      const beforeInvalid = prepares;
      await assert.rejects(createSqliteBackend({ ...options, storageContext: { ...storageContext, env: null } }), TypeError);
      assert.equal(prepares, beforeInvalid, 'cached reuse cannot bypass launch-context validation');
    }
    const secondHome = path.join(dir, 'other-home');
    if (['launch-homes', 'metadata-failure'].includes(selected)) {
      sibling = await createSqliteBackend({ ...options,
        storageContext: { ...storageContext, env: { ...process.env, PAIROFCLEATS_HOME: secondHome } } });
      assert.equal(sibling.dbCode, database, 'same cached native handle retains each launch context');
      await assertRoots(true, secondHome);
      sibling.dispose();
      await assertRoots(true, secondHome);
    }
    if (selected === 'native-failure') {
      let failure;
      assert.throws(() => backend.dispose(), error => { failure = error; return true; });
      assert.equal(nativeCloses, 1); await assertRoots(true);
      const physical = getPendingSqliteCacheOwners().find(owner => owner.db === database);
      assert.ok(physical);
      reported = () => true; denyNative = false;
      assert.throws(() => physical.release(), 'replacement reporting cannot settle the original native observer');
      assert.equal(nativeCloses, 1); await assertRoots(true);
      originalSettled = true;
      assert.equal(physical.release().settled, true);
      assert.equal(nativeCloses, 2, 'explicit reconciliation uses the captured original close exactly once more');
      await assertRoots(false);
      assert.throws(() => backend.dispose(), error => error === failure, 'failed invocation remains failed after physical recovery');
    } else {
      backend.dispose();
      if (usesCache) { assert.equal(database.open, true); await assertRoots(true); }
      if (selected === 'metadata-failure') {
        denyMetadata = true;
        fs.rmSync = (target, ...args) => {
          if (denyMetadata && typeof target === 'string' && target.startsWith(coordination(home)) && target.includes(`${path.sep}leases${path.sep}`)) {
            throw Object.assign(new Error('controlled original metadata release failure'), { code: 'EACCES' });
          }
          return originalRm(target, ...args);
        };
        let failedRelease;
        assert.throws(() => dbCache.dispose(), error => { failedRelease = error; return true; });
        const inspect = [failedRelease], seen = new Set();
        let opaque = 0;
        while (inspect.length) {
          const error = inspect.pop();
          if (!error || typeof error !== 'object' || seen.has(error)) continue;
          seen.add(error);
          if (Object.hasOwn(error, 'nativeStorageOwner')) {
            assert.equal(Object.getOwnPropertyDescriptor(error, 'nativeStorageOwner').enumerable, false);
            assert.equal(JSON.stringify(error).includes('nativeStorageOwner'), false);
            opaque++;
          }
          inspect.push(error.cause, ...(error instanceof AggregateError ? error.errors : []));
        }
        assert.ok(opaque > 0, 'original recovery capabilities remain available internally');
        assert.equal(database.open, false); assert.equal(nativeCloses, 1);
        await assertRoots(true); await assertRoots(false, secondHome);
        const owner = getPendingNativeStorageReaders().find(owner => owner.target === dbPath && owner.session.coordinationRoot === coordination(home));
        assert.ok(owner);
        denyMetadata = false;
        assert.equal(owner.releaseAfterClosure(), true, 'explicit recovery retries metadata only after confirmed native closure');
        const physical = getPendingSqliteCacheOwners().find(owner => owner.db === database);
        assert.ok(physical); assert.equal(physical.release().settled, true);
        assert.equal(nativeCloses, 1, 'metadata recovery never calls native close again');
      } else dbCache?.dispose();
      assert.equal(database.open, false); assert.equal(nativeCloses, 1); assert.equal(replacements, 0);
      await assertRoots(false);
      if (sibling) await assertRoots(false, secondHome);
    }
  }
} finally {
  fs.rmSync = originalRm; denyMetadata = false; denyNative = false; originalSettled = true;
  try { backend?.dispose(); } catch {}
  try { sibling?.dispose(); } catch {}
  try { dbCache?.dispose(); } catch {}
  for (const owner of getPendingNativeStorageReaders()) if (owner.target === dbPath) {
    try { owner.releaseAfterClosure(); } catch {}
  }
  for (const owner of getPendingSqliteCacheOwners()) if (owner.db?.name === dbPath) {
    try { owner.release(); } catch {}
  }
  if (database?.open) originalClose.call(database);
  Database.prototype.close = originalClose; Database.prototype.prepare = originalPrepare;
}
console.log(`Native reader ${selected}: original close, cache lifetime, launch category and metadata recovery remain owned.`);
