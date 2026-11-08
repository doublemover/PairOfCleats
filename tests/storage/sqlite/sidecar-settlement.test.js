import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import Database from 'better-sqlite3';
import { removeSqliteSidecars, replaceSqliteDatabase } from '../../../src/storage/sqlite/utils.js';
import { withSqliteStorageOperation } from '../../../src/storage/sqlite/build/storage-operation.js';
import { resolveRepoCacheRootPath } from '../../../src/shared/repo-paths.js';
import { resolveCacheTempRoot } from '../../../src/shared/cache-roots.js';
import { inspectStorageAccess } from '../../../src/shared/storage/access.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { runNode } from '../../helpers/run-node.js';

const selected = process.env.PAIROFCLEATS_TEST_ID?.split('sidecar-settlement/')[1];
assert.ok(['drain', 'frozen-errors', 'warning-failure', 'pending-error', 'publication-original-close', 'publication-primary'].includes(selected));
const { dir } = await prepareIsolatedTestCacheDir(`sqlite-sidecar-${selected}`);
const repoRoot = path.join(dir, 'repo'), home = path.join(dir, 'home'), cache = path.join(dir, 'cache');
await fs.mkdir(repoRoot);
applyTestEnv({ cacheRoot: cache, extraEnv: { PAIROFCLEATS_HOME: home, PAIROFCLEATS_TRUSTED_CONFIG: null } });
const userConfig = { cache: { root: cache } }, context = { repoRoot, userConfig };
const repo = resolveRepoCacheRootPath(repoRoot, userConfig), tmp = resolveCacheTempRoot();
const staged = path.join(repo, 'builds', 'generation', 'index-sqlite', 'staged.db'), final = path.join(path.dirname(staged), 'final.db');
await fs.mkdir(path.dirname(staged), { recursive: true });
const coordinationRoot = path.join(home, 'state', 'storage-access');
const protection = async expected => {
  for (const root of [cache, repo, tmp, staged]) assert.equal((await inspectStorageAccess(root, { coordinationRoot })).protected, expected);
};
const contains = (value, expected, seen = new Set()) => {
  if (value === expected) return true;
  if (!value || typeof value !== 'object' || seen.has(value)) return false;
  seen.add(value);
  return contains(value.cause, expected, seen) || value instanceof AggregateError && value.errors.some(error => contains(error, expected, seen));
};
const find = (value, key, seen = new Set()) => {
  if (!value || typeof value !== 'object' || seen.has(value)) return null;
  seen.add(value);
  return value[key] || find(value.cause, key, seen)
    || (value instanceof AggregateError && value.errors.map(error => find(error, key, seen)).find(Boolean)) || null;
};
const primary = Object.freeze(Object.assign(new Error('original WAL action failed'), { code: 'EACCES' }));
const secondary = Object.freeze(Object.assign(new Error('original SHM action failed'), { code: 'EIO' }));
const warning = Object.freeze(new Error('warning observer failed'));
const originalRm = fs.rm, originalClose = Database.prototype.close, originalPragma = Database.prototype.pragma;
let release = null, database, nativeCloses = 0, independentSettled = false, warningCalls = 0;
try {
  if (selected.startsWith('publication-')) {
    const child = runNode(['--input-type=module', '-e', `
      import Database from 'better-sqlite3';
      const db = new Database(${JSON.stringify(staged)});
      db.pragma('journal_mode=WAL'); db.pragma('wal_autocheckpoint=0');
      db.exec("CREATE TABLE facts(value TEXT); INSERT INTO facts VALUES ('committed-source')");
      process.exit(0);
    `], 'actual SQLite committed WAL seed', process.cwd(), process.env, { allowFailure: true,
      spawnOptions: { cwd: process.cwd(), windowsHide: true, encoding: 'utf8', timeout: 5000 } });
    assert.equal(child.status, 0, child.stderr); assert.ok((await fs.stat(`${staged}-wal`)).size > 0);
    Database.prototype.pragma = function (sql, ...args) {
      if (this.name === staged && sql.startsWith('wal_checkpoint(')) {
        database = this; this.close = () => assert.fail('publication cannot capture a late replacement close');
        if (selected === 'publication-primary') throw primary;
      }
      return originalPragma.call(this, sql, ...args);
    };
    Database.prototype.close = function () {
      if (this.name === staged) { nativeCloses++; if (selected === 'publication-primary') throw secondary; }
      return originalClose.call(this);
    };
    const operation = withSqliteStorageOperation(context, [staged, final], () => replaceSqliteDatabase(staged, final));
    if (selected === 'publication-primary') {
      let failure;
      await assert.rejects(operation, error => { failure = error; return contains(error, primary) && contains(error, secondary); });
      assert.equal(primary.nativeCleanupError, undefined); assert.equal(database.open, true); await protection(true);
      await assert.rejects(find(failure, 'sqliteStorageOperation').recoverStorageMetadata()); assert.equal(nativeCloses, 1);
      assert.equal(await fs.stat(final).then(() => true, () => false), false);
    } else {
      await operation; assert.equal(database.open, false); assert.equal(nativeCloses, 1); await protection(false);
      const readback = new Database(final, { readonly: true });
      try { assert.equal(readback.prepare('SELECT value FROM facts').get().value, 'committed-source'); }
      finally { originalClose.call(readback); }
    }
  } else {
    await fs.writeFile(`${staged}-wal`, 'owned WAL sentinel'); await fs.writeFile(`${staged}-shm`, 'owned SHM sentinel');
    const pending = Object.freeze(Object.defineProperties(new Error('original unlink work remains pending'), {
      cacheOwnershipPending: { value: true }, cacheOwnershipReleased: { value: () => independentSettled }
    }));
    let announced, returned = false;
    const ready = new Promise(resolve => { announced = resolve; });
    const gate = new Promise(resolve => { release = resolve; });
    fs.rm = async (file, ...args) => {
      if (file === `${staged}-wal`) throw selected === 'pending-error' ? pending : primary;
      if (file === `${staged}-shm`) {
        announced();
        if (selected === 'drain') await gate;
        if (selected === 'frozen-errors') throw secondary;
      }
      return originalRm(file, ...args);
    };
    const operation = withSqliteStorageOperation(context, [staged], () => removeSqliteSidecars(staged, { logger: {
      warn() { warningCalls++; if (selected === 'warning-failure') throw warning; }
    } }));
    operation.finally(() => { returned = true; }).catch(() => {});
    if (selected === 'drain') {
      await ready; await new Promise(resolve => setImmediate(resolve)); assert.equal(returned, false); await protection(true);
      release(); release = null;
    }
    let failure; await assert.rejects(operation, error => { failure = error; return true; });
    if (selected === 'pending-error') {
      assert.ok(contains(failure, pending)); assert.equal(warningCalls, 0); await protection(true);
      const owner = find(failure, 'sqliteStorageOperation'); await assert.rejects(owner.recoverStorageMetadata());
      independentSettled = true; await owner.recoverStorageMetadata(); await protection(false);
    } else {
      assert.ok(contains(failure, primary));
      if (selected === 'frozen-errors') assert.ok(contains(failure, secondary));
      if (selected === 'warning-failure') assert.ok(contains(failure, warning));
      assert.equal(warningCalls, selected === 'frozen-errors' ? 2 : 1); await protection(false);
    }
  }
} finally {
  release?.(); fs.rm = originalRm; Database.prototype.close = originalClose; Database.prototype.pragma = originalPragma;
  if (database?.open) originalClose.call(database);
}
console.log(`SQLite ${selected} joins every owned sidecar action and preserves original publication/native/error authority.`);
