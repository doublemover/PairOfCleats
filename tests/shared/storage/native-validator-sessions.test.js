import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import Database from 'better-sqlite3';
import { open, allDbs } from 'lmdb';
import { Packr } from 'msgpackr';
import { buildSqliteReport } from '../../../src/index/validate/sqlite-report.js';
import { buildLmdbReport } from '../../../src/index/validate/lmdb-report.js';
import { loadAndValidateChunkMeta } from '../../../src/index/validate/chunk-meta.js';
import { CREATE_TABLES_SQL, SCHEMA_VERSION } from '../../../src/storage/sqlite/schema.js';
import { writeSqliteIndexFormat } from '../../../src/storage/sqlite/index-format.js';
import { LMDB_META_KEYS, LMDB_ARTIFACT_KEYS, LMDB_SCHEMA_VERSION } from '../../../src/storage/lmdb/schema.js';
import { closeLmdbDatabase } from '../../../src/storage/lmdb/close.js';
import { resolveRepoCacheRootPath } from '../../../src/shared/repo-paths.js';
import { repoAccessPaths } from '../../../src/shared/cache/repo-access.js';
import { inspectStorageAccess, withExclusiveStorageAccess } from '../../../src/shared/storage/access.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { createBaseIndex } from '../../indexing/validate/helpers.js';

const selected = process.env.PAIROFCLEATS_TEST_ID?.split('native-validator-sessions/')[1];
const [family, scenario = 'success'] = selected.split('-');
const backend = family === 'parity' ? 'sqlite' : family;
assert.ok(['sqlite', 'lmdb'].includes(backend));
assert.ok(['success', 'admission', 'metadata', 'pending', 'native', 'missing'].includes(scenario));
const { dir } = await prepareIsolatedTestCacheDir(`native-validator-${selected}`);
const repoRoot = path.join(dir, 'repo'), home = path.join(dir, 'home'), cache = path.join(dir, 'cache');
await fsp.mkdir(repoRoot);
applyTestEnv({ extraEnv: { PAIROFCLEATS_HOME: home, PAIROFCLEATS_TRUSTED_CONFIG: null } });
const userConfig = { cache: { root: cache } }, repo = resolveRepoCacheRootPath(repoRoot, userConfig);
const indexRoot = path.join(repo, 'builds', 'generation'), indexDir = path.join(indexRoot, 'index-code');
const target = backend === 'sqlite' ? path.join(indexRoot, 'index-sqlite', 'index-code.db')
  : path.join(indexRoot, 'index-lmdb', 'index-code');
await fsp.mkdir(path.dirname(target), { recursive: true });
const coordinationRoot = path.join(home, 'state', 'storage-access'), roots = [cache, path.join(cache, 'repos'), repo, target];
let parityManifest = null;
if (family === 'parity') {
  const fixture = await createBaseIndex({ rootDir: path.join(dir, 'source'), chunkMeta: [], fileMeta: [] });
  await fsp.cp(fixture.indexDir, indexDir, { recursive: true });
  parityManifest = JSON.parse(await fsp.readFile(path.join(indexDir, 'pieces', 'manifest.json'), 'utf8'));
}
const active = () => {
  for (const root of roots) assert.ok(fs.readdirSync(repoAccessPaths(root, { coordinationRoot }).leases).length,
    'validator queries and original native close retain launch-selected canonical storage');
};
const protection = async expected => {
  for (const root of roots) assert.equal((await inspectStorageAccess(root, { coordinationRoot })).protected, expected);
};
if (backend === 'sqlite') {
  const writer = new Database(target);
  try { writer.exec(CREATE_TABLES_SQL); writeSqliteIndexFormat(writer); writer.pragma(`user_version = ${SCHEMA_VERSION}`); }
  finally { writer.close(); }
} else if (scenario !== 'missing') {
  const writer = open({ path: target, mapSize: 1024 * 1024 }), pack = new Packr();
  try {
    for (const [key, value] of [[LMDB_META_KEYS.schemaVersion, LMDB_SCHEMA_VERSION], [LMDB_META_KEYS.mode, 'code'],
      [LMDB_META_KEYS.chunkCount, 0], [LMDB_META_KEYS.mapSizeBytes, 1024 * 1024], [LMDB_META_KEYS.mapSizeEstimatedBytes, 1024],
      [LMDB_META_KEYS.artifacts, [LMDB_ARTIFACT_KEYS.chunkMeta, LMDB_ARTIFACT_KEYS.tokenPostings]],
      [LMDB_ARTIFACT_KEYS.chunkMeta, []], [LMDB_ARTIFACT_KEYS.tokenPostings, { vocab: [], postings: [], docLengths: [] }]]) writer.putSync(key, pack.pack(value));
  } finally { await closeLmdbDatabase(writer, writer.close); }
}
let database, originalNativeClose, closes = 0, queryCalls = 0, denyMetadata = scenario === 'metadata';
let originalSettled = false, reported = () => originalSettled;
const primary = Object.freeze(Object.defineProperties(new Error('original validator query work remains pending'), {
  cacheOwnershipPending: { value: true }, cacheOwnershipReleased: { get: () => reported }
}));
const nativeError = Object.freeze(new Error('original validator native close failed'));
const originalPrepare = Database.prototype.prepare, originalSqliteClose = Database.prototype.close,
  originalSet = allDbs.set, setDescriptor = Object.getOwnPropertyDescriptor(allDbs, 'set'), originalRm = fs.rmSync;
const beforeQuery = () => {
  queryCalls++; active(); database.close = () => assert.fail('validation cannot adopt a late replacement close');
  if (scenario === 'pending') throw primary;
};
Database.prototype.prepare = function (...args) {
  if (this.name === target) { database = this; originalNativeClose = originalSqliteClose; beforeQuery(); }
  return originalPrepare.apply(this, args);
};
Database.prototype.close = function () {
  if (this.name === target) { database = this; originalNativeClose = originalSqliteClose; closes++; active(); if (scenario === 'native') throw nativeError; }
  return originalSqliteClose.call(this);
};
if (backend === 'lmdb') allDbs.set = function (key, db) {
  database = db; originalNativeClose = db.close;
  const originalGet = db.get;
  db.close = function (callback) { closes++; active(); if (scenario === 'native') throw nativeError; return originalNativeClose.call(this, callback); };
  db.get = function (...args) { beforeQuery(); return originalGet.apply(this, args); };
  return originalSet.call(this, key, db);
};
fs.rmSync = (file, ...args) => {
  if (denyMetadata && typeof file === 'string' && file.startsWith(coordinationRoot) && file.includes(`${path.sep}leases${path.sep}`)) {
    throw Object.assign(new Error('original validator metadata release failed'), { code: 'EACCES' });
  }
  return originalRm(file, ...args);
};
const find = (value, key, seen = new Set()) => {
  if (!value || typeof value !== 'object' || seen.has(value)) return null;
  seen.add(value);
  return value[key] || find(value.cause, key, seen)
    || (value instanceof AggregateError && value.errors.map(error => find(error, key, seen)).find(Boolean)) || null;
};
const contains = (value, expected, seen = new Set()) => {
  if (value === expected) return true;
  if (!value || typeof value !== 'object' || seen.has(value)) return false;
  seen.add(value);
  return contains(value.cause, expected, seen) || value instanceof AggregateError && value.errors.some(error => contains(error, expected, seen));
};
const report = async () => {
  const output = { issues: [], warnings: [], hints: [] };
  if (family === 'parity') {
    await loadAndValidateChunkMeta({ root: repoRoot, userConfig, indexRoot, mode: 'code', dir: indexDir,
      strict: true, sqliteEnabled: true, sqlitePath: target, manifest: parityManifest,
      report: output, modeReport: { ok: true, warnings: [] }, shouldLoadOptional: () => false, checkPresence: () => {},
      readJsonArtifact: name => JSON.parse(fs.readFileSync(path.join(indexDir, `${name}.json`), 'utf8')) });
    assert.deepEqual(output.issues, []); return { ok: true };
  }
  return (backend === 'sqlite' ? buildSqliteReport : buildLmdbReport)({ root: repoRoot, userConfig,
    indexRoot, modes: ['code'], sqliteEnabled: true, lmdbEnabled: true, report: output,
    selection: { indexDirs: { code: indexDir }, sqlitePaths: { code: target }, lmdbPaths: { code: target } } });
};
try {
  if (scenario === 'admission') {
    const held = await withExclusiveStorageAccess(cache, async () => {
      await assert.rejects(report(), { code: 'ERR_REPO_CACHE_CLEANUP_BUSY' });
      assert.equal(queryCalls, 0); assert.equal(database, undefined); return true;
    }, { coordinationRoot });
    assert.equal(held.result, true); await protection(false);
  } else if (scenario === 'success' || scenario === 'missing') {
    const result = await report(); assert.equal(result.ok, true);
    if (scenario === 'missing') { assert.deepEqual(result.warnings, ['code: db missing']); assert.equal(database, undefined); }
    else { assert.ok(queryCalls); assert.equal(closes, 1); assert.equal(backend === 'sqlite' ? database.open : database.status !== 'closed', false); }
    await protection(false);
  } else {
    let failure;
    await assert.rejects(report(), error => { failure = error; return true; });
    assert.equal(closes, 1); await protection(true);
    if (scenario === 'native') {
      assert.ok(contains(failure, nativeError)); assert.equal(backend === 'sqlite' ? database.open : database.status !== 'closed', true);
    } else {
      const storage = find(failure, 'nativeStorageOwner'); assert.ok(storage);
      assert.equal(backend === 'sqlite' ? database.open : database.status !== 'closed', false);
      if (scenario === 'pending') {
        assert.ok(contains(failure, primary)); reported = () => true;
        assert.throws(() => storage.releaseAfterClosure(), 'the original independent observer remains required'); originalSettled = true;
      } else { assert.throws(() => storage.releaseAfterClosure()); denyMetadata = false; }
      storage.releaseAfterClosure(); find(failure, 'sqliteCacheOwner')?.release();
      assert.equal(closes, 1); await protection(false);
    }
  }
} finally {
  denyMetadata = false; fs.rmSync = originalRm;
  Database.prototype.prepare = originalPrepare; Database.prototype.close = originalSqliteClose;
  if (setDescriptor) Object.defineProperty(allDbs, 'set', setDescriptor); else delete allDbs.set;
  if (backend === 'sqlite' && database?.open) originalSqliteClose.call(database);
  if (backend === 'lmdb' && database?.status === 'open') await closeLmdbDatabase(database, originalNativeClose);
}
console.log(`Native validator ${selected} keeps launch-selected storage through original closure and preserves exact failure owners.`);
