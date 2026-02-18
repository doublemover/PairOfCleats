#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createSqliteHelpers } from '../../../src/retrieval/sqlite-helpers.js';

let Database;
try {
  ({ default: Database } = await import('better-sqlite3'));
} catch {
  console.log('rankSqliteFts allowedIds correctness test skipped: better-sqlite3 not available');
  process.exit(0);
}

const db = new Database(':memory:');
db.exec(`
  CREATE TABLE chunks (
    id INTEGER PRIMARY KEY,
    mode TEXT NOT NULL,
    weight REAL
  );
  CREATE VIRTUAL TABLE chunks_fts USING fts5(file, name, signature, kind, headline, doc, tokens, content='');
`);

const insertChunk = db.prepare('INSERT INTO chunks (id, mode, weight) VALUES (?, ?, ?)');
const insertFts = db.prepare('INSERT INTO chunks_fts (rowid, file, name, signature, kind, headline, doc, tokens) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
const tx = db.transaction(() => {
  for (let id = 1; id <= 1200; id += 1) {
    insertChunk.run(id, 'code', 1);
    insertFts.run(id, '', '', '', '', '', 'alpha', 'alpha');
  }
});
tx();

const vectorAnnState = {
  code: { available: false },
  prose: { available: false },
  records: { available: false },
  'extracted-prose': { available: false }
};

const helpers = createSqliteHelpers({
  getDb: (mode) => (mode === 'code' ? db : null),
  postingsConfig: {},
  sqliteFtsWeights: [0, 1, 1, 1, 1, 1, 1, 1],
  maxCandidates: null,
  vectorExtension: {},
  vectorAnnConfigByMode: null,
  vectorAnnState,
  queryVectorAnn: () => [],
  modelIdDefault: 'test-model',
  fileChargramN: 3
});

const allowedIds = new Set();
for (let id = 300; id <= 1200; id += 1) {
  allowedIds.add(id);
}

const hits = helpers.rankSqliteFts(
  { chunkMeta: [] },
  ['alpha'],
  'code',
  5,
  false,
  allowedIds,
  { overfetchTimeBudgetMs: 1000 }
);

assert.equal(hits.length, 5, 'expected topN hits among allowed ids');
assert.deepEqual(
  hits.map((hit) => hit.idx),
  [300, 301, 302, 303, 304],
  'expected deterministic allowed-id top ranking'
);

db.close();
console.log('rankSqliteFts allowedIds correctness test passed');
