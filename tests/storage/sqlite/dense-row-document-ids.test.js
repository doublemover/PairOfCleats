#!/usr/bin/env node
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { createVectorIngestor } from '../../../src/storage/sqlite/build/from-artifacts/vector-ingest.js';

for (const entries of [[[1, 2], [3, 4]], [{ vector: [1, 2] }, { vector: [3, 4] }],
  [{ id: 0, vector: [1, 2] }, new Uint8Array([3, 4]), { docId: 9, vector: [5, 6] }, { vector: [7, 8] }]]) {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE dense_vectors(mode TEXT,doc_id INTEGER,vector BLOB,PRIMARY KEY(mode,doc_id)); CREATE TABLE dense_meta(mode TEXT,dims INTEGER,scale REAL,model TEXT,min_val REAL,max_val REAL,levels INTEGER)');
  try {
    const ingestor = createVectorIngestor({ db, resolvedBatchSize: 2, recordBatch() {}, recordTable() {}, warn() {},
      validationStats: { dense: 0 }, vectorAnn: null, quantization: { minVal: -1, maxVal: 1, levels: 256 }, modelConfig: {},
      insertDense: db.prepare('INSERT INTO dense_vectors VALUES(?,?,?)'), insertDenseMeta: db.prepare('INSERT INTO dense_meta VALUES(?,?,?,?,?,?,?)') });
    await ingestor.ingestDense({ dims: 2, rows: (async function* () { yield* entries; })() }, 'code');
    assert.deepEqual(db.prepare('SELECT doc_id FROM dense_vectors ORDER BY doc_id').all().map(row => row.doc_id),
      entries.length === 2 ? [0, 1] : [0, 1, 3, 9]);
  } finally { db.close(); }
}
console.log('async dense ingestion preserves explicit IDs and assigns missing positional IDs');
