import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import Database from 'better-sqlite3';
import { withSqliteStorageOperation, getSqliteStorageOperation } from '../../../src/storage/sqlite/build/storage-operation.js';
import { resolveRepoCacheRootPath } from '../../../src/shared/repo-paths.js';
import { resolveCacheTempRoot } from '../../../src/shared/cache-roots.js';
import { repoAccessPaths } from '../../../src/shared/cache/repo-access.js';
import { inspectStorageAccess, withExclusiveStorageAccess } from '../../../src/shared/storage/access.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';

const selected = process.env.PAIROFCLEATS_TEST_ID?.split('sqlite-operation-lifetime/')[1];
assert.ok(['admission', 'metadata', 'accepted-child', 'ignored-child-failure', 'original-observer', 'late-admission', 'resource-budget'].includes(selected));
const { dir } = await prepareIsolatedTestCacheDir(`sqlite-operation-${selected}`);
const repoRoot = path.join(dir, 'repo'), cache = path.join(dir, 'cache'), home = path.join(dir, 'home');
await fsp.mkdir(repoRoot);
applyTestEnv({ cacheRoot: cache, extraEnv: { PAIROFCLEATS_HOME: home, PAIROFCLEATS_TRUSTED_CONFIG: null } });
const userConfig = { cache: { root: cache } }, context = { repoRoot, userConfig };
const repo = resolveRepoCacheRootPath(repoRoot, userConfig), tmp = resolveCacheTempRoot();
const target = path.join(repo, 'builds', 'generation', 'index-sqlite', 'code.db');
await fsp.mkdir(path.dirname(target), { recursive: true });
const coordinationRoot = path.join(home, 'state', 'storage-access');
const protection = async (expected, includeTarget = true) => {
  for (const root of [cache, path.join(cache, 'repos'), repo, tmp, ...(includeTarget ? [target] : [])]) {
    assert.equal((await inspectStorageAccess(root, { coordinationRoot })).protected, expected, root);
  }
};
const find = (value, key, seen = new Set()) => {
  if (!value || typeof value !== 'object' || seen.has(value)) return null;
  seen.add(value);
  return value[key] || find(value.cause, key, seen)
    || (value instanceof AggregateError && value.errors.map(error => find(error, key, seen)).find(Boolean)) || null;
};
const originalRm = fs.rmSync, leaf = repoAccessPaths(target, { coordinationRoot }).leases;
let denyLeaf = false;
fs.rmSync = (file, ...args) => {
  if (denyLeaf && typeof file === 'string' && file.startsWith(leaf + path.sep)) {
    throw Object.assign(new Error('exact native resource metadata release failed'), { code: 'EACCES' });
  }
  return originalRm(file, ...args);
};
try {
  if (selected === 'admission') {
    await assert.rejects(withSqliteStorageOperation(context, [target], null), TypeError);
    await assert.rejects(withSqliteStorageOperation({ ...context, repoRoot: 'relative' }, [target], () => {}), TypeError);
    for (const category of [cache, tmp]) {
      const held = await withExclusiveStorageAccess(category, async () => {
        await assert.rejects(withSqliteStorageOperation(context, [target], () => assert.fail('blocked operation cannot begin')),
          { code: 'ERR_REPO_CACHE_CLEANUP_BUSY' }); return true;
      }, { coordinationRoot });
      assert.equal(held.result, true); await protection(false);
    }
  } else if (selected === 'metadata') {
    denyLeaf = true; let failure;
    const operation = withSqliteStorageOperation(context, [target], async () => {
      const db = new Database(target); try { db.exec('CREATE TABLE facts(value TEXT)'); } finally { db.close(); }
    });
    await assert.rejects(operation, error => { failure = error; return true; });
    const owner = find(failure, 'sqliteStorageOperation'); assert.ok(owner);
    assert.equal(Object.getOwnPropertyDescriptor(failure, 'sqliteStorageOperation')?.enumerable, false);
    assert.equal(JSON.stringify(failure).includes('sqliteStorageOperation'), false);
    await protection(true); assert.equal(owner.isSettled(), false);
    await assert.rejects(owner.recoverStorageMetadata()); await protection(true);
    denyLeaf = false;
    const first = owner.recoverStorageMetadata(); assert.equal(owner.recoverStorageMetadata(), first);
    assert.deepEqual(await first, { settled: true, pending: false }); await protection(false);
    await assert.rejects(operation, error => error === failure, 'metadata recovery cannot change the original rejected outcome');
  } else if (selected === 'accepted-child') {
    let release, announced, returned = false, db;
    const ready = new Promise(resolve => { announced = resolve; }), gate = new Promise(resolve => { release = resolve; });
    const operation = withSqliteStorageOperation(context, [target], async owner => {
      assert.equal(getSqliteStorageOperation(), owner);
      void withSqliteStorageOperation(null, [target], async nested => {
        assert.equal(nested, owner); db = new Database(target); announced();
        try { await gate; db.exec('CREATE TABLE facts(value TEXT)'); } finally { db.close(); }
      });
      return 'drained';
    }).then(value => { returned = true; return value; });
    try {
      await ready; await new Promise(resolve => setImmediate(resolve));
      assert.equal(returned, false); assert.equal(db.open, true); await protection(true);
    } finally { release(); await operation; }
    assert.equal(db.open, false); assert.equal(await operation, 'drained'); await protection(false);
  } else if (selected === 'ignored-child-failure') {
    const primary = Object.freeze(new Error('accepted child failed before parent returned'));
    for (const childContext of [null, context]) {
      await assert.rejects(withSqliteStorageOperation(context, [target], () => {
        void withSqliteStorageOperation(childContext, [target], async () => { throw primary; });
      }), error => error === primary);
      await protection(false);
    }
  } else if (selected === 'original-observer') {
    let originalSettled = false, reported = () => originalSettled, failure;
    const primary = Object.freeze(Object.defineProperties(new Error('original independent writer remains pending'), {
      cacheOwnershipPending: { value: true }, cacheOwnershipReleased: { get: () => reported }
    }));
    await assert.rejects(withSqliteStorageOperation(context, [target], () => { throw primary; }), error => { failure = error; return true; });
    const owner = find(failure, 'sqliteStorageOperation'); reported = () => true;
    await assert.rejects(owner.recoverStorageMetadata()); await protection(true);
    originalSettled = true; await owner.recoverStorageMetadata(); await protection(false);
  } else if (selected === 'late-admission') {
    let captured;
    await withSqliteStorageOperation(context, [target], owner => { captured = owner; });
    assert.equal(captured.isSettled(), true); await protection(false);
    assert.throws(() => captured.admitTargets([target]), /no longer admits/);
    assert.throws(() => captured.use(() => assert.fail('no detached native work after settlement')), /budget is unavailable/);
  } else {
    await withSqliteStorageOperation(context, [], owner => {
      for (let batch = 0; batch < 4; batch++) owner.admitTargets(Array.from({ length: 64 }, (_, i) => path.join(tmp, `${batch}-${i}.db`)));
      assert.throws(() => owner.admitTargets([target]), /resource admission budget/);
      assert.throws(() => owner.admitTargets([]), /resource admission budget/, 'failed admission cannot be cleared for another native route');
    });
    await protection(false, false);
  }
} finally { denyLeaf = false; fs.rmSync = originalRm; }
console.log(`SQLite operation ${selected} keeps actual resource and category ownership through accepted work and exact metadata settlement.`);
