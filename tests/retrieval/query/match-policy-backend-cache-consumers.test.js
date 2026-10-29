import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import Database from 'better-sqlite3';
import { analyzeLiteralText } from '../../../src/shared/text-analyzer.js';
import { quantizeEmbeddingVector } from '../../../src/shared/embedding-quantization.js';
import { buildQueryPlan } from '../../../src/retrieval/cli/query-plan.js';
import { createQueryPlanCache, buildQueryPlanCacheKey, buildQueryPlanConfigSignature,
  createQueryPlanEntry, validateQueryPlanEntry } from '../../../src/retrieval/query-plan-cache.js';
import { runSearchSession } from '../../../src/retrieval/cli/run-search-session.js';
import { createSqliteHelpers } from '../../../src/retrieval/sqlite-helpers.js';
import { resolveFtsWeights } from '../../../src/retrieval/fts.js';
import { CREATE_TABLES_BASE_SQL } from '../../../src/storage/sqlite/schema.js';
import { createInsertStatements } from '../../../src/storage/sqlite/build/statements.js';
import { createFtsInserter } from '../../../src/storage/sqlite/fts-variants.js';
import { buildChunkRow } from '../../../src/storage/sqlite/build-helpers.js';
import { buildAnnPipelineFixture } from '../pipeline/helpers/ann-scenarios.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';

const bodies = ['alpha', 'alpha beta', 'gamma', 'gamma beta', 'alpha beta gamma',
  'beta gamma', 'delta', 'alpha beta delta', 'alpha gamma', 'beta'];
const rows = bodies.map((text, id) => ({ id, file: `src/${id}.js`, start: 0, end: text.length,
  tokens: analyzeLiteralText(text), phraseTokens: analyzeLiteralText(text), weight: 1 }));
const vocab = [...new Set(rows.flatMap(row => row.tokens))].sort();
const tokenIndex = { vocab, postings: vocab.map(token => rows.flatMap(row => {
  const count = row.tokens.filter(value => value === token).length;
  return count ? [[row.id, count]] : [];
})), docLengths: rows.map(row => row.tokens.length), totalDocs: rows.length,
avgDocLen: rows.reduce((sum, row) => sum + row.tokens.length, 0) / rows.length };
const cases = [
  ['alpha NOT beta', 'any', [0, 8]], ['NOT beta alpha', 'any', [0, 8]],
  ['alpha gamma -beta', 'any', [0, 2, 8]], ['!beta alpha gamma', 'any', [0, 2, 8]],
  ['alpha "beta gamma"', 'any', [4]], ['"beta gamma" alpha', 'any', [4]],
  ['alpha gamma "beta delta"', 'any', [7]], ['alpha NOT "beta gamma"', 'any', [0, 1, 7, 8]],
  ['NOT beta', 'any', [0, 2, 6, 8]], ['NOT "beta gamma"', 'any', [0, 1, 2, 3, 6, 7, 8, 9]],
  ['alpha OR NOT beta', 'any', [0, 1, 2, 4, 6, 7, 8]],
  ['alpha AND gamma', 'any', [4, 8]], ['alpha (beta gamma)', 'any', [4]],
  ['alpha (beta OR gamma)', 'any', [1, 4, 7, 8]], ['(alpha gamma) NOT beta', 'any', [8]],
  ['alpha beta', 'any', [0, 1, 3, 4, 5, 7, 8, 9]],
  ['alpha beta', 'all', [1, 4, 7]], ['alpha beta', 'auto', [1, 4, 7], [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]],
  ['alpha NOT beta', 'auto', [0, 8], [0, 2, 6, 8]],
  ['alpha "omega zeta"', 'any', []]
];
const { dir } = await prepareIsolatedTestCacheDir('match-policy-backend-cache-consumers');
const db = new Database(':memory:');
try {
  db.exec(CREATE_TABLES_BASE_SQL);
  const statements = createInsertStatements(db), fts = createFtsInserter(db);
  for (const row of rows) {
    const value = buildChunkRow(row, 'code', row.id);
    statements.insertChunk.run(value); fts.run(value);
    statements.insertDocLength.run('code', row.id, row.tokens.length);
  }
  vocab.forEach((token, id) => {
    statements.insertTokenVocab.run('code', id, token);
    for (const [doc, tf] of tokenIndex.postings[id]) statements.insertTokenPosting.run('code', id, doc, tf);
  });
  statements.insertTokenStats.run('code', tokenIndex.avgDocLen, rows.length);
  const sqlite = createSqliteHelpers({ getDb: () => db, postingsConfig: {},
    sqliteFtsWeights: resolveFtsWeights('balanced') });
  for (const backend of ['memory', 'sqlite-fts', 'ann']) {
    const directory = path.join(dir, backend); await fs.mkdir(directory);
    const plans = createQueryPlanCache({ maxEntries: 32 });
    let annCalls = 0;
    const fixture = buildAnnPipelineFixture({ createAnnProviders: () => new Map([['dense', {
      id: 'dense', isAvailable: () => true,
      query: async () => { annCalls++; return rows.map(row => ({ idx: row.id, sim: 0.9 })); }
    }]]) });
    const idx = { ...fixture.idx, chunkMeta: rows, tokenIndex, denseVec: {
      ...fixture.idx.denseVec, vectors: rows.map(() => quantizeEmbeddingVector([0.1, 0.2])) } };
    for (const [query, match, sparseExpected, annExpected] of cases) {
      const signature = buildQueryPlanConfigSignature({ queryMatch: match });
      const key = buildQueryPlanCacheKey({ query, configSignature: signature, indexSignature: backend }).key;
      assert.equal(plans.get(key), null, 'every distinct case starts with a cold actual plan cache');
      const plan = buildQueryPlan({ query, argv: { match }, dict: new Set(), dictConfig: {}, postingsConfig: {} });
      plans.set(key, createQueryPlanEntry({ plan, configSignature: signature, indexSignature: backend }));
      assert.ok(validateQueryPlanEntry(plans.get(key), { configSignature: signature, indexSignature: backend }));
      const input = { ...fixture.context, ...plan, rootDir: dir, metricsDir: directory, queryCacheDir: directory,
        userConfig: { retrieval: { ann: { adaptiveProviders: false } } }, query, searchMode: 'code', runCode: true,
        runProse: false, runExtractedProse: false, runRecords: false, idxCode: idx,
        topN: rows.length, annEnabled: backend === 'ann', annActive: backend === 'ann',
        annBackend: 'dense', backendLabel: backend === 'sqlite-fts' ? 'sqlite-fts' : 'memory',
        contextExpansionEnabled: false, contextExpansionOptions: {}, contextExpansionRespectFilters: true,
        useSqlite: backend === 'sqlite-fts', sqliteFtsRequested: backend === 'sqlite-fts',
        sqliteHasFts: sqlite.hasFtsTable, sqliteHasTable: sqlite.hasTable, sqliteHasDb: () => true,
        getTokenIndexForQuery: sqlite.getTokenIndexForQuery, rankSqliteFts: sqlite.rankSqliteFts,
        useStubEmbeddings: true, modelConfig: { dir }, modelIds: { code: 'fixture-stub' },
        embeddingProvider: 'xenova', embeddingOnnx: {}, vectorExtension: {},
        queryCacheEnabled: true, queryCacheTtlMs: 120000, queryCacheMaxEntries: 32,
        queryCacheStrategy: 'memory-first', queryCacheMemoryFreshMs: 0,
        indexSignaturePayload: { backend, modes: { code: 'fixed-match-policy-generation' } } };
      const expected = backend === 'ann' ? annExpected || sparseExpected : sparseExpected;
      const cold = await runSearchSession(input), coldCalls = annCalls;
      assert.equal(cold.cache.hit, false);
      assert.deepEqual(cold.codeHits.map(hit => hit.id).sort((a, b) => a - b), expected, `${backend}/${match}/${query}: cold membership`);
      const warm = await runSearchSession({ ...input, ...plans.get(key).plan });
      assert.equal(warm.cache.hit, true);
      assert.deepEqual(warm.codeHits.map(hit => hit.id).sort((a, b) => a - b), expected, `${backend}/${match}/${query}: warm membership`);
      assert.equal(annCalls, coldCalls, 'actual result-cache hits do not dispatch another ANN query');
    }
  }
} finally { db.close(); await fs.rm(dir, { recursive: true, force: true }); }
console.log('Authored expected memberships survive actual sparse/FTS/ANN sessions and cold/warm plan/result caches.');
