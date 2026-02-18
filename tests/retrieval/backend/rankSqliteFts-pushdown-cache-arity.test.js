#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createSqliteHelpers } from '../../../src/retrieval/sqlite-helpers.js';

let Database;
try {
  ({ default: Database } = await import('better-sqlite3'));
} catch {
  console.log('rankSqliteFts pushdown cache arity test skipped: better-sqlite3 not available');
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

const diagnostics = [];
const firstHits = helpers.rankSqliteFts(
  { chunkMeta: [] },
  ['alpha'],
  'code',
  10,
  false,
  new Set([1, 2, 3]),
  {
    onDiagnostic: (entry) => diagnostics.push(entry)
  }
);

assert.deepEqual(
  firstHits.map((hit) => hit.idx),
  [1, 2, 3],
  'expected first pushdown query to return allowlist-constrained ids'
);

const secondHits = helpers.rankSqliteFts(
  { chunkMeta: [] },
  ['alpha'],
  'code',
  10,
  false,
  new Set([4, 5, 6, 7]),
  {
    onDiagnostic: (entry) => diagnostics.push(entry)
  }
);

assert.deepEqual(
  secondHits.map((hit) => hit.idx),
  [4, 5, 6, 7],
  'expected second pushdown query to handle different allowlist arity'
);

const queryFailures = diagnostics.filter((entry) => entry?.reason === 'query_failed');
assert.equal(queryFailures.length, 0, 'expected no query_failed diagnostics across varying pushdown arities');

db.close();
console.log('rankSqliteFts pushdown cache arity test passed');
