#!/usr/bin/env node
import assert from 'node:assert/strict';
import { RETRIEVAL_FTS_UNAVAILABLE_CODE } from '../../../src/retrieval/sqlite-helpers.js';
import { createRankSqliteFtsFixture } from './rank-sqlite-fts-fixture.js';

const { db, helpers } = await createRankSqliteFtsFixture({
  skipLabel: 'rankSqliteFts missing-table controlled error test',
  createFts: false,
  rowCount: 0
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
