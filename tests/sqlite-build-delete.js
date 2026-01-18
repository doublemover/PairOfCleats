#!/usr/bin/env node
import assert from 'node:assert/strict';
import { deleteDocIds } from '../src/storage/sqlite/build/delete.js';
import { toSqliteRowId } from '../src/storage/sqlite/vector.js';

let Database;
try {
  ({ default: Database } = await import('better-sqlite3'));
} catch (err) {
  console.error('better-sqlite3 is required for sqlite build delete test.');
  process.exit(1);
}

const db = new Database(':memory:');
db.exec(`
  CREATE TABLE chunks (id INTEGER, mode TEXT);
  CREATE TABLE chunks_fts (rowid INTEGER, mode TEXT);
  CREATE TABLE token_postings (doc_id INTEGER, mode TEXT);
  CREATE TABLE phrase_postings (doc_id INTEGER, mode TEXT);
  CREATE TABLE chargram_postings (doc_id INTEGER, mode TEXT);
  CREATE TABLE minhash_signatures (doc_id INTEGER, mode TEXT);
  CREATE TABLE dense_vectors (doc_id INTEGER, mode TEXT);
  CREATE TABLE doc_lengths (doc_id INTEGER, mode TEXT);
  CREATE TABLE dense_vectors_ann (id INTEGER PRIMARY KEY, embedding BLOB);
  CREATE TABLE dense_vectors_ann_rowid (embedding BLOB);
`);

const insertChunk = db.prepare('INSERT INTO chunks (id, mode) VALUES (?, ?)');
const insertChunkFts = db.prepare('INSERT INTO chunks_fts (rowid, mode) VALUES (?, ?)');
const insertDoc = (table) => db.prepare(`INSERT INTO ${table} (doc_id, mode) VALUES (?, ?)`);
const insertAnn = db.prepare('INSERT INTO dense_vectors_ann (id, embedding) VALUES (?, ?)');
const insertAnnRowid = db.prepare('INSERT INTO dense_vectors_ann_rowid (rowid, embedding) VALUES (?, ?)');

for (const id of [1, 2]) {
  insertChunk.run(id, 'code');
  insertChunkFts.run(id, 'code');
  insertDoc('token_postings').run(id, 'code');
  insertDoc('phrase_postings').run(id, 'code');
  insertDoc('chargram_postings').run(id, 'code');
  insertDoc('minhash_signatures').run(id, 'code');
  insertDoc('dense_vectors').run(id, 'code');
  insertDoc('doc_lengths').run(id, 'code');
  insertAnn.run(id, Buffer.from('x'));
}

insertChunk.run(1, 'prose');
insertChunkFts.run(1, 'prose');
insertDoc('token_postings').run(1, 'prose');
insertDoc('doc_lengths').run(1, 'prose');
insertAnn.run(3, Buffer.from('y'));
const bigRowId = 9007199254740991n;
insertAnnRowid.run(bigRowId, Buffer.from('z'));

deleteDocIds(db, 'code', [1, 2], [{ table: 'dense_vectors_ann', column: 'id', withMode: false }]);
deleteDocIds(
  db,
  'code',
  [bigRowId],
  [{ table: 'dense_vectors_ann_rowid', column: 'rowid', withMode: false, transform: toSqliteRowId }]
);

const remainingCodeChunks = db.prepare('SELECT COUNT(*) AS total FROM chunks WHERE mode = ?').get('code').total;
assert.equal(remainingCodeChunks, 0, 'expected code chunks to be removed');
const remainingProseChunks = db.prepare('SELECT COUNT(*) AS total FROM chunks WHERE mode = ?').get('prose').total;
assert.equal(remainingProseChunks, 1, 'expected prose chunks to remain');

const remainingTokens = db.prepare('SELECT COUNT(*) AS total FROM token_postings WHERE mode = ?').get('code').total;
assert.equal(remainingTokens, 0, 'expected code token postings to be removed');

const remainingAnn = db.prepare('SELECT COUNT(*) AS total FROM dense_vectors_ann').get().total;
assert.equal(remainingAnn, 1, 'expected ANN rows to be removed for deleted ids');

const remainingAnnRow = db.prepare('SELECT id FROM dense_vectors_ann').get();
assert.equal(remainingAnnRow.id, 3, 'expected ANN row for other ids to remain');

const remainingAnnRowid = db.prepare('SELECT COUNT(*) AS total FROM dense_vectors_ann_rowid').get().total;
assert.equal(remainingAnnRowid, 0, 'expected rowid-based ANN delete to remove BigInt id');

db.close();

console.log('sqlite build delete test passed');
