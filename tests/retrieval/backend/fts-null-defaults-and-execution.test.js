import assert from 'node:assert/strict';
import { createSqliteFtsProvider } from '../../../src/retrieval/sparse/providers/sqlite-fts.js';
import { createRankSqliteFtsFixture } from './rank-sqlite-fts-fixture.js';
const { db, helpers } = await createRankSqliteFtsFixture({
  skipLabel: 'FTS null defaults and execution', rowCount: 2000
});
const allowedIds = new Set(Array.from({ length: 1001 }, (_, i) => 1000 + i));
for (const overfetch of [null, { rowCap: null, timeBudgetMs: null, chunkSize: null }]) {
  const provider = createSqliteFtsProvider({ rankSqliteFts: helpers.rankSqliteFts, overfetch });
  let stats;
  const result = provider.search({
    idx: { chunkMeta: [] }, queryTokens: ['alpha'], mode: 'code', topN: 5, allowedIds,
    onOverfetch: value => { stats = value; }
  });
  assert.deepEqual(result.hits.map(hit => hit.idx), [1000, 1001, 1002, 1003, 1004]);
  assert.equal(stats.rowCap, 5000);
  assert.equal(stats.timeBudgetMs, 150);
  assert.equal(stats.rowsScanned, 2000);
  assert.deepEqual(result.execution, { table: 'chunks_fts', tokenizer: 'unicode61', variant: 'unicode61' });
}
const provider = createSqliteFtsProvider({
  rankSqliteFts: helpers.rankSqliteFts, overfetch: { rowCap: 10, timeBudgetMs: 500, chunkSize: 5 }
});
let stats;
provider.search({
  idx: { chunkMeta: [] }, queryTokens: ['alpha'], mode: 'code', topN: 5, allowedIds,
  onOverfetch: value => { stats = value; }
});
assert.equal(stats.rowCap, 10);
assert.equal(stats.timeBudgetMs, 500);
assert.equal(stats.rowsScanned, 10);
assert.equal(stats.truncated, true);
db.close();
console.log('FTS null defaults, large allowlists and real execution metadata passed');
