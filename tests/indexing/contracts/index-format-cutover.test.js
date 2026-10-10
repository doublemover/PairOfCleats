#!/usr/bin/env node
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createSseResponder } from '../../../tools/api/sse.js';
import { incrementalUpdateDatabase } from '../../../src/storage/sqlite/build/incremental-update.js';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { pack } from 'msgpackr';
import { buildDatabaseFromArtifacts } from '../../../src/storage/sqlite/build/from-artifacts/build.js';
import { compactDatabase } from '../../../tools/build/compact-sqlite-index.js';
import { updateSqliteDense } from '../../../tools/build/embeddings/sqlite-dense.js';
import { createSqliteBackend } from '../../../src/retrieval/cli-sqlite.js';
import { createBundleLoader } from '../../../src/storage/sqlite/build/bundle-loader.js';
import { readCompatibilityKey } from '../../../src/shared/artifact-io/manifest.js';
import { loadJsonArrayArtifact } from '../../../src/shared/artifact-io/loaders.js';
import { setArtifactReadObserver } from '../../../src/shared/artifact-io/telemetry.js';
import { resolveBundlePatchPath } from '../../../src/shared/bundle-io-paths.js';
import { BUNDLE_VERSION, BUNDLE_FORMAT_TAG, BUNDLE_PATCH_FORMAT_TAG } from '../../../src/shared/bundle-io-constants.js';
import { readSqliteCounts, readSqliteModeCount, readSqliteDenseModeCount, readSqliteTableCount, hasVectorTableAtPath } from '../../../src/storage/sqlite/build/runner/sqlite-probes.js';
import { probeSqliteTargetRuntime } from '../../../src/storage/sqlite/build/runner/build.js';
import { formatToolError } from '../../../src/integrations/mcp/protocol.js';
import { projectIndexFormatError } from '../../../src/shared/index-format-error.js';
import { createSqliteSemanticStore } from '../../../src/semantic/sqlite-store.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { SCHEMA_VERSION } from '../../../src/storage/sqlite/schema.js';
import { loadPiecesManifest, loadPiecesManifestWithReadPlan } from '../../../src/shared/artifact-io/manifest.js';
import { readBundleFile, writeBundleFile } from '../../../src/shared/bundle-io.js';
import { readBundleOrNull } from '../../../src/index/build/incremental/shared.js';
import { readCachedBundle, readCachedImports } from '../../../src/index/build/incremental/state-reconciliation.js';
import { preloadIncrementalBundleVfsRows, updateBundlesWithChunks } from '../../../src/index/build/incremental/writeback.js';
import { shouldReuseIncrementalIndex } from '../../../src/index/build/incremental/planning.js';
import { loadIncrementalState } from '../../../src/index/build/incremental/planning.js';
import { initBuildState } from '../../../src/index/build/build-state.js';
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
  // Explicit supplied manifests and injected readers must gate before any part IO.
  let payloadReads = 0;
  setArtifactReadObserver(() => { payloadReads += 1; }, { thresholdBytes: 1 });
  for (const foundVersion of [undefined, '0.0.2', '0.1.1']) {
    const manifest = { artifactSurfaceVersion: foundVersion, pieces: [{ name: 'chunk_meta', path: 'never-read.jsonl' }] };
    await assert.rejects(loadJsonArrayArtifact(root, 'chunk_meta', { manifest }), errorCode);
    await assert.rejects(loadPiecesManifestWithReadPlan(root, { readManifest: async () => manifest, repoRoot: root }), errorCode);
  }
  setArtifactReadObserver(null);
  assert.equal(payloadReads, 0, 'unsupported manifest must not access artifact payload');
  for (const version of [undefined, '0.0.2', '0.1.1']) {
    let accesses = 0;
    const manifest = { artifactSurfaceVersion: version, semanticEnabled: false,
      get files() { accesses += 1; throw new Error('Unsupported manifest files consumed.'); } };
    const context = { enabled: true, manifest, repoRoot: root, bundleDir: root, absPath: 'unused', relKey: 'unused' };
    for (const read of [readCachedBundle, readCachedImports, preloadIncrementalBundleVfsRows, updateBundlesWithChunks]) await assert.rejects(read(context), errorCode);
    await assert.rejects(shouldReuseIncrementalIndex({ repoRoot: root, manifest, outDir: root, entries: [{}] }), errorCode);
    assert.equal(accesses, 0, 'disabled semantic cache does not bypass exact metadata gate');
  }
  const mixedDir = path.join(root, 'mixed-state');
  await fs.mkdir(path.join(mixedDir, 'pieces'), { recursive: true });
  await fs.writeFile(path.join(mixedDir, 'pieces', 'manifest.json'), JSON.stringify({ artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, pieces: [] }));
  for (const foundVersion of [undefined, '0.0.2', '0.1.1']) {
    await fs.writeFile(path.join(mixedDir, 'index_state.json'), JSON.stringify({ artifactSurfaceVersion: foundVersion, compatibilityKey: 'must-not-consume', semanticEnabled: false }));
    assert.throws(() => readCompatibilityKey(mixedDir, { repoRoot: root, strict: false }), errorCode);
  }
  const envelopePath = path.join(root, 'mixed.mpk');
  for (const foundVersion of [undefined, '0.0.2', '0.1.1']) {
    await fs.writeFile(envelopePath, pack({ format: BUNDLE_FORMAT_TAG, version: BUNDLE_VERSION,
      artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, payload: { artifactSurfaceVersion: foundVersion, chunks: [] } }));
    await assert.rejects(readBundleFile(envelopePath, { format: 'msgpack', repoRoot: root }), errorCode);
    await fs.writeFile(envelopePath, pack({ format: BUNDLE_FORMAT_TAG, version: foundVersion,
      artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, payload: { artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, chunks: [] } }));
    await assert.rejects(readBundleFile(envelopePath, { format: 'msgpack', repoRoot: root }), errorCode);
  }
  const importDir = path.join(root, 'artifact-import');
  await fs.mkdir(path.join(importDir, 'pieces'), { recursive: true });
  for (const surface of [undefined, '0.0.2', '0.1.1']) {
    await fs.writeFile(path.join(importDir, 'pieces', 'manifest.json'), JSON.stringify({ artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
      buildId: 'fixture', pieces: [{ name: 'semantic_manifest', path: 'semantic_manifest.json' }] }));
    await fs.writeFile(path.join(importDir, 'semantic_manifest.json'), JSON.stringify({ artifactSurfaceVersion: surface }));
    let payloadAccesses = 0;
    class NoDatabase { constructor() { payloadAccesses += 1; throw new Error('Unsupported import opened database.'); } }
    const index = new Proxy({}, { get() { payloadAccesses += 1; throw new Error('Unsupported import accessed artifact payload.'); } });
    await assert.rejects(buildDatabaseFromArtifacts({ Database: NoDatabase, outPath: path.join(root, 'must-not-create.db'),
      index, indexDir: importDir, repoRoot: root, mode: 'code' }), errorCode);
    assert.equal(payloadAccesses, 0, 'mixed semantic metadata rejects before artifact/index payload or write database');
  }
  const patchBundle = path.join(root, 'patched.json');
  await writeBundleFile({ bundlePath: patchBundle, bundle: { chunks: [] }, format: 'json' });
  for (const version of [undefined, 0, 99]) {
    await fs.writeFile(resolveBundlePatchPath(patchBundle), JSON.stringify({ format: BUNDLE_PATCH_FORMAT_TAG, version, set: { file: 'never-applied' } }));
    await assert.rejects(readBundleFile(patchBundle, { repoRoot: root }), errorCode);
  }
  for (const format of ['json', 'msgpack']) {
    const bundlePath = path.join(root, 'current.' + (format === 'json' ? 'json' : 'mpk'));
    await writeBundleFile({ bundlePath, bundle: { file: 'src/a.js', chunks: [] }, format });
    const result = await readBundleFile(bundlePath, { format, repoRoot: root });
    assert.equal(result.ok, true);
    assert.equal(result.bundle.artifactSurfaceVersion, ARTIFACT_SURFACE_VERSION);
  }
  // Worker serialization must preserve structured errors without direct-reader fallback.
  for (const bundleThreads of [1, 2]) {
    const loader = createBundleLoader({ bundleThreads, repoRoot: root,
      workerPath: path.resolve('src/storage/sqlite/build/bundle-loader-worker.js') });
    try {
      const bundlePath = path.join(root, 'worker-old.json');
      await fs.writeFile(bundlePath, JSON.stringify({ artifactSurfaceVersion: '0.0.2', chunks: [] }));
      await assert.rejects(loader.loadBundle({ bundleDir: root, entry: { bundle: 'worker-old.json' }, file: 'input.js' }), error => {
        assert.equal(error.code, errorCode.code);
        assert.equal(error.repoRoot, root);
        assert.equal(error.indexPath, bundlePath);
        assert.match(error.rebuildCommand, /--mode all$/);
        return true;
      });
    } finally { await loader.close(); }
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
  await assert.rejects(initBuildState({ buildRoot, repoRoot: root, buildId: 'must-not-overwrite', modes: ['code'] }), error => {
    assert.equal(error.code, errorCode.code);
    assert.equal(error.repoRoot, root);
    return true;
  });
  assert.equal(await fs.readFile(path.join(buildRoot, 'build_state.json'), 'utf8'), '{"schemaVersion":1,"signatureVersion":1}');
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
    Database, outPath: oldDbPath, mode: 'code', incrementalData: { manifest: { artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION }, bundleDir: root },
    modelConfig: {}, vectorConfig: {}, buildPragmas: true
  }), errorCode);
  assert.deepEqual(await fs.readFile(oldDbPath), beforeDb, 'reject before applying write pragmas');
  await assert.rejects(compactDatabase({ dbPath: oldDbPath, repoRoot: root, mode: 'code', vectorExtension: { enabled: false } }), errorCode);
  assert.deepEqual(await fs.readFile(oldDbPath), beforeDb, 'compaction gate preserves unsupported input');

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
  // Metadata-only test double proves no chunk, vector, semantic or pragma payload is consumed.
  for (const [schema, surface] of [[0, null], [14, '0.1.0'], [16, '0.1.0'], [15, null], [15, '0.0.2'], [15, '0.1.1']]) {
    let accesses = 0, closed = 0;
    class ProbeDatabase {
      pragma(name) { assert.equal(name, 'user_version'); return schema; }
      prepare(sql) {
        if (sql.includes('sqlite_master')) return { get: () => surface == null ? undefined : { name: 'index_format_meta' } };
        if (sql.includes('index_format_meta')) return { get: () => ({ value: surface }) };
        accesses += 1; throw new Error('Unexpected payload SQL ' + sql);
      }
      close() { closed += 1; }
    }
    const args = { Database: ProbeDatabase, dbPath: oldDbPath, repoRoot: root, mode: 'code', tableName: 'dense_vectors', hasVectorTable: () => { accesses += 1; } };
    for (const probe of [readSqliteCounts, readSqliteModeCount, readSqliteDenseModeCount, readSqliteTableCount, hasVectorTableAtPath, probeSqliteTargetRuntime]) {
      assert.throws(() => probe(args), error => {
        assert.equal(error.code, errorCode.code);
        assert.equal(error.repoRoot, root);
        const projected = projectIndexFormatError(new Error('cleanup wrapper', { cause: error }));
        const mcp = formatToolError(error);
        for (const key of ['operation', 'component', 'expectedVersion', 'foundVersion', 'repoRoot', 'indexPath', 'rebuildCommand']) assert.deepEqual(mcp[key], error.details[key]);
        assert.equal(projected.nativeCode, errorCode.code);
        assert.equal(mcp.hint, error.rebuildCommand);
        return true;
      });
    }
    assert.throws(() => createSqliteSemanticStore({ db: new ProbeDatabase(), repoRoot: root, indexPath: oldDbPath }), errorCode);
    assert.throws(() => updateSqliteDense({ Database: ProbeDatabase, root, userConfig: { sqlite: { use: true } }, mode: 'code', dbPath: oldDbPath, vectors: [] }), errorCode);
    let released = 0;
    await assert.rejects(createSqliteBackend({ useSqlite: true, needsCode: true, sqliteCodePath: oldDbPath,
      rootDir: root, dbCache: { acquire: () => ({ db: new ProbeDatabase(), release: () => { released += 1; } }), setAndAcquire() {} } }), errorCode);
    assert.equal(released, 1, 'rejected cached handle releases its lease');
    assert.equal(accesses, 0, 'invalid database metadata rejects before payload SQL');
    assert.equal(closed, 7, 'every probe and updater closes on format rejection');
  }
  const req = new EventEmitter(), res = new EventEmitter();
  let streamed = '';
  res.write = text => { streamed += text; return true; };
  const diagnostic = { nativeCode: errorCode.code, operation: 'search', component: 'SQLite schema',
    expectedVersion: 15, foundVersion: 16, repoRoot: root, indexPath: oldDbPath,
    rebuildCommand: 'pairofcleats index build --repo "' + root + '" --mode all' };
  await createSseResponder(req, res).sendEvent('error', { ok: false, message: 'unsupported at ' + oldDbPath, ...diagnostic });
  const streamedError = JSON.parse(streamed.split('data: ')[1].trim());
  for (const key of Object.keys(diagnostic)) assert.deepEqual(streamedError[key], diagnostic[key]);
  assert.equal(streamedError.hint, diagnostic.rebuildCommand);
  console.log('exact index format boundaries and full-source cache isolation passed');
} finally {
  db?.close();
  await fs.rm(root, { recursive: true, force: true });
}
