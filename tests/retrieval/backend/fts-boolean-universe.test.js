import assert from 'node:assert/strict';
import { quantizeEmbeddingVector } from '../../../src/shared/embedding-quantization.js';
import Database from 'better-sqlite3';
import { CREATE_TABLES_BASE_SQL } from '../../../src/storage/sqlite/schema.js';
import { createInsertStatements } from '../../../src/storage/sqlite/build/statements.js';
import { buildChunkRow } from '../../../src/storage/sqlite/build-helpers.js';
import { META_V2_SCHEMA_VERSION } from '../../../src/index/metadata/meta-v2.js';
import { createSqliteHelpers } from '../../../src/retrieval/sqlite-helpers.js';
import { annotateQueryAst, parseQueryInput, tokenizeQueryTerms } from '../../../src/retrieval/query-parse.js';
import { compileFtsMatchFromAst } from '../../../src/retrieval/fts-query.js';
import { createQueryAstHelpers, requiresBooleanUniverse } from '../../../src/retrieval/pipeline/query-ast.js';
import { createInMemorySearchPipeline, createAvailableDenseAnnProvider } from '../pipeline/helpers/in-memory-search-pipeline-fixture.js';
import { buildQueryCacheKey } from '../../../src/retrieval/cli-index.js';
import { buildLocalCacheKey } from '../../../src/shared/cache-key.js';
import { buildQueryPlan } from '../../../src/retrieval/cli/query-plan.js';

const db = new Database(':memory:');
try {
  db.exec(CREATE_TABLES_BASE_SQL);
  const inserts = createInsertStatements(db);
  const texts = ['alpha beta', 'alpha gamma', 'beta alpha', 'unrelated',
    'beta epsilon', 'gamma epsilon', 'alpha beta gamma', 'beta'];
  const chunks = texts.map((text, id) => ({ id, file: `source-${id}.txt`, name: text,
    tokens: text.split(' '), phraseTokens: text.split(' '),
    metaV2: { schemaVersion: META_V2_SCHEMA_VERSION } }));
  for (const chunk of chunks) {
    const row = buildChunkRow(chunk, chunk.id === 7 ? 'code' : 'prose', chunk.id);
    inserts.insertChunk.run(row);
    inserts.insertFts.run(row);
  }
  const helpers = createSqliteHelpers({ getDb: () => db, postingsConfig: {},
    sqliteFtsWeights: [0, 1, 1, 1, 1, 1, 1, 1] });
  const load = () => helpers.loadIndexFromSqlite('prose', {
    includeChunks: false, includeDense: false, includeMinhash: false, includeFilterIndex: false
  });
  const cases = [
    ['alpha OR NOT gamma', [0, 1, 2, 3, 4, 6]],
    ['(alpha OR NOT gamma) AND beta', [0, 2, 4, 6]],
    ['NOT gamma OR alpha', [0, 1, 2, 3, 4, 6]],
    ['(alpha AND gamma) OR NOT beta', [1, 3, 5, 6]],
    ['NOT gamma', [0, 2, 3, 4]],
    ['alpha OR NOT "beta epsilon"', [0, 1, 2, 3, 5, 6]],
    ['NOT "beta epsilon" OR gamma', [0, 1, 2, 3, 5, 6]],
    ['alpha OR NOT "alpha gamma"', [0, 1, 2, 3, 4, 5, 6]],
    ['NOT NOT alpha', [0, 1, 2, 6]],
    ['alpha AND (NOT gamma OR NOT epsilon)', [0, 1, 2, 6]],
    ['(alpha AND NOT gamma) OR beta', [0, 2, 4, 6]],
    ['(NOT gamma AND NOT epsilon) OR beta', [0, 2, 3, 4, 6]]
  ];
  const prose = chunks.slice(0, 7);
  const vocab = [...new Set(prose.flatMap(chunk => chunk.tokens))].sort();
  const tokenIndex = { vocab,
    postings: vocab.map(token => prose.flatMap(chunk => {
      const count = chunk.tokens.filter(value => value === token).length;
      return count ? [[chunk.id, count]] : [];
    })),
    docLengths: prose.map(chunk => chunk.tokens.length), totalDocs: prose.length,
    avgDocLen: prose.reduce((sum, chunk) => sum + chunk.tokens.length, 0) / prose.length };
  for (const [query, expected] of cases) {
    const parsed = parseQueryInput(query);
    const queryAst = annotateQueryAst(parsed.ast, new Set(), {}, { enablePhraseNgrams: false });
    const queryTokens = tokenizeQueryTerms([...parsed.includeTerms, ...parsed.phrases], new Set());
    const matcher = createQueryAstHelpers({ queryAst }).matchesQueryAst;
    assert.deepEqual(chunks.filter(chunk => chunk.id !== 7 && matcher({ chunkMeta: chunks }, chunk.id, chunk))
      .map(chunk => chunk.id), expected, `${query}: canonical Boolean semantics`);
    const idx = load(), pipelineIdx = load();
    pipelineIdx.tokenIndex = { vocab: [], postings: [], docLengths: texts.slice(0, 7).map(text => text.split(' ').length),
      totalDocs: 7, avgDocLen: 2 };
    let fallbacks = 0;
    const pipeline = createInMemorySearchPipeline({ query, queryTokens, topN: 10,
      overrides: { annEnabled: false, useSqlite: true, sqliteFtsRequested: true,
        sqliteHasFts: helpers.hasFtsTable, sqliteHasTable: helpers.hasTable,
        rankSqliteFts: helpers.rankSqliteFts, queryAst,
        getTokenIndexForQuery: () => { fallbacks++; throw new Error('Healthy FTS cannot use sparse fallback'); } } });
    for (const state of ['cold', 'warm']) {
      const diagnostics = [];
      const hits = helpers.rankSqliteFts(idx, queryTokens, 'prose', 10, false, null, {
        queryAst, ftsMatch: compileFtsMatchFromAst(queryAst), onDiagnostic: diagnostic => diagnostics.push(diagnostic)
      });
      assert.deepEqual(diagnostics, [], 'Healthy FTS must execute without falling back');
      assert.deepEqual(hits.map(hit => hit.idx).sort((a, b) => a - b), expected, `${query}, ${state}`);
      assert.ok(hits.every(hit => Number.isFinite(hit.score)));
      const pipelineHits = await pipeline(pipelineIdx, 'prose', null).catch(error => {
        throw new Error(`${query}: full pipeline failed`, { cause: error });
      });
      assert.deepEqual(pipelineHits.map(hit => hit.idx ?? hit.id).sort((a, b) => a - b), expected,
        `${query}: full pipeline ${state}`);
      assert.equal(fallbacks, 0);
    }
    for (const scoring of ['legacy', 'indexed', 'fielded', 'missing-fts']) {
      const memoryIdx = scoring === 'missing-fts' ? load() : { chunkMeta: prose };
      if (scoring !== 'legacy') memoryIdx.tokenIndex = tokenIndex;
      if (scoring === 'fielded') memoryIdx.fieldPostings = { fields: { body: tokenIndex } };
      const loadedBatches = [];
      if (scoring === 'missing-fts') {
        const loadChunks = memoryIdx.loadChunkMetaByIds;
        memoryIdx.loadChunkMetaByIds = (...args) => {
          loadedBatches.push(args[1]);
          return loadChunks(...args);
        };
      }
      const memoryPipeline = createInMemorySearchPipeline({ query, queryTokens, topN: 10,
        overrides: { annEnabled: false, queryAst,
          ...(scoring === 'fielded' ? { fieldWeights: { body: 1 } } : {}),
          ...(scoring === 'missing-fts' ? { useSqlite: true, sqliteFtsRequested: true,
            sqliteHasFts: () => false, sqliteHasTable: (_mode, table) => table !== 'chunks_fts',
            getTokenIndexForQuery: () => tokenIndex,
            buildCandidateSetSqlite: () => new Set([0, 1, 2, 6]) } : {}) }
      });
      for (const state of ['cold', 'warm']) {
        const memoryHits = await memoryPipeline(memoryIdx, 'prose', null);
        assert.deepEqual(memoryHits.map(hit => hit.idx ?? hit.id).sort((a, b) => a - b), expected,
          `${query}: ${scoring} ${state}`);
      }
      assert.ok(loadedBatches.every(batch => batch.length <= 512), 'degraded FTS hydrates in bounded batches');
    }
    const plan = buildQueryPlan({ query, argv: { lint: false }, dict: new Set(), dictConfig: {},
      postingsConfig: { enablePhraseNgrams: false }, fileFilter: 'source-', fileChargramN: 3 });
    for (const annEnabled of [false, true]) {
      let annCalls = 0;
      const provider = createAvailableDenseAnnProvider(async () => {
        annCalls++;
        return prose.map(chunk => ({ idx: chunk.id, sim: 0.99 - chunk.id * 0.01 }));
      });
      const planned = createInMemorySearchPipeline({ provider, query, queryTokens: plan.queryTokens,
        filters: plan.filters, filtersActive: plan.filtersActive, topN: 10,
        overrides: { annEnabled, queryAst: plan.queryAst, filterPredicates: plan.filterPredicates } });
      assert.deepEqual((await planned({ chunkMeta: prose, tokenIndex,
        denseVec: { vectors: prose.map(() => quantizeEmbeddingVector([0.1, 0.2])) }, minhash: { signatures: [] } },
      'prose', annEnabled ? [0.1, 0.2] : null)).map(hit => hit.idx ?? hit.id).sort((a, b) => a - b), expected,
      `${query}: the production plan preserves Boolean term/phrase scope with independent filters (ANN=${annEnabled})`);
      assert.equal(annCalls, annEnabled ? 1 : 0, 'hybrid checks actually execute the vector provider');
    }
  }
  const ast = query => annotateQueryAst(parseQueryInput(query).ast, new Set(), {}, { enablePhraseNgrams: false });
  assert.equal(requiresBooleanUniverse(null), false);
  assert.equal(requiresBooleanUniverse({ type: 'unknown' }), false, 'unknown ASTs cannot widen candidate admission');
  assert.equal(requiresBooleanUniverse(ast('alpha AND NOT gamma')), false, 'ordinary exclusions retain the seeded route');
  for (const query of ['NOT (alpha AND gamma)', 'NOT (alpha OR gamma)']) {
    assert.throws(() => parseQueryInput(query), /negation/i, 'compound-negation grammar remains strict');
  }
  const queryAst = ast('alpha OR NOT gamma');
  const options = { queryAst, ftsMatch: compileFtsMatchFromAst(queryAst), overfetchRowCap: 2 };
  for (const allowed of [null, new Set([3, 4]), new Set([0, 3, 4, ...Array.from({ length: 1000 }, (_, id) => id + 100)])]) {
    const idx = load();
    let stats;
    const hits = helpers.rankSqliteFts(idx, ['alpha'], 'prose', 2, false, allowed,
      { ...options, onOverfetch: value => { stats = value; } });
    const expected = allowed?.has(0) ? [0, 3] : allowed ? [3, 4] : [0, 1];
    assert.deepEqual(hits.map(hit => hit.idx), expected, 'Boolean universe retains scores, ties and allowlist pushdown');
    assert.equal(stats.rowsScanned, 2);
    assert.equal(stats.canPushdown, Boolean(allowed));
    assert.equal(idx.chunkMeta.filter(Boolean).length, 2, 'only bounded eligible rows are hydrated');
  }
  assert.deepEqual(helpers.rankSqliteFts(load(), ['alpha'], 'prose', 10, false, new Set(), options), []);
  const never = ast('NOT alpha AND NOT beta AND NOT gamma AND NOT unrelated');
  assert.deepEqual(helpers.rankSqliteFts(load(), [], 'prose', 10, false, null,
    { queryAst: never, ftsMatch: compileFtsMatchFromAst(never) }), [], 'an empty complement remains empty');
  const code = helpers.loadIndexFromSqlite('code', { includeChunks: false, includeDense: false, includeMinhash: false });
  assert.deepEqual(helpers.rankSqliteFts(code, ['alpha'], 'code', 10, false, null, options).map(hit => hit.idx), [7],
    'negative branches cannot cross the requested mode boundary');
} finally { db.close(); }
const payload = { query: 'alpha OR NOT gamma', backend: 'sqlite', mode: 'prose' };
assert.notEqual(buildQueryCacheKey(payload).key,
  buildLocalCacheKey({ namespace: 'query-cache', version: 6, payload }).key,
  'Old positive-seeded FTS results cannot satisfy the repaired Boolean query');
