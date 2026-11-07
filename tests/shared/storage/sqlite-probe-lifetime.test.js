import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import Database from 'better-sqlite3';
import { readSqliteCounts, readSqliteModeCount, readSqliteDenseModeCount, readSqliteTableCount,
  hasVectorTableAtPath } from '../../../src/storage/sqlite/build/runner/sqlite-probes.js';
import { probeSqliteTargetRuntime } from '../../../src/storage/sqlite/build/runner/build.js';
import { validateSqliteRowLedgerPostImport } from '../../../src/storage/sqlite/build/runner/row-ledger.js';
import { writeSqliteIndexFormat } from '../../../src/storage/sqlite/index-format.js';
import { SCHEMA_VERSION } from '../../../src/storage/sqlite/schema.js';
import { resolveRepoCacheRootPath } from '../../../src/shared/repo-paths.js';
import { repoAccessPaths } from '../../../src/shared/cache/repo-access.js';
import { inspectStorageAccess, withExclusiveStorageAccess } from '../../../src/shared/storage/access.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';

const probes = { counts: readSqliteCounts, mode: readSqliteModeCount, dense: readSqliteDenseModeCount,
  table: readSqliteTableCount, vector: hasVectorTableAtPath, runtime: probeSqliteTargetRuntime };
const selected = process.env.PAIROFCLEATS_TEST_ID?.split('sqlite-probe-lifetime/')[1];
assert.ok([...Object.keys(probes), 'admission', 'metadata', 'pending'].includes(selected));
const { dir } = await prepareIsolatedTestCacheDir(`sqlite-probe-${selected}`);
const repoRoot = path.join(dir, 'repo'), home = path.join(dir, 'home'), cache = path.join(dir, 'cache');
await fsp.mkdir(repoRoot);
applyTestEnv({ extraEnv: { PAIROFCLEATS_HOME: home, PAIROFCLEATS_TRUSTED_CONFIG: null } });
const userConfig = { cache: { root: cache } }, repo = resolveRepoCacheRootPath(repoRoot, userConfig);
const dbPath = path.join(repo, 'builds', 'generation', 'index-sqlite', 'index-code.db');
const coordinationRoot = path.join(home, 'state', 'storage-access');
const roots = [cache, path.join(cache, 'repos'), repo, dbPath];
await fsp.mkdir(path.dirname(dbPath), { recursive: true });
const seed = new Database(dbPath);
try {
  seed.exec("CREATE TABLE chunks(mode TEXT); INSERT INTO chunks VALUES ('code'),('code'),('prose'); CREATE TABLE dense_vectors(mode TEXT); INSERT INTO dense_vectors VALUES ('code')");
  writeSqliteIndexFormat(seed); seed.pragma(`user_version = ${SCHEMA_VERSION}`);
} finally { seed.close(); }
const active = () => {
  for (const root of roots) assert.ok(fs.readdirSync(repoAccessPaths(root, { coordinationRoot }).leases).length,
    'every actual probe constructor, query and native close retains canonical storage');
};
const protection = async expected => {
  for (const root of roots) assert.equal((await inspectStorageAccess(root, { coordinationRoot })).protected, expected);
};
const originalClose = Database.prototype.close, originalPrepare = Database.prototype.prepare,
  originalPragma = Database.prototype.pragma, originalRm = fs.rmSync;
let database, opens = 0, closes = 0, queryFailure = null, nativeFailure = null, denyMetadata = false;
let originalSettled = false, reported = () => originalSettled;
const primary = Object.freeze(Object.defineProperties(new Error('original independent probe query remains pending'), {
  cacheOwnershipPending: { value: true }, cacheOwnershipReleased: { get: () => reported }
}));
const nativeError = Object.freeze(new Error('original native probe close failed'));
const ordinary = Object.freeze(new Error('ordinary query unavailable'));
const instrumented = function (...args) { active(); opens++; database = new Database(...args); return database; };
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
Database.prototype.close = function () {
  if (this.name === dbPath) { active(); closes++; if (nativeFailure) throw nativeFailure; }
  return originalClose.call(this);
};
Database.prototype.prepare = function (sql, ...args) {
  if (this.name === dbPath) {
    active(); this.close = () => assert.fail('late replacement cannot become the probe close owner');
    if (queryFailure && /FROM (chunks|dense_vectors)/.test(sql)) throw queryFailure;
  }
  return originalPrepare.call(this, sql, ...args);
};
Database.prototype.pragma = function (sql, ...args) {
  if (this.name === dbPath && queryFailure && sql === 'page_size') throw queryFailure;
  return originalPragma.call(this, sql, ...args);
};
fs.rmSync = (file, ...args) => {
  if (denyMetadata && typeof file === 'string' && file.startsWith(coordinationRoot) && file.includes(`${path.sep}leases${path.sep}`)) {
    throw Object.assign(new Error('original probe metadata release failed'), { code: 'EACCES' });
  }
  return originalRm(file, ...args);
};
const input = { Database: instrumented, dbPath, repoRoot, userConfig, mode: 'code', tableName: 'dense_vectors',
  hasVectorTable(db) { active(); if (queryFailure) throw queryFailure; return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE name='dense_vectors'").get()); } };
const assertPositive = (key, value) => {
  if (key === 'runtime') { assert.equal(value.source, 'pragma'); assert.ok(value.pageSize >= 512); }
  else assert.deepEqual(value, { counts: { code: 2, prose: 1 }, mode: 2, dense: 1, table: 1, vector: true }[key]);
};
try {
  if (selected === 'admission') {
    const held = await withExclusiveStorageAccess(cache, async () => {
      for (const probe of Object.values(probes)) assert.throws(() => probe(input), { code: 'ERR_REPO_CACHE_CLEANUP_BUSY' });
      assert.equal(opens, 0, 'all probe variants reject before a native constructor');
      assert.throws(() => validateSqliteRowLedgerPostImport({ ...input,
        rowLedger: { mode: 'code', expected: { chunks: 2, dense: 1 } } }), { code: 'ERR_REPO_CACHE_CLEANUP_BUSY' },
      'row-ledger dispatch forwards the actual effective launch configuration');
      return true;
    }, { coordinationRoot });
    assert.equal(held.result, true); await protection(false);
  } else if (selected === 'metadata') {
    denyMetadata = true;
    let failure;
    assert.throws(() => readSqliteModeCount(input), error => { failure = error; return true; });
    const storage = find(failure, 'nativeStorageOwner'), physical = find(failure, 'sqliteCacheOwner');
    assert.ok(storage); assert.ok(physical); assert.equal(database.open, false); assert.equal(closes, 1);
    await protection(true); assert.throws(() => storage.releaseAfterClosure());
    denyMetadata = false; assert.equal(storage.releaseAfterClosure(), true);
    assert.equal(physical.release().settled, true); assert.equal(closes, 1, 'metadata retry never repeats physical close');
    await protection(false);
  } else if (selected === 'pending') {
    queryFailure = primary;
    let failure;
    assert.throws(() => readSqliteModeCount(input), error => { failure = error; return contains(error, primary); });
    assert.equal(database.open, false); assert.equal(closes, 1); await protection(true);
    const storage = find(failure, 'nativeStorageOwner'), physical = find(failure, 'sqliteCacheOwner');
    reported = () => true;
    assert.throws(() => storage.releaseAfterClosure(), 'replacing an independent report callback cannot confirm its original owner');
    originalSettled = true; storage.releaseAfterClosure(); physical.release();
    assert.equal(closes, 1); await protection(false);
  } else {
    const probe = probes[selected]; assertPositive(selected, probe(input));
    assert.equal(database.open, false); assert.equal(closes, 1); await protection(false);
    queryFailure = ordinary;
    const unavailable = probe(input);
    if (selected === 'runtime') assertPositive(selected, unavailable);
    else assert.deepEqual(unavailable, selected === 'counts' ? {} : selected === 'vector' ? false : null);
    assert.equal(database.open, false); assert.equal(closes, 2); await protection(false);
    queryFailure = primary; nativeFailure = nativeError;
    let failure;
    assert.throws(() => probe(input), error => { failure = error; return contains(error, primary) && contains(error, nativeError); },
      'a query and failed native close preserve both exact original causes');
    assert.equal(database.open, true); assert.equal(closes, 3); await protection(true);
    assert.ok(find(failure, 'sqliteCacheOwner')); assert.equal(primary.nativeCleanupError, undefined);
  }
} finally {
  denyMetadata = false; fs.rmSync = originalRm;
  if (database?.open) originalClose.call(database);
  Database.prototype.close = originalClose; Database.prototype.prepare = originalPrepare; Database.prototype.pragma = originalPragma;
}
console.log(`SQLite probe ${selected} retains original resource ownership while preserving ordinary unavailability semantics.`);
