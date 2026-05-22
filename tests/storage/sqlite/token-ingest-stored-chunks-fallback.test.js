#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createTokenIngestor } from '../../../src/storage/sqlite/build/from-artifacts/token-ingest.js';
import { requireOrSkip } from '../../helpers/require-or-skip.js';
import { ensureTestingEnv } from '../../helpers/test-env.js';

ensureTestingEnv(process.env);
requireOrSkip({ capability: 'sqlite', reason: 'sqlite stored-token ingest fallback test requires better-sqlite3' });

let Database = null;
({ default: Database } = await import('better-sqlite3'));

const db = new Database(':memory:');

try {
  db.exec(`
    CREATE TABLE chunks (
      mode TEXT NOT NULL,
      id INTEGER NOT NULL,
      tokens TEXT
    );
    CREATE TABLE doc_lengths (
      mode TEXT NOT NULL,
      doc_id INTEGER NOT NULL,
      length INTEGER NOT NULL,
      PRIMARY KEY (mode, doc_id)
    );
    CREATE TABLE token_vocab (
      mode TEXT NOT NULL,
      token_id INTEGER NOT NULL,
      token TEXT NOT NULL,
      PRIMARY KEY (mode, token_id)
    );
    CREATE TABLE token_postings (
      mode TEXT NOT NULL,
      token_id INTEGER NOT NULL,
      doc_id INTEGER NOT NULL,
      tf INTEGER NOT NULL,
      PRIMARY KEY (mode, token_id, doc_id)
    );
    CREATE TABLE token_stats (
      mode TEXT PRIMARY KEY,
      avg_doc_len REAL NOT NULL,
      total_docs INTEGER NOT NULL
    );
  `);

  const insertChunk = db.prepare('INSERT INTO chunks (mode, id, tokens) VALUES (?, ?, ?)');
  insertChunk.run('code', 0, JSON.stringify(['alpha', 'alpha']));
  insertChunk.run('code', 1, '{not valid json');
  insertChunk.run('code', 2, JSON.stringify(['beta', 'alpha']));

  const batches = {
    tokenPostingBatches: 0,
    tokenVocabBatches: 0,
    docLengthBatches: 0
  };
  const tables = new Map();
  const warnings = [];

  const ingestor = createTokenIngestor({
    db,
    resolvedBatchSize: 2,
    recordBatch: (name) => {
      batches[name] = (batches[name] || 0) + 1;
    },
    recordTable: (name, rows) => {
      tables.set(name, rows);
    },
    warn: (message) => warnings.push(String(message || '')),
    insertTokenVocab: db.prepare(
      'INSERT OR REPLACE INTO token_vocab (mode, token_id, token) VALUES (?, ?, ?)'
    ),
    insertTokenPosting: db.prepare(
      'INSERT OR REPLACE INTO token_postings (mode, token_id, doc_id, tf) VALUES (?, ?, ?, ?)'
    ),
    insertDocLength: db.prepare(
      'INSERT OR REPLACE INTO doc_lengths (mode, doc_id, length) VALUES (?, ?, ?)'
    ),
    insertTokenStats: db.prepare(
      'INSERT OR REPLACE INTO token_stats (mode, avg_doc_len, total_docs) VALUES (?, ?, ?)'
    )
  });

  assert.equal(ingestor.ingestTokenIndexFromStoredChunks('code'), true);

  const docLengths = db.prepare(
    'SELECT doc_id, length FROM doc_lengths WHERE mode = ? ORDER BY doc_id'
  ).all('code');
  assert.deepEqual(docLengths, [
    { doc_id: 0, length: 2 },
    { doc_id: 1, length: 0 },
    { doc_id: 2, length: 2 }
  ]);

  const vocab = db.prepare(
    'SELECT token_id, token FROM token_vocab WHERE mode = ? ORDER BY token_id'
  ).all('code');
  assert.deepEqual(vocab, [
    { token_id: 0, token: 'alpha' },
    { token_id: 1, token: 'beta' }
  ]);

  const postings = db.prepare(
    'SELECT token_id, doc_id, tf FROM token_postings WHERE mode = ? ORDER BY token_id, doc_id'
  ).all('code');
  assert.deepEqual(postings, [
    { token_id: 0, doc_id: 0, tf: 2 },
    { token_id: 0, doc_id: 2, tf: 1 },
    { token_id: 1, doc_id: 2, tf: 1 }
  ]);

  const stats = db.prepare(
    'SELECT avg_doc_len, total_docs FROM token_stats WHERE mode = ?'
  ).get('code');
  assert.equal(stats.total_docs, 3);
  assert.equal(stats.avg_doc_len, 4 / 3);

  assert.equal(tables.get('doc_lengths'), 3);
  assert.equal(tables.get('token_vocab'), 2);
  assert.equal(tables.get('token_postings'), 3);
  assert.equal(tables.get('token_stats'), 1);
  assert.equal(batches.tokenPostingBatches, 2);
  assert.equal(batches.tokenVocabBatches, 2);
  assert.equal(batches.docLengthBatches, 2);
  assert.deepEqual(warnings, []);
} finally {
  db.close();
}

console.log('sqlite stored-token ingest fallback test passed');
