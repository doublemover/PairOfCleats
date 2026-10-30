import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import Database from 'better-sqlite3';
import { open } from 'lmdb';
import { runNativeDatabaseCommand } from '../../../tools/shared/native-database-lifetime.js';
import { resolveRepoCacheRootPath } from '../../../src/shared/repo-paths.js';
import { inspectStorageAccess, withExclusiveStorageAccess } from '../../../src/shared/storage/access.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';

const caseId = process.env.PAIROFCLEATS_TEST_ID?.split('native-command-sessions/')[1];
const configured = caseId?.startsWith('configured-');
const selected = configured ? caseId.slice('configured-'.length) : caseId;
assert.ok(['sqlite', 'lmdb', 'admission-race', 'metadata', 'primary-and-metadata', 'native-unknown', 'scope-authority'].includes(selected));
const { dir } = await prepareIsolatedTestCacheDir(`native-command-session-${caseId}`);
const repoRoot = path.join(dir, 'repo'), home = path.join(dir, 'home'), cache = path.join(dir, 'cache');
await fsp.mkdir(repoRoot);
applyTestEnv({ extraEnv: { PAIROFCLEATS_HOME: home, PAIROFCLEATS_TRUSTED_CONFIG: null } });
const userConfig = { cache: { root: cache } }, repoCacheRoot = resolveRepoCacheRootPath(repoRoot, userConfig);
const target = configured ? path.join(dir, 'configured-native', selected === 'lmdb' ? 'index-code' : 'index-code.db')
  : path.join(repoCacheRoot, 'builds', 'generation', selected === 'lmdb' ? 'index-lmdb/index-code' : 'index-sqlite/index-code.db');
if (configured) userConfig[selected === 'lmdb' ? 'lmdb' : 'sqlite'] = { codeDbPath: target };
const nativeNamespace = selected === 'lmdb' ? target : path.dirname(target);
await fsp.mkdir(path.dirname(target), { recursive: true });
const coordinationRoot = path.join(home, 'state', 'storage-access');
const scope = () => ({ repoRoot, userConfig, repoCacheRoot, targets: [target] });
const assertProtection = async expected => {
  for (const root of [cache, path.join(cache, 'repos'), repoCacheRoot, target]) {
    assert.equal((await inspectStorageAccess(root, { coordinationRoot })).protected, expected,
      'the native command owns its launch-selected repository/resource/category lifetime');
  }
  if (configured) assert.equal((await inspectStorageAccess(nativeNamespace, { coordinationRoot })).protected, expected);
  assert.equal((await inspectStorageAccess(dir, { coordinationRoot })).protected, false);
};
const originalClose = Database.prototype.close, originalRm = fs.rmSync;
const nativeFailure = Object.freeze(new Error('original native command close failed'));
const primary = Object.freeze(new Error('original command work failed'));
let database, nativeCloses = 0, denyMetadata = false;
Database.prototype.close = function () {
  if (this.name === target) {
    nativeCloses++;
    if (selected === 'native-unknown') throw nativeFailure;
  }
  return originalClose.call(this);
};
fs.rmSync = (file, ...args) => {
  if (denyMetadata && typeof file === 'string' && file.startsWith(coordinationRoot) && file.includes(`${path.sep}leases${path.sep}`)) {
    throw Object.assign(new Error('original command metadata release failed'), { code: 'EACCES' });
  }
  return originalRm(file, ...args);
};
const contains = (value, expected, seen = new Set()) => {
  if (value === expected) return true;
  if (!value || typeof value !== 'object' || seen.has(value)) return false;
  seen.add(value);
  return contains(value.cause, expected, seen) || value instanceof AggregateError && value.errors.some(error => contains(error, expected, seen));
};
try {
  if (selected === 'admission-race') {
    let opened = false;
    const exclusive = await withExclusiveStorageAccess(configured ? nativeNamespace : cache, async () => {
      await assert.rejects(runNativeDatabaseCommand({ commandIdentity: 'sqlite.compact' }, resources => {
        try { resources.admitScope(scope()); }
        catch (error) {
          assert.throws(() => resources.open(() => { opened = true; return new Database(target); }), /paths must be admitted/);
          throw error;
        }
        database = resources.open(() => { opened = true; return new Database(target); });
      }), { code: 'ERR_REPO_CACHE_CLEANUP_BUSY' });
      assert.equal(opened, false, 'failed admission cannot be caught to open a native handle');
      return 'exclusive';
    }, { coordinationRoot });
    assert.equal(exclusive.result, 'exclusive'); await assertProtection(false);
  } else if (selected === 'scope-authority') {
    await runNativeDatabaseCommand({ commandIdentity: 'sqlite.compact' }, resources => {
      assert.throws(() => resources.admitScope({ ...scope(), targets: new Array(17).fill(target) }), TypeError);
      assert.throws(() => resources.open(() => assert.fail('invalid scope cannot open a native database')), /paths must be admitted/);
      resources.admitScope(scope());
      assert.throws(() => resources.admitScope(scope()), /once before handle acquisition/);
      assert.throws(() => resources.admitScope({}), /launch-selected repository context/);
      assert.throws(() => resources.open(() => assert.fail('retargeting cannot reopen admission')), /paths must be admitted/);
    });
    await assertProtection(false);
  } else if (selected === 'lmdb') {
    await runNativeDatabaseCommand({ commandIdentity: 'lmdb.build' }, async resources => {
      resources.admitScope(scope());
      database = resources.open(() => open({ path: target, mapSize: 1024 * 1024 }));
      database.putSync('fact', 'retained');
      await assertProtection(true);
      assert.equal((await withExclusiveStorageAccess(cache, () => assert.fail('live native command prevents category exclusion'),
        { coordinationRoot })).protected, true);
    });
    assert.equal(database.status, 'closed'); await assertProtection(false);
    const reopened = open({ path: target, readOnly: true });
    try { assert.equal(reopened.get('fact'), 'retained'); } finally { await reopened.close(); }
  } else {
    const operation = runNativeDatabaseCommand({ commandIdentity: 'sqlite.compact' }, async resources => {
      resources.admitScope(scope());
      database = resources.open(() => new Database(target));
      database.exec('CREATE TABLE facts(value TEXT)');
      database.prepare('INSERT INTO facts VALUES (?)').run('retained');
      await assertProtection(true);
      database.close = () => assert.fail('late native method cannot replace the captured command owner');
      if (['metadata', 'primary-and-metadata'].includes(selected)) denyMetadata = true;
      if (selected === 'primary-and-metadata') throw primary;
    });
    if (selected === 'sqlite') {
      await operation;
      assert.equal(database.open, false); assert.equal(nativeCloses, 1); await assertProtection(false);
    } else {
      let failure;
      await assert.rejects(operation, error => { failure = error; return true; });
      const owner = failure.nativeDatabaseLifetime;
      assert.ok(owner); assert.equal(owner.isSettled(), false); await assertProtection(true);
      assert.equal(Object.getOwnPropertyDescriptor(failure, 'nativeDatabaseLifetime').enumerable, false);
      assert.equal(JSON.stringify(failure).includes('nativeDatabaseLifetime'), false);
      assert.equal(nativeCloses, 1);
      if (selected === 'native-unknown') {
        assert.equal(database.open, true); assert.ok(contains(failure, nativeFailure));
        await assert.rejects(owner.recoverStorageMetadata(), error => contains(error, nativeFailure));
        assert.equal(nativeCloses, 1, 'metadata recovery never retries unknown native close');
        assert.equal(owner.isSettled(), false); await assertProtection(true);
      } else {
        assert.equal(database.open, false);
        if (selected === 'primary-and-metadata') {
          assert.ok(contains(failure, primary)); assert.equal(primary.nativeSettlementError, undefined);
        }
        await assert.rejects(owner.recoverStorageMetadata());
        assert.equal(nativeCloses, 1); assert.equal(owner.isSettled(), false);
        denyMetadata = false;
        const first = owner.recoverStorageMetadata();
        assert.equal(owner.recoverStorageMetadata(), first, 'concurrent metadata recovery joins its original operation');
        assert.deepEqual(await first, { settled: true, pending: false });
        assert.equal(owner.isSettled(), true); assert.equal(failure.cacheOwnershipReleased(), true);
        assert.equal(nativeCloses, 1, 'confirmed metadata-only recovery does not close the database again');
        await assertProtection(false);
        await assert.rejects(operation, error => error === failure, 'resource recovery cannot change the failed command result');
      }
    }
  }
} finally {
  denyMetadata = false; fs.rmSync = originalRm;
  if (database instanceof Database && database.open) originalClose.call(database);
  Database.prototype.close = originalClose;
}
console.log(`Native command ${selected}: admission, actual native close, metadata-only recovery and original failures remain distinct.`);
