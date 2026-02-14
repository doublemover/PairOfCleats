#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createSqliteHelpers, RETRIEVAL_FTS_UNAVAILABLE_CODE } from '../../../src/retrieval/sqlite-helpers.js';

let Database;
try {
  ({ default: Database } = await import('better-sqlite3'));
} catch {
  console.log('rankSqliteFts missing-table controlled error test skipped: better-sqlite3 not available');
  process.exit(0);
}

const db = new Database(':memory:');
db.exec(`
  CREATE TABLE chunks (
    id INTEGER PRIMARY KEY,
    mode TEXT NOT NULL,
    weight REAL
  );
`);

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
const hits = helpers.rankSqliteFts(
  { chunkMeta: [] },
  ['alpha'],
  'code',
  5,
  false,
  null,
  {
    onDiagnostic: (entry) => diagnostics.push(entry)
  }
);

assert.deepEqual(hits, [], 'expected missing table path to return empty results');
assert.equal(diagnostics.length, 1, 'expected controlled diagnostic for missing table');
assert.equal(diagnostics[0].code, RETRIEVAL_FTS_UNAVAILABLE_CODE, 'expected controlled unavailable code');
assert.equal(diagnostics[0].reason, 'missing_table', 'expected missing table reason');

db.close();
console.log('rankSqliteFts missing table controlled error test passed');
