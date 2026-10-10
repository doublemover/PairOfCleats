#!/usr/bin/env node
import { writeSqliteIndexFormat } from '../../../src/storage/sqlite/index-format.js';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { createSemanticSourceSnapshot } from '../../../src/index/semantic/source.js';
import { createSyntaxPartitionId, canonicalSemanticJson } from '../../../src/index/semantic/identity.js';
import { createSemanticPartitionSink, createSemanticDiskAccount }
  from '../../../src/index/build/artifacts/writers/semantic/partition.js';
import { createArtifactSemanticStore } from '../../../src/semantic/artifact-store.js';
import { createSqliteSemanticStore } from '../../../src/semantic/sqlite-store.js';
import { CREATE_SEMANTIC_TABLES_SQL } from '../../../src/storage/sqlite/semantic/schema.js';
import { ingestSemanticPartition, removeSemanticSource } from '../../../src/storage/sqlite/semantic/ingest.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { SCHEMA_VERSION } from '../../../src/storage/sqlite/schema.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-semantic-storage-'));
const source = createSemanticSourceSnapshot({
  bytes: Buffer.from('f(1,2,3,4,5,6);'), repositoryNamespace: 'fixture:storage',
  path: 'src/input.js', language: 'javascript'
}).manifest;
const partitionId = createSyntaxPartitionId({
  sourceUnitId: source.sourceUnitId, parser: { family: 'fixture', version: '1', options: {} },
  extractor: { schemaVersion: 1, version: '1' }, structuralPolicy: { structure: 'complete' }
});
const ref = (localId) => ({ partitionId, localId });
const node = (id) => ({
  id, kind: 'expression', span: [0, source.textLength], scope: null,
  data: { astKind: id ? 'NumericLiteral' : 'CallExpression', operation: null,
    invocationKind: id ? null : 'call', syntacticArgumentCount: id ? null : 6, flags: [] }
});
const entries = [
  ...Array.from({ length: 7 }, (_, i) => ({ family: 'node', row: node(i) })),
  ...Array.from({ length: 6 }, (_, ordinal) => ({
    family: 'operand', row: { parent: ref(0), slot: 'argument', ordinal, child: ref(ordinal + 1), flags: [] }
  })),
  { family: 'coverage', row: {
    scope: ref(0), phase: 'syntax', state: 'complete', reason: null,
    observedCount: 7, completedCount: 7, frontierRef: null
  } }
];
const batch = (rows, sequence) => ({
  partitionId, sequence, rows,
  byteCount: rows.reduce((sum, entry) => sum + Buffer.byteLength(canonicalSemanticJson(entry)) + 1, 0)
});
const account = createSemanticDiskAccount(16 * 1024 * 1024);
const options = {
  stagingRoot: root, source, sourceBytes: Buffer.from('f(1,2,3,4,5,6);'), partitionId, producerHash: 'a'.repeat(64),
  policyHash: 'b'.repeat(64), diskAccount: account
};
const write = async (batchSize) => {
  const sink = await createSemanticPartitionSink(options);
  let sequence = 0;
  for (let start = 0; start < entries.length; start += batchSize) {
    await sink.appendBatch(batch(entries.slice(start, start + batchSize), sequence++));
  }
  return sink.finalizeSource();
};
let db;
try {
  const small = await write(2);
  const large = await write(100);
  assert.equal(small.canonicalHash, large.canonicalHash, 'physical batching must not change completed facts');
  assert.notEqual(small.members.semantic_records.length, large.members.semantic_records.length);
  const generation = { baseBuildId: 'fixture-build', semanticRevision: 0 };
  const store = createArtifactSemanticStore({
    root, repoRoot: root, artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
    generation, partitions: [small]
  });
  const metrics = {};
  const refs = [ref(6), ref(0), ref(6)];
  const artifactRows = await store.getRecords(refs, ['data', 'span'], { metrics });
  assert.equal(artifactRows[0].id, 6);
  assert.equal(artifactRows[1].data.syntacticArgumentCount, 6);
  assert.deepEqual(artifactRows[0], artifactRows[2]);
  assert.equal(metrics.rowsRead, 2, 'deduplicate selected rows before hydration');
  assert.deepEqual(artifactRows[0].omittedFieldGroups, ['scope']);
  assert.deepEqual(await store.getRecords([ref(999)]), [null]);
  await assert.rejects(store.getRecords([{ partitionId: 'sy1:' + 'f'.repeat(64), localId: 0 }]));
  const operands = [];
  for await (const row of store.iterateRows(partitionId, 'semantic_operands')) operands.push(row);
  assert.equal(operands[5].ordinal, 5);
  assert.equal(operands[5].child.localId, 6);

  const spans = await store.getSourceSpans(refs);
  assert.equal(spans[0].text, 'f(1,2,3,4,5,6);');
  assert.equal(spans[0].sourceHash, source.byteHash);
  await assert.rejects(store.getSourceSpans(refs, { maxBytes: 1 }), /response byte limit/);
  db = new Database(':memory:');
  db.pragma('user_version = ' + SCHEMA_VERSION);
  db.exec(CREATE_SEMANTIC_TABLES_SQL);
  writeSqliteIndexFormat(db);
  await assert.rejects(ingestSemanticPartition({ db, store, descriptor: small }), /caller-owned/);
  db.exec('BEGIN');
  await ingestSemanticPartition({ db, store, descriptor: small });
  db.exec('COMMIT');
  const sqlite = createSqliteSemanticStore({
    db, repoRoot: root, indexPath: path.join(root, 'fixture.sqlite'),
    artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, generation
  });
  assert.deepEqual(await sqlite.getRecords(refs, ['data', 'span']), artifactRows);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM semantic_operands').get().n, 6);
  assert.equal(db.prepare('SELECT canonical_hash FROM semantic_analysis').get().canonical_hash, small.canonicalHash);

  db.exec('BEGIN');
  await assert.rejects(ingestSemanticPartition({
    db, store, descriptor: { ...small, canonicalHash: 'f'.repeat(64) }
  }), /canonical content hash/);
  db.exec('COMMIT');
  assert.deepEqual(await sqlite.getRecords(refs, ['data', 'span']), artifactRows);

  // Replacing a partition is idempotent; failure restores the prior partition.
  db.exec('BEGIN');
  await ingestSemanticPartition({ db, store, descriptor: small });
  db.exec('COMMIT');
  const corruptStore = {
    async *iterateRows(id, member, opts) {
      for await (const row of store.iterateRows(id, member, opts)) {
        if (member === 'semantic_operands') throw new Error('injected read failure');
        yield row;
      }
    }
  };
  db.exec('BEGIN');
  await assert.rejects(ingestSemanticPartition({ db, store: corruptStore, descriptor: small }), /injected/);
  db.exec('COMMIT');
  assert.deepEqual(await sqlite.getRecords(refs, ['data', 'span']), artifactRows);

  const cancelled = new AbortController();
  const before = account.used;
  const sink = await createSemanticPartitionSink({ ...options, signal: cancelled.signal });
  await sink.appendBatch(batch(entries.slice(0, 2), 0));
  cancelled.abort();
  await assert.rejects(sink.finalizeSource(), { name: 'AbortError' });
  await sink.abort();
  assert.equal(account.used, before);
  const insufficient = createSemanticDiskAccount(0);
  const blocked = await createSemanticPartitionSink({ ...options, diskAccount: insufficient });
  await assert.rejects(blocked.appendBatch(batch(entries.slice(0, 2), 0)), { code: 'ERR_SEMANTIC_DISK_LIMIT' });
  assert.equal(insufficient.used, 0);
  const dangling = await createSemanticPartitionSink(options);
  await dangling.appendBatch(batch([entries[0], { family: 'operand', row: {
    parent: ref(0), slot: 'argument', ordinal: 0, child: ref(9), flags: []
  } }], 0));
  await assert.rejects(dangling.finalizeSource(), /Dangling/);
  await dangling.abort();

  const piecePath = path.join(root, small.members.semantic_records[0].path);
  await fs.appendFile(piecePath, ' ');
  await assert.rejects(store.getRecords([ref(0)]), { code: 'ERR_SEMANTIC_INTEGRITY' });
  assert.throws(() => createArtifactSemanticStore({
    root, repoRoot: root, artifactSurfaceVersion: 'future', generation, partitions: [small]
  }), { code: 'ERR_INDEX_FORMAT_UNSUPPORTED' });
  assert.throws(() => createArtifactSemanticStore({
    root, repoRoot: root, artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
    generation: { ...generation, semanticRevision: 1 }, partitions: [small]
  }), { code: 'ERR_SEMANTIC_CONTRACT' });
  db.exec('BEGIN');
  removeSemanticSource({ db, sourceUnitId: source.sourceUnitId });
  db.exec('COMMIT');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM semantic_records').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM semantic_sources').get().n, 0);
  console.log('semantic staging, exact lookup, SQLite parity and rollback passed');
} finally {
  db?.close();
  await fs.rm(root, { recursive: true, force: true });
}
