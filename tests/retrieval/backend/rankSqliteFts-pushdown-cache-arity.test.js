#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createRankSqliteFtsFixture } from './rank-sqlite-fts-fixture.js';

const { db, helpers } = await createRankSqliteFtsFixture({
  skipLabel: 'rankSqliteFts pushdown cache arity test'
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
