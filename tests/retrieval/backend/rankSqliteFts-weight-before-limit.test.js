#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createSqliteHelpers } from '../../../src/retrieval/sqlite-helpers.js';

let Database;
try {
  ({ default: Database } = await import('better-sqlite3'));
} catch {
  console.log('rankSqliteFts weight-before-limit test skipped: better-sqlite3 not available');
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

insertChunk.run(1, 'code', 0.01);
insertChunk.run(2, 'code', 100);
insertFts.run(1, '', '', '', '', '', 'alpha', 'alpha');
insertFts.run(2, '', '', '', '', '', 'alpha', 'alpha');

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

const hits = helpers.rankSqliteFts(
  { chunkMeta: [] },
  ['alpha'],
  'code',
  1
);

assert.equal(hits.length, 1, 'expected one ranked hit');
assert.equal(hits[0].idx, 2, 'expected weighting before limit to select higher weighted hit');

db.close();
console.log('rankSqliteFts weight before limit test passed');
