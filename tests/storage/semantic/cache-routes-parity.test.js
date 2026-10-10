#!/usr/bin/env node
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import path from 'node:path';
import { buildDatabaseFromBundles } from '../../../src/storage/sqlite/build/from-bundles.js';
import { incrementalUpdateDatabase } from '../../../src/storage/sqlite/build/incremental-update.js';
import { CREATE_SEMANTIC_TABLES_SQL } from '../../../src/storage/sqlite/semantic/schema.js';
import { ingestSemanticPartition } from '../../../src/storage/sqlite/semantic/ingest.js';
import { createArtifactSemanticStore } from '../../../src/semantic/artifact-store.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { createSemanticCacheFixture } from '../../helpers/semantic-cache-fixture.js';
import { createSemanticTaskId } from '../../../src/index/semantic/identity.js';

const fixture = await createSemanticCacheFixture();
const outPath = path.join(fixture.root, 'bundle.sqlite');
const options = { Database, outPath, mode: 'code', incrementalData: { manifest: fixture.manifest, bundleDir: fixture.bundleDir },
  vectorConfig: { enabled: false }, modelConfig: { id: null }, emitOutput: false, validateMode: 'off', optimize: false };
const tables = ['semantic_sources', 'semantic_records', 'semantic_operands', 'semantic_edges', 'semantic_ownership',
  'semantic_coverage', 'semantic_lookup', 'semantic_frontier'];
const read = (db) => ({ ...Object.fromEntries(tables.map(table => [table, db.prepare('SELECT * FROM ' + table + ' ORDER BY rowid').all()])),
  semantic_analysis: db.prepare('SELECT partition_id,source_id,canonical_hash FROM semantic_analysis ORDER BY partition_id').all() });
try {
  const inputHashes = ['a'.repeat(64)], policyHash = 'b'.repeat(64), targetSetHash = 'c'.repeat(64);
  let task;
  const files = [];
  for (const file of ['input.js', 'stable-a.js', 'stable-b.js', 'empty.js']) {
    files.push(await fixture.createFile({ file, zeroChunks: file === 'empty.js', nodeCount: file === 'empty.js' ? 0 : 1,
      extraRows: file === 'stable-a.js' ? (source) => {
        task = { schemaVersion: 1, taskId: createSemanticTaskId({ kind: 'bind', inputHashes, policyHash, targetSetHash }),
          kind: 'bind', baseBuildId: fixture.generation.baseBuildId, sourceUnits: [source.sourceUnitId], inputHashes, policyHash,
          targetSetHash, targetsRef: 'immutable:fixture-targets', dependencies: [], priority: 1,
          reason: 'provider_startup_deferred', coverageToProduce: ['bindings'] };
        return [{ family: 'frontier', row: task }];
      } : [] }));
  }
  const built = await buildDatabaseFromBundles({ ...options, envConfig: { bundleThreads: 1 }, threadLimits: { fileConcurrency: 1 } });
  assert.equal(built.count, 3);
  const golden = new Database(':memory:');
  golden.exec(CREATE_SEMANTIC_TABLES_SQL);
  try {
    golden.exec('BEGIN');
    for (const file of files) {
      const store = createArtifactSemanticStore({ root: path.join(fixture.buildRoot, fixture.storage.relativePath),
        repoRoot: fixture.repoRoot, artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
        generation: fixture.generation, partitions: file.factsRef.partitions });
      for (const descriptor of file.factsRef.partitions) await ingestSemanticPartition({ db: golden, store, descriptor });
    }
    golden.exec('COMMIT');
    const bundled = new Database(outPath, { readonly: true });
    try {
      assert.deepEqual(read(bundled), read(golden), 'bundle route projects exactly the artifact ingestor canonical rows');
      assert.deepEqual(JSON.parse(bundled.prepare("SELECT value FROM index_format_meta WHERE key='semanticGeneration'").get().value), fixture.generation);
      assert.equal(bundled.prepare("SELECT chunk_count FROM file_manifest WHERE file='empty.js'").get().chunk_count, 0);
      assert.deepEqual(JSON.parse(bundled.prepare('SELECT payload FROM semantic_frontier').get().payload), task);
    } finally { bundled.close(); }
  } finally { golden.close(); }

  const before = new Database(outPath, { readonly: true });
  let chunks;
  try { chunks = before.prepare('SELECT * FROM chunks ORDER BY id').all(); } finally { before.close(); }
  const changed = await fixture.createFile({ file: 'input.js', analysisReason: 'new-analysis-policy' });
  fixture.manifest.semanticGeneration = { baseBuildId: 'semantic-only', semanticRevision: 0 };
  const updated = await incrementalUpdateDatabase(options);
  assert.equal(updated.used, true);
  assert.equal(updated.insertedChunks, 0, 'semantic-only update cannot erase or rewrite ordinary chunks');
  assert.equal(updated.changedFiles, 0);
  const semanticOnly = new Database(outPath, { readonly: true });
  try {
    assert.deepEqual(semanticOnly.prepare('SELECT * FROM chunks ORDER BY id').all(), chunks);
    assert.equal(semanticOnly.prepare('SELECT COUNT(*) AS n FROM semantic_analysis WHERE source_id=?').get(changed.source.sourceUnitId).n, 2);
    assert.deepEqual(JSON.parse(semanticOnly.prepare("SELECT value FROM index_format_meta WHERE key='semanticGeneration'").get().value), fixture.manifest.semanticGeneration);
    assert.deepEqual(JSON.parse(semanticOnly.prepare('SELECT payload FROM semantic_frontier').get().payload), task,
      'immutable tasks retain their original base even when the generation metadata advances');
  } finally { semanticOnly.close(); }

  delete fixture.manifest.files['empty.js'];
  fixture.manifest.semanticGeneration = { baseBuildId: 'after-removal', semanticRevision: 0 };
  assert.equal((await incrementalUpdateDatabase(options)).used, true);
  const removed = new Database(outPath, { readonly: true });
  try {
    assert.equal(removed.prepare('SELECT COUNT(*) AS n FROM semantic_sources WHERE source_id=?').get(files[3].source.sourceUnitId).n, 0);
    assert.equal(removed.prepare("SELECT COUNT(*) AS n FROM file_manifest WHERE file='empty.js'").get().n, 0);
  } finally { removed.close(); }
  fixture.manifest.files = {};
  fixture.manifest.semanticGeneration = { baseBuildId: 'all-removed', semanticRevision: 0 };
  assert.equal((await incrementalUpdateDatabase(options)).used, true);
  const empty = new Database(outPath, { readonly: true });
  try {
    for (const table of [...tables, 'semantic_analysis', 'chunks', 'file_manifest']) {
      assert.equal(empty.prepare('SELECT COUNT(*) AS n FROM ' + table).get().n, 0);
    }
  } finally { empty.close(); }
  console.log('artifact ingestor, bundle and incremental canonical parity, semantic-only changes and removal passed');
} finally { await fixture.cleanup(); }
