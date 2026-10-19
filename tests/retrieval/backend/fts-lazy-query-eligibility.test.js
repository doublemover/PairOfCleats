import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { CREATE_TABLES_BASE_SQL } from '../../../src/storage/sqlite/schema.js';
import { createInsertStatements } from '../../../src/storage/sqlite/build/statements.js';
import { buildChunkRow } from '../../../src/storage/sqlite/build-helpers.js';
import { createSqliteHelpers } from '../../../src/retrieval/sqlite-helpers.js';
import { annotateQueryAst, parseQueryInput } from '../../../src/retrieval/query-parse.js';
import { compileFtsMatchFromAst } from '../../../src/retrieval/fts-query.js';
import { createInMemorySearchPipeline } from '../pipeline/helpers/in-memory-search-pipeline-fixture.js';

const db = new Database(':memory:');
try {
  db.exec(CREATE_TABLES_BASE_SQL);
  const inserts = createInsertStatements(db);
  const texts = ['alpha beta', 'alpha gamma', 'beta alpha', 'unrelated'];
  for (const [id, text] of texts.entries()) {
    const chunk = { id, file: `source-${id}.txt`, name: text, tokens: text.split(' '),
      phraseTokens: text.split(' '), metaV2: { schemaVersion: 3 } };
    const row = buildChunkRow(chunk, 'prose', id);
    inserts.insertChunk.run(row);
    inserts.insertFts.run(row);
  }
  const helpers = createSqliteHelpers({ getDb: () => db, postingsConfig: {},
    sqliteFtsWeights: [0, 1, 1, 1, 1, 1, 1, 1] });
  const load = () => helpers.loadIndexFromSqlite('prose', {
    includeChunks: false, includeDense: false, includeMinhash: false, includeFilterIndex: false
  });
  const ast = query => annotateQueryAst(parseQueryInput(query).ast, new Set(), {}, { enablePhraseNgrams: false });
  for (const [query, expected] of [
    ['alpha', [0, 1, 2]], ['alpha NOT gamma', [0, 2]],
    ['"alpha beta"', [0]], ['alpha AND gamma', [1]], ['gamma OR beta', [0, 1, 2]]
  ]) {
    const idx = load();
    assert.equal(idx.chunkMeta.filter(Boolean).length, 0);
    const queryAst = ast(query);
    const options = { ftsMatch: compileFtsMatchFromAst(queryAst), queryAst };
    for (const cacheState of ['cold', 'warm']) {
      const hits = helpers.rankSqliteFts(idx, [], 'prose', 10, false, null, options);
      assert.deepEqual(hits.map(hit => hit.idx).sort(), expected, `${query} (${cacheState})`);
    }
    assert.equal(idx.chunkMeta[3], undefined, 'unmatched metadata stays unloaded');
  }
  const idx = load();
  const queryAst = ast('alpha');
  let overfetch;
  const hits = helpers.rankSqliteFts(idx, [], 'prose', 1, false, new Set([2]), {
    queryAst, ftsMatch: compileFtsMatchFromAst(queryAst), overfetchRowCap: 1,
    onOverfetch: value => { overfetch = value; }
  });
  assert.deepEqual(hits.map(hit => hit.idx), [2]);
  assert.equal(overfetch.rowsScanned, 1);
  assert.equal(overfetch.canPushdown, true);
  assert.equal(idx.chunkMeta.filter(Boolean).length, 1, 'hydrate only bounded candidates');
  const pipelineIdx = load();
  pipelineIdx.tokenIndex = { vocab: [], postings: [], docLengths: [2, 2, 2, 1], totalDocs: 4, avgDocLen: 1.75 };
  const pipeline = createInMemorySearchPipeline({ query: 'alpha', queryTokens: ['alpha'], topN: 3,
    overrides: { annEnabled: false, useSqlite: true, sqliteFtsRequested: true,
      sqliteHasFts: helpers.hasFtsTable, sqliteHasTable: helpers.hasTable,
      rankSqliteFts: helpers.rankSqliteFts, queryAst } });
  const pipelineHits = await pipeline(pipelineIdx, 'prose', null);
  assert.equal(pipelineHits.length, 3, 'lazy metadata must not reject candidates before FTS execution');
  const fallbackIdx = load();
  fallbackIdx.tokenIndex = pipelineIdx.tokenIndex;
  const fallback = createInMemorySearchPipeline({ query: 'alpha NOT gamma', queryTokens: ['alpha'], topN: 3,
    overrides: { annEnabled: false, useSqlite: true, sqliteFtsRequested: true,
      sqliteHasFts: () => false, sqliteHasTable: (_mode, table) => table !== 'chunks_fts',
      buildCandidateSetSqlite: () => new Set([0, 1, 2]),
      getTokenIndexForQuery: () => ({ ...pipelineIdx.tokenIndex, vocab: ['alpha'], postings: [[[0, 1], [1, 1], [2, 1]]] }),
      rankSqliteFts: helpers.rankSqliteFts, queryAst: ast('alpha NOT gamma') } });
  const fallbackHits = await fallback(fallbackIdx, 'prose', null);
  assert.deepEqual(fallbackHits.map(hit => hit.idx ?? hit.id).sort(), [0, 2],
    'missing FTS tables must preserve lazy sparse fallback and exclusions');
  assert.equal(fallbackIdx.chunkMeta[3], undefined, 'fallback hydrates query postings rather than unrelated rows');
} finally {
  db.close();
}
console.log('FTS lazy metadata preserves bounded Boolean and literal eligibility, cold and warm');
