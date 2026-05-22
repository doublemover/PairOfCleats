#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createRankSqliteFtsFixture } from './rank-sqlite-fts-fixture.js';

const { db, helpers } = await createRankSqliteFtsFixture({
  skipLabel: 'rankSqliteFts overfetch cap/budget test'
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
