import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { CREATE_TABLES_BASE_SQL } from '../../../src/storage/sqlite/schema.js';
import { createInsertStatements } from '../../../src/storage/sqlite/build/statements.js';
import { buildChunkRow } from '../../../src/storage/sqlite/build-helpers.js';
import { createSqliteHelpers } from '../../../src/retrieval/sqlite-helpers.js';
import { annotateQueryAst, parseQueryInput } from '../../../src/retrieval/query-parse.js';
import { compileFtsMatchFromAst } from '../../../src/retrieval/fts-query.js';
import { createInMemorySearchPipeline } from '../pipeline/helpers/in-memory-search-pipeline-fixture.js';
import { buildQueryCacheKey } from '../../../src/retrieval/cli-index.js';
import { buildLocalCacheKey } from '../../../src/shared/cache-key.js';

const cachePayload = { query: 'alpha NOT gamma', backend: 'sqlite', mode: 'prose' };
assert.notEqual(buildQueryCacheKey(cachePayload).key,
  buildLocalCacheKey({ namespace: 'query-cache', version: 5, payload: cachePayload }).key,
  'results produced before eligibility-before-limit cannot satisfy a current query');

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
  const literalAst = ast('"alpha beta"');
  const literalOptions = { queryAst: literalAst, ftsMatch: compileFtsMatchFromAst(literalAst) };
  db.prepare('UPDATE chunks SET phrase_tokens=? WHERE id=0').run(null);
  assert.deepEqual(helpers.rankSqliteFts(load(), [], 'prose', 10, false, null, literalOptions), [],
    'missing literal evidence cannot become a positive FTS phrase');
  db.prepare('UPDATE chunks SET phrase_tokens=? WHERE id=0').run('alpha\t  beta');
  assert.deepEqual(helpers.rankSqliteFts(load(), [], 'prose', 10, false, null, literalOptions).map(hit => hit.idx), [0],
    'legacy literal-array decoding keeps its exact phrase semantics');
  db.prepare('UPDATE chunks SET phrase_tokens=? WHERE id=0').run(JSON.stringify(['alpha', 'beta']));
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
for (const kind of ['exclusion', 'phrase']) {
  const large = new Database(':memory:');
  try {
    large.exec(CREATE_TABLES_BASE_SQL);
    const inserts = createInsertStatements(large);
    large.transaction(() => {
      for (let id = 0; id < 5005; id += 1) {
        const eligible = id === 0 || id >= 5000;
        const tokens = kind === 'exclusion' ? ['alpha', eligible ? 'zeta' : 'gamma']
          : eligible ? ['alpha', 'beta', 'zeta'] : ['alpha', 'gamma', 'beta'];
        const chunk = { id, file: `source-${id}.txt`, name: kind === 'phrase' ? 'alpha beta' : tokens.join(' '),
          tokens, phraseTokens: tokens, metaV2: { schemaVersion: 3 } };
        const row = buildChunkRow(chunk, 'prose', id);
        inserts.insertChunk.run(row);
        inserts.insertFts.run(row);
      }
    })();
    // A supported name-only weighting makes the phrase's FTS scores equal even
    // when the authoritative literal stream contains an intervening token.
    const helpers = createSqliteHelpers({ getDb: () => large, postingsConfig: {},
      sqliteFtsWeights: kind === 'phrase' ? [0, 0, 1, 0, 0, 0, 0, 0] : [0, 1, 1, 1, 1, 1, 1, 1] });
    const load = () => helpers.loadIndexFromSqlite('prose', {
      includeChunks: false, includeDense: false, includeMinhash: false, includeFilterIndex: false
    });
    const query = kind === 'exclusion' ? 'alpha NOT gamma' : '"alpha beta"';
    const queryAst = annotateQueryAst(parseQueryInput(query).ast, new Set(), {}, { enablePhraseNgrams: false });
    const expected = [0, 5000, 5001, 5002, 5003];
    for (const rowCap of [null, 64]) {
      const idx = load(), pipelineIdx = load();
      assert.equal(idx.chunkMeta.filter(Boolean).length, 0);
      pipelineIdx.tokenIndex = { vocab: [], postings: [], docLengths: Array(5005).fill(kind === 'phrase' ? 3 : 2),
        totalDocs: 5005, avgDocLen: kind === 'phrase' ? 3 : 2 };
      let fallbacks = 0;
      const pipeline = createInMemorySearchPipeline({ query, queryTokens: kind === 'phrase' ? ['alpha', 'beta'] : ['alpha'], topN: 5,
        overrides: { annEnabled: false, useSqlite: true, sqliteFtsRequested: true,
          sqliteHasFts: helpers.hasFtsTable, sqliteHasTable: helpers.hasTable,
          sqliteFtsOverfetch: rowCap == null ? null : { rowCap }, rankSqliteFts: helpers.rankSqliteFts, queryAst,
          getTokenIndexForQuery: () => { fallbacks += 1; throw new Error('Healthy FTS must not rely on sparse fallback.'); } } });
      for (const cacheState of ['cold', 'warm']) {
        let stats;
        const hits = helpers.rankSqliteFts(idx, [], 'prose', 5, false, null, {
          queryAst, ftsMatch: compileFtsMatchFromAst(queryAst), overfetchRowCap: rowCap,
          onOverfetch: value => { stats = value; }
        });
        assert.deepEqual(hits.map(hit => hit.idx), expected, `${kind}, cap=${rowCap}, ${cacheState}: eligible hits beyond first window`);
        assert.equal(stats.rowCap, rowCap ?? 5000);
        assert.ok(stats.rowsScanned <= stats.rowCap);
        assert.equal(idx.chunkMeta.filter(Boolean).length, 6, 'only eligible metadata is hydrated');
        const pipelineHits = await pipeline(pipelineIdx, 'prose', null);
        assert.deepEqual(pipelineHits.map(hit => hit.idx ?? hit.id), expected, `${kind}: full pipeline ${cacheState}`);
        assert.equal(fallbacks, 0);
      }
    }
    const allowed = new Set([0, ...Array.from({ length: 1000 }, (_, index) => 4005 + index)]);
    const constrained = helpers.rankSqliteFts(load(), [], 'prose', 5, false, allowed, {
      queryAst, ftsMatch: compileFtsMatchFromAst(queryAst)
    });
    assert.deepEqual(constrained.map(hit => hit.idx), expected, `${kind}: large allowlist and AST bind independently`);
    const changedShape = helpers.rankSqliteFts(load(), ['alpha'], 'prose', 5, false, allowed);
    assert.deepEqual(changedShape.map(hit => hit.idx), [0, 4005, 4006, 4007, 4008],
      'cached statement identity must change when an AST predicate is removed');
  } finally { large.close(); }
}
console.log('FTS lazy metadata preserves bounded Boolean and literal eligibility, cold and warm');
