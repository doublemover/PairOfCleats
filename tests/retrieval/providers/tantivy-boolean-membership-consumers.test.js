import assert from 'node:assert/strict';
import Module from 'node:module';
import Database from 'better-sqlite3';
import { CREATE_TABLES_BASE_SQL } from '../../../src/storage/sqlite/schema.js';
import { createInsertStatements } from '../../../src/storage/sqlite/build/statements.js';
import { buildChunkRow } from '../../../src/storage/sqlite/build-helpers.js';
import { META_V2_SCHEMA_VERSION } from '../../../src/index/metadata/meta-v2.js';
import { createSqliteHelpers } from '../../../src/retrieval/sqlite-helpers.js';
import { buildQueryPlan } from '../../../src/retrieval/cli/query-plan.js';
import { createTantivyProvider } from '../../../src/retrieval/sparse/providers/tantivy.js';
import { createRetrievalStageTracker } from '../../../src/retrieval/pipeline/stage-checkpoints.js';
import { createInMemorySearchPipeline } from '../pipeline/helpers/in-memory-search-pipeline-fixture.js';

const texts = ['alpha gamma', 'beta', 'gamma'];
const chunks = texts.map((text, id) => ({ id, file: `src/${id}.txt`, tokens: text.split(' '), phraseTokens: text.split(' '),
  metaV2: { schemaVersion: META_V2_SCHEMA_VERSION } }));
const databases = [];
const originalLoad = Module._load;
let opened = 0, closed = 0, nativeSearches = 0;
const api = { openIndex(dir) {
  assert.match(dir, /^generation-[12]-(code|prose)$/); opened++;
  return { close() { closed++; } };
}, search(_handle, query, limit, mode) {
  assert.ok(['code', 'prose'].includes(mode)); nativeSearches++;
  return texts.flatMap((text, idx) => query.split(' ').some(token => text.split(' ').includes(token))
    ? [{ idx, score: 3 - idx }] : []).slice(0, limit);
} };
Module._load = function (name, ...args) { return name === 'tantivy' ? api : originalLoad.call(this, name, ...args); };
try {
  const sqliteByMode = new Map(['code', 'prose'].map(mode => {
    const db = new Database(':memory:'); databases.push(db); db.exec(CREATE_TABLES_BASE_SQL);
    const statements = createInsertStatements(db);
    for (const chunk of [...chunks, { id: 3, file: 'wrong-mode.txt', tokens: ['alpha'], phraseTokens: ['alpha'],
      metaV2: { schemaVersion: META_V2_SCHEMA_VERSION } }]) {
      const row = buildChunkRow(chunk, chunk.id === 3 ? (mode === 'code' ? 'prose' : 'code') : mode, chunk.id);
      statements.insertChunk.run(row); statements.insertFts.run(row);
    }
    return [mode, createSqliteHelpers({ getDb: () => db, postingsConfig: {}, sqliteFtsWeights: [0, 1, 1, 1, 1, 1, 1, 1] })];
  }));
  const matrix = [
    ['NOT gamma', [1]], ['alpha OR NOT gamma', [0, 1]], ['NOT NOT alpha', [0]],
    ['alpha', [0]], ['NOT gamma AND NOT beta', []], ['alpha OR (NOT gamma AND beta)', [0, 1]]
  ];
  for (const generation of [1, 2]) for (const mode of ['code', 'prose']) {
    const sqlite = sqliteByMode.get(mode);
    for (const [query, baseExpected] of matrix) for (const fileFilter of [undefined, 'src/1.txt', 'absent.txt']) {
      const plan = buildQueryPlan({ query, argv: {}, dict: new Set(), dictConfig: {},
        postingsConfig: { enablePhraseNgrams: false }, fileFilter, fileChargramN: 3 });
      const expected = fileFilter === 'absent.txt' ? [] : fileFilter ? baseExpected.filter(id => id === 1) : baseExpected;
      for (const backend of ['tantivy', 'memory', 'sqlite-fts']) {
        const tracker = createRetrievalStageTracker({ enabled: true });
        const idx = backend === 'sqlite-fts' ? sqlite.loadIndexFromSqlite(mode, {
          includeChunks: true, includeDense: false, includeMinhash: false, includeFilterIndex: false
        }) : { chunkMeta: chunks.map(row => ({ ...row })) };
        assert.deepEqual(idx.chunkMeta.filter(Boolean).map(row => row.file), chunks.map(row => row.file),
          'each independent comparator receives its actual selected-mode metadata before file filtering');
        idx.tantivy = { available: true, dir: `generation-${generation}-${mode}` };
        const pipeline = createInMemorySearchPipeline({ query, queryTokens: plan.queryTokens,
          filters: plan.filters, filtersActive: plan.filtersActive, topN: 10, stageTracker: tracker,
          overrides: { annEnabled: false, sparseBackend: backend === 'tantivy' ? 'tantivy' : 'auto',
            queryAst: plan.queryAst, filterPredicates: plan.filterPredicates,
            ...(backend === 'sqlite-fts' ? { useSqlite: true, sqliteFtsRequested: true,
              sqliteHasFts: sqlite.hasFtsTable, sqliteHasTable: sqlite.hasTable, rankSqliteFts: sqlite.rankSqliteFts,
              getTokenIndexForQuery: () => { throw new Error('Healthy SQLite FTS cannot substitute a JS comparator'); } } : {}) } });
        try {
          for (const temperature of ['cold', 'warm']) {
            const hits = await pipeline(idx, mode, null);
            assert.deepEqual(hits.map(row => row.id).sort((a, b) => a - b), expected,
              `${backend}/${mode}/${generation}/${temperature}/${query}/${fileFilter}`);
            assert.equal(hits.executionOutcome.cacheable, true);
            if (query === 'alpha OR NOT gamma' && !fileFilter) {
              assert.equal(hits[0].id, 0); assert.equal(hits[1].id, 1);
              // SQLite FTS negates its ascending BM25 cost. Its exact SQL zero
              // therefore becomes IEEE -0, the same zero lexical contribution.
              assert.ok(hits[1].sparseScore === 0, 'the complement has exactly zero lexical contribution');
              assert.ok(hits[0].sparseScore > hits[1].sparseScore);
            }
          }
          if (backend === 'tantivy' && query === 'alpha OR NOT gamma' && !fileFilter) {
            const candidates = tracker.stages.filter(row => row.stage === 'candidates');
            assert.ok(candidates.length >= 2);
            assert.ok(candidates.every(row => row.tantivyExecution.universeRows === 2
              && row.tantivyExecution.completion === 'eligible-id-zero-score'));
          }
        } finally { await pipeline.dispose(); }
      }
    }
  }
  // Interrupt inside a real completion loop, after its first128 rows, rather
  // than merely passing an already-aborted signal before work begins.
  const provider = createTantivyProvider();
  const domain = Array.from({ length: 257 }, (_, id) => ({ id }));
  const sentinel = Object.assign(new Error('original completion cancellation'), { name: 'AbortError', code: 'ABORT_ERR' });
  let checks = 0;
  try {
    assert.throws(() => provider.search({ idx: { chunkMeta: domain, tantivy: { available: true, dir: 'generation-1-code' } },
      queryTokens: [], includeZeroScores: true, allowedIds: new Set(domain.map(row => row.id)), mode: 'code', topN: 10,
      throwIfAborted() { if (++checks === 3) throw sentinel; } }), error => error === sentinel);
    assert.equal(checks, 3, 'entry/first-row/row128 guards retain the original cancellation');
    const work = {};
    const result = provider.search({ idx: { chunkMeta: domain, tantivy: { available: true, dir: 'generation-1-code' } },
      queryTokens: [], includeZeroScores: true, allowedIds: new Set(domain.map(row => row.id)), mode: 'code', topN: 10, work });
    assert.deepEqual(result.hits.map(row => row.idx), Array.from({ length: 10 }, (_, id) => id));
    assert.deepEqual(work, { universeRows: 257, completion: 'eligible-id-zero-score' });
  } finally { await provider.dispose(); }
  assert.ok(nativeSearches > 0); assert.equal(closed, opened, 'every original native handle is closed after consumer settlement');
} finally { Module._load = originalLoad; for (const db of databases) db.close(); }
console.log('Independent Tantivy, JS BM25 and actual SQLite FTS memberships preserve complement scope and work/cancellation.');
