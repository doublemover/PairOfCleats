#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { prepareIsolatedTestCacheDir } from '../../../helpers/test-cache.js';
import { createSqliteBenchBundleFixture, publishSqliteBenchSource } from '../../../../tools/bench/sqlite/shared.js';
import { validateSqliteBenchDatabase } from '../../../../tools/bench/sqlite/validate.js';
import { prepareCachedSemanticPlan } from '../../../../src/storage/sqlite/semantic/from-cache.js';
import { buildDatabaseFromBundles } from '../../../../src/storage/sqlite/build/from-bundles.js';
import { incrementalUpdateDatabase } from '../../../../src/storage/sqlite/build/incremental-update.js';
import { readIncrementalBundleSnapshot } from '../../../../src/index/build/incremental/bundle-snapshot.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../../src/contracts/versioning.js';

const { dir } = await prepareIsolatedTestCacheDir('sqlite-bench-fixture-admission');
const bundleDir = path.join(dir, 'bundles');
await fs.mkdir(bundleDir);
const { manifest, buildChunks } = await createSqliteBenchBundleFixture({ bundleDir, fileCount: 12, chunksPerFile: 2 });
assert.equal(manifest.artifactSurfaceVersion, ARTIFACT_SURFACE_VERSION);
assert.equal(Object.keys(manifest.files).length, 12);
assert.equal(await prepareCachedSemanticPlan({ incrementalData: { manifest, bundleDir } }), null);
const target = 'src/file-2.js';
const before = await readIncrementalBundleSnapshot({ bundleDir, relKey: target, entry: manifest.files[target] });
assert.ok(before);
assert.equal(before.bundle.chunks.length, 2);
assert.equal(before.bundle.chunks[0].name, 'fnv1-2-0');
assert.deepEqual(before.bundle.chunks[0].tokens, ['tok-v1-2', 'tok-0']);
const independentSource = 'fnv1-2-0 tok-v1-2 tok-0\nfnv1-2-1 tok-v1-2 tok-1\n';
assert.equal(manifest.files[target].size, Buffer.byteLength(independentSource));
assert.equal(manifest.files[target].hash, createHash('sha256').update(independentSource).digest('hex'));
assert.equal(before.bundle.chunks[1].start, independentSource.indexOf('fnv1-2-1'));
assert.match(manifest.files[target].bundles[0], /^snapshot-[a-f0-9]{64}\.json$/);
assert.equal(manifest.files[target].bundleInventory.length, 1);
assert.equal(await readIncrementalBundleSnapshot({ bundleDir, relKey: target,
  entry: { ...manifest.files[target], size: manifest.files[target].size + 1 } }), null);
const unsupported = { ...manifest }; delete unsupported.artifactSurfaceVersion;
await assert.rejects(() => prepareCachedSemanticPlan({ incrementalData: { manifest: unsupported, bundleDir } }),
  { code: 'ERR_INDEX_FORMAT_UNSUPPORTED' });

const dbPath = path.join(dir, 'fixture.db');
const common = { Database, outPath: dbPath, mode: 'code', vectorConfig: { enabled: false },
  modelConfig: { id: null }, emitOutput: false, validateMode: 'off' };
const built = await buildDatabaseFromBundles({ ...common, incrementalData: { manifest, bundleDir },
  envConfig: { bundleThreads: 1 }, threadLimits: { fileConcurrency: 1 } });
assert.equal(built.count, 24);
const initial = await validateSqliteBenchDatabase({ Database, dbPath, bundleDir, manifest, mode: 'code', expectedRows: 24 });
assert.equal(initial.files, 12); assert.equal(initial.postings, 48);
const updatedManifest = { ...manifest, files: { ...manifest.files } };
updatedManifest.files[target] = await publishSqliteBenchSource({ bundleDir, file: target,
  chunks: buildChunks(target, 'v2'), mtimeMs: 9999 });
assert.equal(updatedManifest.artifactSurfaceVersion, ARTIFACT_SURFACE_VERSION);
assert.notEqual(updatedManifest.files[target].hash, manifest.files[target].hash);
assert.notDeepEqual(updatedManifest.files[target].bundles, manifest.files[target].bundles);
assert.deepEqual(await readIncrementalBundleSnapshot({ bundleDir, relKey: target, entry: manifest.files[target] }), before,
  'publication must preserve the immutable initial snapshot');
const result = await incrementalUpdateDatabase({ ...common, incrementalData: { manifest: updatedManifest, bundleDir } });
assert.equal(result.used, true, result.reason); assert.equal(result.changedFiles, 1);
assert.equal(result.deletedFiles, 0); assert.equal(result.insertedChunks, 2);
const changed = await validateSqliteBenchDatabase({ Database, dbPath, bundleDir, manifest: updatedManifest, mode: 'code', expectedRows: 24 });
assert.notEqual(changed.stableContentSha256, initial.stableContentSha256);
assert.equal(changed.chunks, 24); assert.equal(changed.postings, 48);
const db = new Database(dbPath);
try {
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM chunks WHERE file=? AND name=?').get(target, 'fnv2-0').count, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM chunks WHERE file=? AND name=?').get(target, 'fnv1-2-0').count, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM chunks WHERE file=? AND name=?').get('src/file-0.js', 'fnv1-0-0').count, 1);
  db.prepare('UPDATE token_postings SET tf=tf+1 WHERE doc_id=(SELECT id FROM chunks WHERE file=? LIMIT 1)').run(target);
} finally { db.close(); }
await assert.rejects(() => validateSqliteBenchDatabase({ Database, dbPath, bundleDir, manifest: updatedManifest,
  mode: 'code', expectedRows: 24 }), /postings differ/);
console.log('SQLite benchmark fixtures reach real production build/update admission and verify changed content.');
