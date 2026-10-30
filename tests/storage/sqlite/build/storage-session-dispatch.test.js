import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import Database from 'better-sqlite3';
import { buildDatabaseFromArtifacts } from '../../../../src/storage/sqlite/build/from-artifacts.js';
import { buildDatabaseFromBundles } from '../../../../src/storage/sqlite/build/from-bundles.js';
import { incrementalUpdateDatabase } from '../../../../src/storage/sqlite/build/incremental-update.js';
import { CREATE_TABLES_BASE_SQL, SCHEMA_VERSION } from '../../../../src/storage/sqlite/schema.js';
import { writeSqliteIndexFormat } from '../../../../src/storage/sqlite/index-format.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../../src/contracts/versioning.js';
import { resolveRepoCacheRootPath } from '../../../../src/shared/repo-paths.js';
import { resolveCacheTempRoot } from '../../../../src/shared/cache-roots.js';
import { repoAccessPaths } from '../../../../src/shared/cache/repo-access.js';
import { inspectStorageAccess } from '../../../../src/shared/storage/access.js';
import { writeSqliteArtifactManifest } from '../../../helpers/artifact-io-fixture.js';
import { prepareIsolatedTestCacheDir } from '../../../helpers/test-cache.js';
import { applyTestEnv } from '../../../helpers/test-env.js';
import { writeIncrementalBundleSnapshot } from '../../../../src/index/build/incremental/bundle-snapshot.js';
import { sqliteBundleIdentity } from '../../../../src/storage/sqlite/bundle-identity.js';

const caseId = process.env.PAIROFCLEATS_TEST_ID?.split('storage-session-dispatch/')[1];
const configured = caseId?.startsWith('configured-');
const selected = configured ? caseId.slice('configured-'.length) : caseId;
assert.ok(['artifacts', 'bundles', 'incremental', 'fallback', 'unknown-close'].includes(selected));
const { dir } = await prepareIsolatedTestCacheDir(`sqlite-storage-dispatch-${caseId}`);
const repoRoot = path.join(dir, 'repo'), home = path.join(dir, 'home'), cache = path.join(dir, 'cache');
await fsp.mkdir(repoRoot);
applyTestEnv({ cacheRoot: cache, extraEnv: { PAIROFCLEATS_HOME: home, PAIROFCLEATS_TRUSTED_CONFIG: null } });
const userConfig = { cache: { root: cache } }, storageContext = { repoRoot, userConfig };
const repo = resolveRepoCacheRootPath(repoRoot, userConfig), tmp = resolveCacheTempRoot();
const indexDir = path.join(repo, 'builds', 'generation', 'index-code');
const outPath = configured ? path.join(dir, 'configured-output', 'code.db')
  : path.join(repo, 'builds', 'generation', 'index-sqlite', 'code.db');
if (configured) userConfig.sqlite = { codeDbPath: outPath };
await fsp.mkdir(indexDir, { recursive: true }); await fsp.mkdir(path.dirname(outPath), { recursive: true });
await writeSqliteArtifactManifest(indexDir, []);
const chunk = { id: 0, file: 'sample.js', start: 0, end: 1, tokens: [] };
const selectedEntry = { hash: 'current', mtimeMs: 123, size: 10 };
const snapshot = await writeIncrementalBundleSnapshot({ repoRoot, bundleDir: indexDir, relKey: 'sample.js',
  entry: selectedEntry, bundles: [{ file: 'sample.js', ...selectedEntry, chunks: selected === 'incremental' ? [] : [chunk] }] });
const manifest = { artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, files: { 'sample.js': {
  ...selectedEntry, ...snapshot } } };
if (selected === 'incremental') {
  const seed = new Database(outPath);
  try {
    seed.exec(CREATE_TABLES_BASE_SQL); writeSqliteIndexFormat(seed); seed.pragma(`user_version = ${SCHEMA_VERSION}`);
    seed.prepare('INSERT INTO file_manifest (mode, file, hash, mtimeMs, size, chunk_count, bundle_hash) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run('code', 'sample.js', 'current', 123, 10, 0, sqliteBundleIdentity(manifest.files['sample.js']));
  } finally { seed.close(); }
}
const coordinationRoot = path.join(home, 'state', 'storage-access');
const comparable = file => path.resolve(file.startsWith('\\\\?\\') ? file.slice(4) : file);
const assertLease = root => assert.ok(fs.readdirSync(repoAccessPaths(comparable(root), { coordinationRoot }).leases).length,
  'actual SQLite construction/query/original closure retains the exact native path and both launch categories');
const originalClose = Database.prototype.close, originalPrepare = Database.prototype.prepare;
const handles = new Set(), closes = new Map();
const nativeFailure = Object.freeze(new Error('original native writer close remains unknown'));
let recording = true, fallbackOpens = 0;
function TrackingDatabase(file) {
  const actual = comparable(file);
  for (const root of [cache, repo, tmp, actual]) assertLease(root);
  if (configured) assertLease(path.dirname(outPath));
  if (selected === 'fallback' && !actual.startsWith(path.join(tmp, 'sqlite-build') + path.sep)) {
    throw Object.assign(new Error('controlled Windows SQLite CANTOPEN'), { code: 'SQLITE_CANTOPEN' });
  }
  if (selected === 'fallback') fallbackOpens++;
  const db = new Database(file); handles.add(db); return db;
}
Database.prototype.prepare = function (...args) {
  if (recording) {
    assertLease(this.name); this.close = () => assert.fail('late close replacement cannot replace the constructor owner');
  }
  return originalPrepare.apply(this, args);
};
Database.prototype.close = function () {
  if (recording) {
    assertLease(this.name); for (const root of [cache, repo, tmp]) assertLease(root);
    if (configured) assertLease(path.dirname(outPath));
    closes.set(this, (closes.get(this) || 0) + 1);
    if (selected === 'unknown-close' && handles.has(this)) throw nativeFailure;
  }
  return originalClose.call(this);
};
const input = { Database: TrackingDatabase, storageContext, repoRoot, outPath, mode: 'code', emitOutput: false,
  validateMode: 'off', vectorConfig: { enabled: false }, modelConfig: { id: null }, buildPragmas: false, optimize: false };
const find = (value, key, seen = new Set()) => {
  if (!value || typeof value !== 'object' || seen.has(value)) return null;
  seen.add(value);
  return value[key] || find(value.cause, key, seen)
    || (value instanceof AggregateError && value.errors.map(error => find(error, key, seen)).find(Boolean)) || null;
};
try {
  const operation = selected === 'bundles'
    ? buildDatabaseFromBundles({ ...input, incrementalData: { manifest, bundleDir: indexDir }, envConfig: { bundleThreads: 1 }, threadLimits: { fileConcurrency: 1 } })
    : selected === 'incremental'
      ? incrementalUpdateDatabase({ ...input, incrementalData: { manifest, bundleDir: indexDir }, expectedDense: null })
      : buildDatabaseFromArtifacts({ ...input, indexDir, index: { chunkMeta: [chunk], tokenPostings: {
        vocab: [], postings: [], docLengths: [0], avgDocLen: 0, totalDocs: 1 } } });
  if (selected === 'unknown-close') {
    let failure; await assert.rejects(operation, error => { failure = error; return true; });
    const owner = find(failure, 'sqliteStorageOperation'); assert.ok(owner); assert.equal(owner.isSettled(), false);
    await assert.rejects(owner.recoverStorageMetadata());
    for (const root of [cache, repo, tmp, outPath]) assert.equal((await inspectStorageAccess(root, { coordinationRoot })).protected, true);
    assert.equal(closes.get([...handles][0]), 1, 'metadata reconciliation cannot retry unknown physical close');
  } else if (selected === 'fallback' && process.platform !== 'win32') {
    await assert.rejects(operation, { code: 'SQLITE_CANTOPEN' }); assert.equal(fallbackOpens, 0);
  } else {
    const result = await operation;
    assert.equal(selected === 'incremental' ? result.used : selected === 'bundles' ? result.count : result, selected === 'incremental' ? true : 1);
    for (const handle of handles) { assert.equal(handle.open, false); assert.equal(closes.get(handle), 1); }
    recording = false;
    const db = new Database(outPath, { readonly: true });
    try { assert.equal(db.prepare('SELECT COUNT(*) AS total FROM chunks').get().total, selected === 'incremental' ? 0 : 1); }
    finally { originalClose.call(db); }
    if (selected === 'fallback') assert.equal(fallbackOpens, 1, 'actual fallback file was constructed inside the admitted launch-selected temp category');
  }
  if (selected !== 'unknown-close') {
    for (const root of [cache, repo, tmp, outPath]) assert.equal((await inspectStorageAccess(root, { coordinationRoot })).protected, false);
    if (configured) assert.equal((await inspectStorageAccess(path.dirname(outPath), { coordinationRoot })).protected, false);
  }
} finally {
  recording = false; Database.prototype.prepare = originalPrepare; Database.prototype.close = originalClose;
  for (const handle of handles) if (handle.open) originalClose.call(handle);
}
console.log(`Actual SQLite ${selected} work retains admitted source/native/temp lifetimes until final original closure and publication.`);
