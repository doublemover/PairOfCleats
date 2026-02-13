#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createSqliteHelpers } from '../../../src/retrieval/sqlite-helpers.js';

let Database;
try {
  ({ default: Database } = await import('better-sqlite3'));
} catch {
  console.log('rankSqliteFts overfetch cap/budget test skipped: better-sqlite3 not available');
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
for (let id = 1; id <= 20; id += 1) {
  insertChunk.run(id, 'code', 1);
  insertFts.run(id, '', '', '', '', '', 'alpha', 'alpha');
}

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

let statsSmall = null;
helpers.rankSqliteFts(
  { chunkMeta: [] },
  ['alpha'],
  'code',
  3,
  false,
  null,
  {
    onOverfetch: (stats) => {
      statsSmall = stats;
    }
  }
);
assert.equal(statsSmall.rowCap, 5000, 'expected default minimum overfetch row cap');
assert.equal(statsSmall.timeBudgetMs, 150, 'expected default overfetch time budget');

let statsLarge = null;
helpers.rankSqliteFts(
  { chunkMeta: [] },
  ['alpha'],
  'code',
  800,
  false,
  null,
  {
    onOverfetch: (stats) => {
      statsLarge = stats;
    }
  }
);
assert.equal(statsLarge.rowCap, 8000, 'expected scaled overfetch row cap for larger topN');
assert.equal(statsLarge.timeBudgetMs, 150, 'expected unchanged default time budget');

db.close();
console.log('rankSqliteFts overfetch cap budget test passed');
