#!/usr/bin/env node
import assert from 'node:assert/strict';
import { incrementalUpdateDatabase } from '../../../src/storage/sqlite/build/incremental-update.js';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { SCHEMA_VERSION } from '../../../src/storage/sqlite/schema.js';
import { loadPiecesManifest, loadPiecesManifestWithReadPlan } from '../../../src/shared/artifact-io/manifest.js';
import { readBundleFile, writeBundleFile } from '../../../src/shared/bundle-io.js';
import { readBundleOrNull } from '../../../src/index/build/incremental/shared.js';
import { loadIncrementalState } from '../../../src/index/build/incremental/planning.js';
import { loadBuildState, ensureStateVersions } from '../../../src/index/build/build-state/store.js';
import { getRepoCacheRoot, getCurrentBuildInfo } from '../../../src/shared/repo-paths.js';
import { adaptArtifactSurfacePayload } from '../../../src/contracts/adapters/index.js';
import { assertSqliteIndexFormat, writeSqliteIndexFormat } from '../../../src/storage/sqlite/index-format.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-format-cutover-'));
const errorCode = { code: 'ERR_INDEX_FORMAT_UNSUPPORTED' };
let db;
try {
  assert.equal(ARTIFACT_SURFACE_VERSION, '0.1.0');
  assert.equal(SCHEMA_VERSION, 15);
  for (const foundVersion of ['0.0.2', '0.1.1', '1.0.0', null, undefined]) {
    const dir = path.join(root, 'case-' + String(foundVersion));
    await fs.mkdir(path.join(dir, 'pieces'), { recursive: true });
    const manifest = { artifactSurfaceVersion: foundVersion, pieces: [] };
    const manifestPath = path.join(dir, 'pieces', 'manifest.json');
    const original = JSON.stringify(manifest);
    await fs.writeFile(manifestPath, original);
    for (const strict of [false, true]) {
      assert.throws(() => loadPiecesManifest(dir, { strict, repoRoot: root }), errorCode);
      await assert.rejects(loadPiecesManifestWithReadPlan(dir, { manifest, strict, repoRoot: root }), errorCode);
    }
    assert.equal(await fs.readFile(manifestPath, 'utf8'), original);
    assert.equal(adaptArtifactSurfacePayload({}, foundVersion).ok, false);
    const bundlePath = path.join(dir, 'old.json');
    await fs.writeFile(bundlePath, JSON.stringify({ artifactSurfaceVersion: foundVersion, chunks: [] }));
    await assert.rejects(readBundleFile(bundlePath, { repoRoot: root }), errorCode);
    await assert.rejects(readBundleOrNull({ bundlePath, bundleFormat: 'json' }), errorCode);
  }
  for (const format of ['json', 'msgpack']) {
    const bundlePath = path.join(root, 'current.' + (format === 'json' ? 'json' : 'mpk'));
    await writeBundleFile({ bundlePath, bundle: { file: 'src/a.js', chunks: [] }, format });
    const result = await readBundleFile(bundlePath, { format, repoRoot: root });
    assert.equal(result.ok, true);
    assert.equal(result.bundle.artifactSurfaceVersion, ARTIFACT_SURFACE_VERSION);
  }
  const cacheRoot = path.join(root, 'cache');
  const legacyDir = path.join(cacheRoot, 'incremental', 'code');
  await fs.mkdir(legacyDir, { recursive: true });
  const originalLegacy = '{"version":5,"files":{"keep":"original"}}';
  await fs.writeFile(path.join(legacyDir, 'manifest.json'), originalLegacy);
  const fresh = await loadIncrementalState({ repoCacheRoot: cacheRoot, mode: 'code', enabled: false });
  assert.match(fresh.incrementalDir, /format-0\.1\.0/);
  assert.equal(fresh.manifest.artifactSurfaceVersion, ARTIFACT_SURFACE_VERSION);
  assert.equal(await fs.readFile(path.join(legacyDir, 'manifest.json'), 'utf8'), originalLegacy);
  await fs.mkdir(fresh.incrementalDir, { recursive: true });
  const incompatible = '{"artifactSurfaceVersion":"0.0.2","files":{}}';
  await fs.writeFile(fresh.manifestPath, incompatible);
  await assert.rejects(loadIncrementalState({ repoCacheRoot: cacheRoot, mode: 'code', enabled: true }), errorCode);
  assert.equal(await fs.readFile(fresh.manifestPath, 'utf8'), incompatible, 'format rejection must not quarantine originals');

  const buildRoot = path.join(root, 'build');
  await fs.mkdir(buildRoot);
  await fs.writeFile(path.join(buildRoot, 'build_state.json'), '{"schemaVersion":1,"signatureVersion":1}');
  await assert.rejects(loadBuildState(buildRoot), errorCode);
  const newState = ensureStateVersions({}, path.join(root, 'fresh-build'), false);
  assert.equal(newState.artifactSurfaceVersion, ARTIFACT_SURFACE_VERSION);

  const config = { cache: { root: path.join(root, 'repo-cache') } };
  const repoCache = getRepoCacheRoot(root, config);
  await fs.mkdir(path.join(repoCache, 'builds'), { recursive: true });
  await fs.writeFile(path.join(repoCache, 'builds', 'current.json'),
    JSON.stringify({ artifactSurfaceVersion: '0.0.2', buildId: 'old' }));
  assert.throws(() => getCurrentBuildInfo(root, config), errorCode);

  const oldDbPath = path.join(root, 'old.sqlite');
  const oldDb = new Database(oldDbPath);
  oldDb.pragma('user_version = 14');
  oldDb.exec("CREATE TABLE original(value TEXT); INSERT INTO original VALUES ('preserve')");
  oldDb.close();
  const beforeDb = await fs.readFile(oldDbPath);
  await assert.rejects(incrementalUpdateDatabase({
    Database, outPath: oldDbPath, mode: 'code', incrementalData: { manifest: {} },
    modelConfig: {}, vectorConfig: {}, buildPragmas: true
  }), errorCode);
  assert.deepEqual(await fs.readFile(oldDbPath), beforeDb, 'reject before applying write pragmas');

  db = new Database(':memory:');
  const checkDb = () => assertSqliteIndexFormat({ db, repoRoot: root, indexPath: path.join(root, 'index.db') });
  db.pragma('user_version = 14');
  assert.throws(checkDb, errorCode);
  assert.equal(db.pragma('user_version', { simple: true }), 14);
  db.pragma('user_version = 15');
  assert.throws(checkDb, errorCode);
  writeSqliteIndexFormat(db);
  checkDb();
  db.prepare("UPDATE index_format_meta SET value = '0.0.2'").run();
  assert.throws(checkDb, errorCode);
  console.log('exact index format boundaries and full-source cache isolation passed');
} finally {
  db?.close();
  await fs.rm(root, { recursive: true, force: true });
}
