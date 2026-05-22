#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createRankSqliteFtsFixture } from './rank-sqlite-fts-fixture.js';

const { db, helpers } = await createRankSqliteFtsFixture({
  skipLabel: 'rankSqliteFts weight-before-limit test',
  rowCount: 2,
  weightForId: (id) => (id === 1 ? 0.01 : 100)
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
