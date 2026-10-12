#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRecoveryFixture } from '../../helpers/semantic-recovery.js';
import { parseJavaScriptAst } from '../../../src/lang/javascript/parse.js';
import { createSemanticCollector } from '../../../src/index/semantic/javascript-collector.js';
import { createSemanticPartitionSink } from '../../../src/index/build/artifacts/writers/semantic/partition.js';
import { ingestSemanticPartition } from '../../../src/storage/sqlite/semantic/ingest.js';
import { CREATE_SEMANTIC_TABLES_SQL } from '../../../src/storage/sqlite/semantic/schema.js';
import { createSqliteSemanticStore } from '../../../src/semantic/sqlite-store.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { compactDatabase } from '../../../tools/build/compact-sqlite-index.js';
import { createSqliteHelpers } from '../../../src/retrieval/sqlite-helpers.js';
import { setupSqliteBuildFixture } from './helpers/build-fixture.js';

const fixture = await setupSqliteBuildFixture({
  artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
  tempLabel: 'sqlite-compact-metadata-roundtrip', chunkCount: 3, fileCount: 2,
  decorateChunk: (chunk, index) => ({
    chunk_id: `chunk:${index}`,
    metaV2: { chunkId: `chunk:${index}`, file: chunk.file, lang: 'javascript',
      ext: '.js', range: { start: chunk.start, end: chunk.end },
      relations: { calls: [{ targetChunkId: 'chunk:external' }] }, segment: null },
    ext: '.js', headline: `headline ${index}`, preContext: ['before'], postContext: ['after'],
    weight: 2, ngrams: ['alpha beta'], codeRelations: { calls: ['external'] },
    docmeta: { signature: `fn${index}()`, doc: `alpha beta ${index}` },
    stats: { lines: 1 }, complexity: { cyclomatic: 1 }, lint: [{ message: 'fixture' }],
    externalDocs: [{ url: 'https://example.invalid/fixture' }],
    last_modified: '2026-10-06T00:00:00.000Z', last_author: 'fixture',
    churn: 3, churn_added: 2, churn_deleted: 1, churn_commits: 1,
    chunk_authors: ['fixture']
  })
});
const readRows = (file = fixture.outPath) => {
  const db = new fixture.Database(file, { readonly: true });
  try { return db.prepare('SELECT * FROM chunks ORDER BY id').all(); }
  finally { db.close(); }
};
const semanticText = 'function work() { return call(' + Array.from({ length: 300 }, (_, i) => i).join(',') + '); }';
const semantic = await createRecoveryFixture(semanticText);
const collector = createSemanticCollector({ ast: parseJavaScriptAst(semanticText), source: semantic.source, partitionId: semantic.partitionId }, { batchRows: 128, batchBytes: 65536 });
const sink = await createSemanticPartitionSink({ ...semantic.options, structuralSlots: collector.structuralSlots });
for (const batch of collector.batches) await sink.appendBatch(batch);
const descriptor = await sink.finalizeSource();
const seed = new fixture.Database(fixture.outPath);
try {
  seed.exec(CREATE_SEMANTIC_TABLES_SQL);
  seed.exec('BEGIN');
  await ingestSemanticPartition({ db: seed, store: semantic.store([descriptor]), descriptor });
  seed.prepare('INSERT OR REPLACE INTO index_format_meta(key,value) VALUES (?,?)').run('semanticGeneration', JSON.stringify(semantic.generation));
  seed.exec('COMMIT');
} finally { seed.close(); }
const factTables = ['index_format_meta', ...[...CREATE_SEMANTIC_TABLES_SQL.matchAll(/CREATE TABLE IF NOT EXISTS (semantic_[a-z_]+)/g)].map(match => match[1])];
const readFacts = () => {
  const db = new fixture.Database(fixture.outPath, { readonly: true });
  try { return Object.fromEntries(factTables.map(name => [name, db.prepare('SELECT rowid, * FROM "' + name + '" ORDER BY rowid').all()])); }
  finally { db.close(); }
};
const originalFacts = readFacts();
const before = readRows();
const byChunk = new Map(before.map(row => [row.chunk_id, row]));
const logger = { log() {}, warn() {}, error(message) { throw new Error(message); } };
try {
  for (let repeat = 0; repeat < 2; repeat += 1) {
    const result = await compactDatabase({ dbPath: fixture.outPath, mode: 'code',
      vectorExtension: { enabled: false }, keepBackup: true, logger });
    assert.equal(result.skipped, false);
    assert.deepEqual(readFacts(), originalFacts, 'all immutable semantic facts, row order and exact generation survive compaction');
    const after = readRows();
    assert.equal(after.length, before.length);
    assert.deepEqual(after.map(row => row.id), [0, 1, 2]);
    assert.deepEqual(after.map(row => row.chunk_id), ['chunk:0', 'chunk:2', 'chunk:1'],
      'compaction must reassign local IDs without changing stable chunk identity');
    for (const row of after) {
      const expected = byChunk.get(row.chunk_id);
      assert.ok(row.metaV2_json, 'compaction must preserve metadata required by retrieval');
      assert.deepEqual({ ...row, id: expected.id }, expected,
        'every persisted chunk column must survive compaction');
    }
    const db = new fixture.Database(fixture.outPath, { readonly: true });
    try {
      const semanticStore = createSqliteSemanticStore({ db, repoRoot: fixture.tempRoot, indexPath: fixture.outPath,
        artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, generation: semantic.generation });
      const call = originalFacts.semantic_records.map(row => JSON.parse(row.payload)).find(row => row.data.syntacticArgumentCount === 300);
      const operands = await semanticStore.getRelatedPage({ partitionId: semantic.partitionId, localId: call.id }, 'semantic_operands', { limit: 512 });
      assert.equal(operands.rows.filter(row => row.slot === 'argument').length, 300);
      const helpers = createSqliteHelpers({ getDb: () => db });
      const loaded = helpers.loadIndexFromSqlite('code', { includeDense: false, includeMinhash: false,
        includeFilterIndex: false });
      assert.deepEqual(loaded.chunkMeta.map(chunk => chunk.metaV2.chunkId),
        ['chunk:0', 'chunk:2', 'chunk:1']);
    } finally { db.close(); }
  }
  assert.deepEqual(readRows(`${fixture.outPath}.bak`), before, 'original backup remains recoverable');
  const stableBytes = await fs.readFile(fixture.outPath);
  await compactDatabase({ dbPath: fixture.outPath, mode: 'code', vectorExtension: { enabled: false },
    dryRun: true, logger });
  assert.deepEqual(await fs.readFile(fixture.outPath), stableBytes, 'dry-run must preserve source bytes');
  const mixed = new fixture.Database(fixture.outPath);
  mixed.prepare("UPDATE chunks SET mode='prose' WHERE id=2").run();
  mixed.close();
  const mixedBytes = await fs.readFile(fixture.outPath);
  await assert.rejects(compactDatabase({ dbPath: fixture.outPath, mode: 'code', vectorExtension: { enabled: false }, logger }), { code: 'ERR_SQLITE_COMPACTION_UNSUPPORTED' });
  assert.deepEqual(await fs.readFile(fixture.outPath), mixedBytes, 'reject shared semantic modes before creating replacement');
  console.log('SQLite compaction preserves all chunk columns, retrieval metadata, backups and repeatability.');
} finally {
  await fs.rm(semantic.root, { recursive: true, force: true });
  await fs.rm(fixture.tempRoot, { recursive: true, force: true });
}
