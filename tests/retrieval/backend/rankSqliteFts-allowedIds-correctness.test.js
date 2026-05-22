#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createRankSqliteFtsFixture } from './rank-sqlite-fts-fixture.js';

const { db, helpers } = await createRankSqliteFtsFixture({
  skipLabel: 'rankSqliteFts allowedIds correctness test',
  rowCount: 1200
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
