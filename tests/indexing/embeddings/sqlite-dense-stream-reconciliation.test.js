#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import Database from 'better-sqlite3';
import { writeDenseVectorArtifacts } from '../../../src/shared/dense-vector-artifacts.js';
import { SCHEMA_VERSION } from '../../../src/storage/sqlite/schema.js';
import { writeSqliteIndexFormat } from '../../../src/storage/sqlite/index-format.js';
import { updateSqliteDense } from '../../../tools/build/embeddings/sqlite-dense.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = resolveTestCachePath(process.cwd(), `sqlite-dense-stream-${process.pid}-${Date.now()}`);
await fs.mkdir(root, { recursive: true });
const dbPath = path.join(root, 'index.db'), vectorsPath = path.join(root, 'dense_vectors_uint8');
const seed = new Database(dbPath);
seed.exec('CREATE TABLE dense_vectors(mode TEXT,doc_id INTEGER,vector BLOB,PRIMARY KEY(mode,doc_id)); CREATE TABLE dense_meta(mode TEXT PRIMARY KEY,dims INTEGER,scale REAL,model TEXT)');
seed.pragma(`user_version=${SCHEMA_VERSION}`); writeSqliteIndexFormat(seed); seed.close();
const vectors = Array.from({ length: 600 }, (_, index) => index % 11 ? [index % 256, 2, 3, 4] : []);
const publish = rows => writeDenseVectorArtifacts({ indexDir: root, baseName: 'dense_vectors_uint8', vectors: rows,
  vectorFields: { dims: 4, model: 'fixture' }, writeBinary: true });
function ObservedDatabase(filename) {
  const db = new Database(filename), prepare = db.prepare.bind(db);
  db.prepare = sql => {
    assert.ok(!/^SELECT doc_id, vector FROM dense_vectors/i.test(sql), 'full old vector materialization is forbidden');
    if (/AS vector_bytes FROM dense_vectors/.test(sql)) assert.match(sql, /LIMIT \?$/);
    return prepare(sql);
  };
  return db;
}
const options = { Database: ObservedDatabase, root, dbPath, vectorsPath, mode: 'code', dims: 4, modelId: 'fixture', scale: 1,
  userConfig: { sqlite: { use: true, vectorExtension: { enabled: false } } }, emitOutput: false };
const read = () => {
  const db = new Database(dbPath);
  try { return { rows: db.prepare('SELECT doc_id,vector FROM dense_vectors ORDER BY doc_id').all(), meta: db.prepare('SELECT * FROM dense_meta').all() }; }
  finally { db.close(); }
};
try {
  await publish(vectors);
  const initial = updateSqliteDense(options);
  assert.equal(initial.validCount, vectors.filter(row => row.length).length);
  const first = read();
  const noOp = updateSqliteDense(options);
  assert.equal(noOp.work.baseWrites, 0);
  assert.equal(noOp.work.baseDeletes, 0);
  assert.equal(noOp.work.newRowsScanned, vectors.length);
  assert.equal(noOp.work.oldRowsScanned, initial.validCount);
  assert.equal(noOp.work.peakOldVectorBytes, 4);
  assert.ok(noOp.work.peakWindowBytes <= 1024 * 1024);
  assert.deepEqual(read(), first);

  const edited = vectors.map(row => [...row]); edited[1] = [99, 2, 3, 4]; edited[2] = []; edited.length = 510;
  await publish(edited);
  const updated = updateSqliteDense(options);
  assert.equal(updated.work.baseWrites, 1);
  assert.equal(updated.validCount, edited.filter(row => row.length).length);
  assert.deepEqual(read().rows.map(row => [row.doc_id, Array.from(row.vector)]),
    edited.flatMap((vector, docId) => vector.length ? [[docId, vector]] : []), 'holes, edits and tail deletions retain exact ordinals');

  const db = new Database(dbPath);
  db.exec("CREATE TRIGGER fail_mid_reconcile BEFORE INSERT ON dense_vectors WHEN NEW.doc_id=257 BEGIN SELECT RAISE(ABORT,'reconcile-fault'); END");
  db.close();
  const beforeFault = read();
  await publish(Array.from({ length: 600 }, () => [80, 81, 82, 83]));
  assert.throws(() => updateSqliteDense(options), /reconcile-fault/);
  assert.deepEqual(read(), beforeFault, 'failure after earlier mutation batches rolls back vectors and metadata together');
  console.log('SQLite dense reconciliation streams new bytes and bounded old metadata with atomic rollback.');
} finally { await fs.rm(root, { recursive: true, force: true }); }
