import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { ARTIFACT_SURFACE_VERSION } from '../../../../src/contracts/versioning.js';
import { writeIncrementalBundle, updateBundlesWithChunks } from '../../../../src/index/build/incremental.js';
import { readIncrementalBundleSnapshot } from '../../../../src/index/build/incremental/bundle-snapshot.js';
import { buildDatabaseFromBundles } from '../../../../src/storage/sqlite/build/from-bundles.js';
import { buildDatabaseFromArtifacts, loadIndexPieces } from '../../../../src/storage/sqlite/build/from-artifacts.js';
import { incrementalUpdateDatabase } from '../../../../src/storage/sqlite/build/incremental-update.js';
import { setupSqliteBuildFixture, createSqliteBuildFixtureChunks } from '../helpers/build-fixture.js';
import { SCHEMA_VERSION } from '../../../../src/storage/sqlite/schema.js';
import { assertSqliteIndexFormat } from '../../../../src/storage/sqlite/index-format.js';

const decorateChunk = (chunk, id) => ({ chunkId: `chunk:${id}`, chunkUid: `uid:${id}`, virtualPath: chunk.file,
  metaV2: { chunkId: `chunk:${id}`, chunkUid: `uid:${id}`, virtualPath: chunk.file, risk: { score: 1 } },
  docmeta: { doc: 'baseline', inferredTypes: { returns: [{ type: 'Widget' }] } } });
const fixture = await setupSqliteBuildFixture({ tempLabel: 'finalized-metadata-reuse',
  artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, chunkCount: 24, fileCount: 24, decorateChunk });
const bundleDir = path.join(fixture.tempRoot, 'bundles'), outPath = path.join(fixture.tempRoot, 'incremental.db');
const manifest = { artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, files: {} };
const dependencies = { parse: 'p1', lexical: 'l1', enrichment: 'e1', embeddings: 'none', artifacts: 'a1' };
const initial = [...createSqliteBuildFixtureChunks({ chunkCount: 24, fileCount: 24, decorateChunk })];
const common = { Database: fixture.Database, mode: 'code', modelConfig: { id: null }, vectorConfig: { enabled: false },
  emitOutput: false, validateMode: 'off', buildPragmas: false, optimize: false };
const rows = filename => { const db = new fixture.Database(filename, { readonly: true });
  try { return db.prepare('SELECT * FROM chunks ORDER BY id').all(); } finally { db.close(); } };
const update = chunks => updateBundlesWithChunks({ enabled: true, manifest, bundleDir, chunks,
  fileRelations: new Map(initial.map(chunk => [chunk.file, {}])), log: () => {} });
const apply = extra => incrementalUpdateDatabase({ ...common, outPath,
  incrementalData: { manifest, bundleDir }, ...extra });
try {
  for (const chunk of initial) manifest.files[chunk.file] = await writeIncrementalBundle({ enabled: true, bundleDir,
    relKey: chunk.file, fileStat: { mtimeMs: 1, size: 10 }, fileHash: `source:${chunk.id}`, fileChunks: [chunk],
    dependencySignatures: dependencies, fileRelations: {}, vfsManifestRows: [], bundleFormat: 'json' });
  assert.ok(Object.values(manifest.files).every(Boolean));
  const built = await buildDatabaseFromBundles({ ...common, outPath, incrementalData: { manifest, bundleDir },
    envConfig: { bundleThreads: 1 }, threadLimits: { fileConcurrency: 1 } });
  assert.equal(built.count, 24, built.reason);
  const originalRows = rows(outPath);
  assert.deepEqual(originalRows, rows(fixture.outPath), 'actual artifact and bundle ingest persist identical finalized metadata');
  const names = () => Object.fromEntries(Object.entries(manifest.files).map(([file, entry]) => [file, entry.bundles.join('|')]));
  const before = names(), samples = [];
  let start = performance.now(); await update(structuredClone(initial));
  assert.deepEqual(names(), before, 'unchanged finalized snapshots are a true storage no-op');
  let result = await apply(); assert.equal(result.used, true, result.reason); assert.equal(result.insertedChunks, 0);
  samples.push({ phase: 'unchanged', elapsedMs: performance.now() - start, rewrittenFiles: 0, rewrittenRows: result.insertedChunks });
  const next = structuredClone(initial);
  next[0].metaV2.risk.score = 9;
  next[1].docmeta.doc = 'changed docmeta only';
  next[2].docmeta.inferredTypes.returns[0].type = 'OtherType';
  start = performance.now(); await update(next);
  const after = names(), rewritten = Object.keys(after).filter(file => after[file] !== before[file]);
  assert.deepEqual(rewritten.sort(), next.slice(0, 3).map(chunk => chunk.file).sort());
  for (const chunk of next) {
    const loaded = await readIncrementalBundleSnapshot({ bundleDir, relKey: chunk.file, entry: manifest.files[chunk.file] });
    assert.deepEqual(loaded.bundle.chunks, [chunk]);
  }
  result = await apply(); assert.equal(result.used, true, result.reason);
  assert.equal(result.changedFiles, 3); assert.equal(result.insertedChunks, 3);
  samples.push({ phase: 'enrichment-only', elapsedMs: performance.now() - start,
    rewrittenFiles: rewritten.length, rewrittenRows: result.insertedChunks });
  assert.deepEqual(rows(outPath).map(row => row.id), originalRows.map(row => row.id), 'stable source chunks retain deterministic IDs');
  const pieces = JSON.parse(await fs.readFile(path.join(fixture.indexDir, 'pieces', 'manifest.json'), 'utf8'));
  pieces.pieces = pieces.pieces.filter(piece => !['chunk_meta', 'chunk_meta_meta'].includes(piece.name));
  pieces.pieces.push({ name: 'chunk_meta', path: 'chunk_meta.json', format: 'json' });
  await fs.writeFile(path.join(fixture.indexDir, 'chunk_meta.json'), JSON.stringify(next));
  await fs.writeFile(path.join(fixture.indexDir, 'pieces', 'manifest.json'), JSON.stringify(pieces));
  const reference = path.join(fixture.tempRoot, 'reference.db');
  await buildDatabaseFromArtifacts({ ...common, outPath: reference, indexDir: fixture.indexDir,
    index: await loadIndexPieces(fixture.indexDir, null), manifestFiles: manifest.files });
  assert.deepEqual(rows(outPath), rows(reference), 'enrichment-only incremental SQLite metadata equals the actual artifact path');
  const settled = rows(outPath), settledNames = names();
  await update(next); result = await apply();
  assert.equal(result.insertedChunks, 0); assert.deepEqual(names(), settledNames); assert.deepEqual(rows(outPath), settled);
  // Force an error inside insertion after deletion. The outer transaction must
  // restore all old chunks, IDs, manifest identities and postings together.
  const changedAgain = structuredClone(next); changedAgain[0].docmeta.doc = 'rollback candidate'; await update(changedAgain);
  const RealDatabase = fixture.Database;
  const FaultDatabase = function (...args) {
    const db = new RealDatabase(...args), prepare = db.prepare.bind(db);
    db.prepare = sql => { const statement = prepare(sql);
      if (/INTO chunks\s*\(/i.test(sql)) statement.run = () => { throw new Error('controlled insertion failure'); };
      return statement; };
    return db;
  };
  await assert.rejects(apply({ Database: FaultDatabase }), /controlled insertion failure/);
  assert.deepEqual(rows(outPath), settled, 'failed enrichment update rolls back deleted and inserted metadata');
  const old = new RealDatabase(':memory:');
  try { old.pragma(`user_version = ${SCHEMA_VERSION - 1}`);
    assert.throws(() => assertSqliteIndexFormat({ db: old, repoRoot: fixture.tempRoot, indexPath: 'old.db' }),
      { code: 'ERR_INDEX_FORMAT_UNSUPPORTED' }); } finally { old.close(); }
  console.log(JSON.stringify({ corpusFiles: initial.length, samples }));
} finally { await fs.rm(fixture.tempRoot, { recursive: true, force: true }); }
console.log('Finalized risk/docmeta/type-only snapshots drive bounded SQLite updates, no-op reuse, artifact parity and rollback.');
