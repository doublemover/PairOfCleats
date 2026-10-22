#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';
import { SCHEMA_VERSION } from '../../../src/storage/sqlite/schema.js';
import { writeSqliteIndexFormat } from '../../../src/storage/sqlite/index-format.js';
import { updateSqliteDense } from '../../../tools/build/embeddings/sqlite-dense.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-ann-backfill-'));
const dbPath = path.join(root, 'index.db'), extension = path.join(root, 'fixture.dll');
await fs.writeFile(extension, 'fixture');
const seed = new Database(dbPath);
seed.exec('CREATE TABLE dense_vectors(mode TEXT,doc_id INTEGER,vector BLOB,PRIMARY KEY(mode,doc_id)); CREATE TABLE dense_meta(mode TEXT,dims INTEGER,scale REAL,model TEXT)');
seed.pragma(`user_version=${SCHEMA_VERSION}`); writeSqliteIndexFormat(seed); seed.close();
// Real SQLite transactions/base rows with a SQL table standing in for the
// optional virtual-table module; loading executes no fixture native bytes.
let failure = null;
function ProbeDatabase(target) {
  const db = new Database(target);
  db.loadExtension = () => {};
  const exec = db.exec.bind(db);
  db.exec = sql => {
    if (failure === 'creation' && sql.startsWith('CREATE VIRTUAL TABLE')) throw new Error('creation fault');
    return exec(sql.replace(/CREATE VIRTUAL TABLE IF NOT EXISTS (\w+) USING \w+\((\w+) float\[(\d+)\]\)/,
      'CREATE TABLE IF NOT EXISTS $1(rowid INTEGER PRIMARY KEY,$2 "FLOAT[$3]")'));
  };
  const prepare = db.prepare.bind(db);
  db.prepare = sql => {
    const statement = prepare(sql);
    if (failure === 'transaction' && sql.startsWith('INSERT OR REPLACE INTO dense_meta')) {
      statement.run = () => { throw Object.assign(new Error('transaction fault'), { code: 'EIO' }); };
    }
    return statement;
  };
  return db;
}
const vectors = [[1, 2], [3, 4]];
const options = { Database: ProbeDatabase, root, dbPath, mode: 'code', vectors, dims: 2, scale: 1,
  modelId: 'fixture', emitOutput: false };
try {
  updateSqliteDense({ ...options, userConfig: { sqlite: { vectorExtension: { enabled: false } } } });
  for (const mismatched of [false, true]) {
    const db = new Database(dbPath);
    if (mismatched) db.exec('DROP TABLE dense_vectors_ann; CREATE TABLE dense_vectors_ann(rowid INTEGER PRIMARY KEY,embedding "FLOAT[9]")');
    db.close();
    const result = updateSqliteDense({ ...options, userConfig: { sqlite: { vectorExtension: { enabled: true, path: extension,
      sha256: createHash('sha256').update('fixture').digest('hex') } } } });
    assert.equal(result.vectorAnn.available, true);
    const verify = new Database(dbPath);
    try {
      assert.equal(verify.prepare('SELECT COUNT(*) AS n FROM dense_vectors_ann').get().n, vectors.length);
      assert.equal(verify.prepare('SELECT COUNT(*) AS n FROM dense_vectors').get().n, vectors.length);
    } finally { verify.close(); }
  }
  const userConfig = { sqlite: { vectorExtension: { enabled: true, path: extension,
    sha256: createHash('sha256').update('fixture').digest('hex') } } };
  for (const boundary of ['creation', 'transaction']) {
    const db = new Database(dbPath);
    db.exec('DROP TABLE dense_vectors_ann; CREATE TABLE dense_vectors_ann(rowid INTEGER PRIMARY KEY,embedding "FLOAT[9]")');
    db.prepare('INSERT INTO dense_vectors_ann VALUES (?,?)').run(1, Buffer.from([99]));
    const oldDense = db.prepare('SELECT * FROM dense_vectors ORDER BY doc_id').all();
    db.close();
    failure = boundary;
    assert.throws(() => updateSqliteDense({ ...options, userConfig }),
      { code: boundary === 'creation' ? 'ERR_SQLITE_DENSE_ANN_REBUILD' : 'EIO' });
    failure = null;
    const verify = new Database(dbPath);
    try {
      assert.equal(verify.prepare('PRAGMA table_info(dense_vectors_ann)').all().find(row => row.name === 'embedding').type, 'FLOAT[9]');
      assert.deepEqual(verify.prepare('SELECT embedding FROM dense_vectors_ann').get().embedding, Buffer.from([99]));
      assert.deepEqual(verify.prepare('SELECT * FROM dense_vectors ORDER BY doc_id').all(), oldDense);
    } finally { verify.close(); }
  }
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('new and recreated ANN tables backfill unchanged base vectors');
