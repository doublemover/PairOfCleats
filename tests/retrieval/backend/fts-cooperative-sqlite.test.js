import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { CREATE_TABLES_BASE_SQL } from '../../../src/storage/sqlite/schema.js';
import { createInsertStatements } from '../../../src/storage/sqlite/build/statements.js';
import { buildChunkRow } from '../../../src/storage/sqlite/build-helpers.js';
import { META_V2_SCHEMA_VERSION } from '../../../src/index/metadata/meta-v2.js';
import { createSqliteHelpers } from '../../../src/retrieval/sqlite-helpers.js';
import { annotateQueryAst, parseQueryInput, tokenizeQueryTerms } from '../../../src/retrieval/query-parse.js';
import { compileFtsMatchFromAst } from '../../../src/retrieval/fts-query.js';
import { createInMemorySearchPipeline } from '../pipeline/helpers/in-memory-search-pipeline-fixture.js';

const db = new Database(':memory:');
try {
  db.exec(CREATE_TABLES_BASE_SQL);
  const insert = createInsertStatements(db);
  const texts = ['alpha gamma', 'alpha gamma', 'alpha gamma', 'alpha gamma', 'alpha gamma',
    'alpha beta', 'beta alpha', 'alpha beta', 'other'];
  const chunks = texts.map((text, id) => ({ id, file: `source-${id}.txt`, name: text,
    tokens: text.split(' '), phraseTokens: text.split(' '), weight: id === 7 ? 4 : id === 5 ? 2 : 1,
    metaV2: { schemaVersion: META_V2_SCHEMA_VERSION } }));
  for (const chunk of chunks) {
    const row = buildChunkRow(chunk, 'prose', chunk.id);
    insert.insertChunk.run(row); insert.insertFts.run(row);
  }
  let time = 0, advanceOn = null, cancelAfterStep = false, cancelled = false;
  const dispatches = [], closes = [];
  const wrappedDb = new Proxy(db, { get(target, key) {
    if (key === 'prepare') return sql => {
      const stmt = target.prepare(sql);
      const phase = sql.startsWith('SELECT * FROM chunks') ? 'metadata'
        : sql.includes('rowid IN (SELECT value FROM json_each') ? 'terms' : null;
      return new Proxy(stmt, { get(statement, method) {
        if (method === 'all' && phase) return (...args) => {
          dispatches.push({ phase, args });
          const result = statement.all(...args);
          if (advanceOn === phase) time += 20;
          return result;
        };
        if (method === 'iterate') return (...args) => {
          const cursor = statement.iterate(...args);
          return { next() {
            dispatches.push({ phase: 'sql' });
            const result = cursor.next();
            if (advanceOn === 'sql') time += 20;
            if (cancelAfterStep) cancelled = true;
            return result;
          }, return() { closes.push(true); return cursor.return(); } };
        };
        const value = statement[method];
        return typeof value === 'function' ? value.bind(statement) : value;
      } });
    };
    const value = target[key];
    return typeof value === 'function' ? value.bind(target) : value;
  } });
  const helpers = createSqliteHelpers({ getDb: () => wrappedDb, postingsConfig: {}, ftsNow: () => time,
    sqliteFtsWeights: [0, 1, 1, 1, 1, 1, 1, 1] });
  const load = () => helpers.loadIndexFromSqlite('prose', {
    includeChunks: false, includeDense: false, includeMinhash: false, includeFilterIndex: false
  });
  const parsed = query => {
    const input = parseQueryInput(query);
    const queryAst = annotateQueryAst(input.ast, new Set(), {}, { enablePhraseNgrams: false });
    return { queryAst, ftsMatch: compileFtsMatchFromAst(queryAst),
      queryTokens: tokenizeQueryTerms([...input.includeTerms, ...input.phrases], new Set()) };
  };
  for (const [query, expected] of [['alpha NOT gamma', [7, 5, 6]], ['"alpha beta"', [7, 5]], ['absent', []]]) {
    const plan = parsed(query);
    for (const chunkSize of [1, 2, 10]) {
      const idx = load();
      for (const state of ['cold', 'warm']) {
        dispatches.length = 0;
        let stats;
        const hits = helpers.rankSqliteFts(idx, plan.queryTokens, 'prose', 3, false, null,
          { ...plan, overfetchRowCap: 20, overfetchChunkSize: chunkSize, onOverfetch: value => { stats = value; } });
        assert.deepEqual(hits.map(hit => hit.idx), expected, `${query}/${chunkSize}/${state}: independent weighted/eligibility oracle`);
        assert.equal(stats.termination, 'complete');
        assert.equal(stats.batches, Math.ceil(expected.length / chunkSize));
        assert.ok(dispatches.filter(row => row.phase === 'metadata').every(row => row.args.length - 1 <= chunkSize));
        assert.ok(dispatches.filter(row => row.phase === 'terms').every(row => JSON.parse(row.args[1]).length <= chunkSize));
      }
    }
  }
  const plan = parsed('alpha NOT gamma');
  let capped;
  assert.deepEqual(helpers.rankSqliteFts(load(), plan.queryTokens, 'prose', 2, false, null,
    { ...plan, overfetchRowCap: 2, overfetchChunkSize: 1, onOverfetch: value => { capped = value; } }).map(hit => hit.idx), [5, 6],
  'Boolean eligibility must precede the candidate cap, even with one-row batches');
  assert.equal(capped.termination, 'row-cap');
  assert.equal(capped.rowsScanned, 2);
  for (const phase of ['sql', 'metadata', 'terms']) {
    time = 0; advanceOn = phase; dispatches.length = 0;
    let stats;
    const result = helpers.rankSqliteFts(load(), plan.queryTokens, 'prose', 3, false, null,
      { ...plan, overfetchTimeBudgetMs: 10, overfetchChunkSize: 1, onOverfetch: value => { stats = value; } });
    assert.deepEqual(result, []);
    assert.equal(stats.termination, 'deadline', `${phase} work belongs to the same allowance`);
    assert.equal(stats.truncated, true);
    assert.ok(stats.overrunMs >= 10);
    if (phase === 'metadata') assert.equal(dispatches.some(row => row.phase === 'terms'), false);
    assert.ok(closes.length > 0, 'deadline disposes the real native cursor');
    // A subsequent direct query proves no cursor/connection busy state remains.
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM chunks').get().n, texts.length);
  }
  time = 0; advanceOn = null;
  const errors = [];
  assert.deepEqual(helpers.rankSqliteFts(load(), ['alpha'], 'prose', 3, false, null,
    { ftsMatch: 'alpha AND', onDiagnostic: value => errors.push(value) }), []);
  assert.equal(errors[0].reason, 'query_failed');
  const abort = Object.assign(new Error('cancelled after native step'), { code: 'ABORT_ERR' });
  cancelAfterStep = true;
  const priorCloses = closes.length;
  assert.throws(() => helpers.rankSqliteFts(load(), ['alpha'], 'prose', 3, false, null,
    { overfetchChunkSize: 1, throwIfAborted: () => { if (cancelled) throw abort; } }), error => error === abort);
  assert.equal(closes.length, priorCloses + 1);
  cancelAfterStep = false;
  time = 0; advanceOn = 'metadata';
  const idx = load();
  const vocab = [...new Set(chunks.flatMap(chunk => chunk.tokens))].sort();
  idx.tokenIndex = { vocab, postings: vocab.map(token => chunks.filter(chunk => chunk.tokens.includes(token)).map(chunk => [chunk.id, 1])),
    docLengths: chunks.map(chunk => chunk.tokens.length), totalDocs: texts.length,
    avgDocLen: chunks.reduce((sum, chunk) => sum + chunk.tokens.length, 0) / chunks.length };
  const pipeline = createInMemorySearchPipeline({ query: 'alpha NOT gamma', queryTokens: plan.queryTokens, topN: 3,
    overrides: { annEnabled: false, useSqlite: true, sqliteFtsRequested: true, sqliteHasFts: helpers.hasFtsTable,
      sqliteHasTable: helpers.hasTable, rankSqliteFts: helpers.rankSqliteFts, queryAst: plan.queryAst,
      getTokenIndexForQuery: () => idx.tokenIndex,
      sqliteFtsOverfetch: { timeBudgetMs: 10, chunkSize: 1 } } });
  const result = await pipeline(idx, 'prose', null);
  assert.equal(result.executionOutcome.status, 'partial');
  assert.equal(result.executionOutcome.cacheable, false);
  assert.ok(result.executionOutcome.reasons.includes('sparse-budget'), 'fallback cannot erase the FTS deadline receipt');
} finally { db.close(); }
console.log('real SQLite FTS batching, pushed eligibility, weighted order and deadline qualification test passed');
