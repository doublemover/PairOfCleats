#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createSearchPipeline } from '../../../src/retrieval/pipeline.js';
import { resolveSqliteFtsRoutingByMode } from '../../../src/retrieval/routing-policy.js';

const makeAnnState = () => ({
  code: { available: false },
  prose: { available: false },
  records: { available: false },
  'extracted-prose': { available: false }
});

const makeAnnUsed = () => ({
  code: false,
  prose: false,
  records: false,
  'extracted-prose': false
});

let sqliteCalls = 0;
const pipeline = createSearchPipeline({
  useSqlite: true,
  sqliteFtsRequested: true,
  sqliteFtsRoutingByMode: resolveSqliteFtsRoutingByMode({
    useSqlite: true,
    sqliteFtsRequested: true,
    sqliteFtsExplicit: true,
    runCode: true,
    runProse: false,
    runExtractedProse: false,
    runRecords: false
  }),
  sqliteFtsVariantConfig: {
    explicitTrigram: false,
    substringMode: false,
    stemming: false
  },
  sqliteFtsNormalize: false,
  sqliteFtsProfile: 'balanced',
  sqliteFtsWeights: [0, 1, 1, 1, 1, 1, 1, 1],
  query: 'alpha',
  queryTokens: ['alpha'],
  queryAst: null,
  bm25K1: 1.2,
  bm25B: 0.75,
  fieldWeights: null,
  postingsConfig: { enablePhraseNgrams: false, enableChargrams: false },
  phraseNgramSet: null,
  phraseRange: null,
  explain: true,
  symbolBoost: { enabled: false },
  filters: {},
  filtersActive: false,
  topN: 5,
  annEnabled: false,
  annBackend: 'auto',
  scoreBlend: null,
  minhashMaxDocs: null,
  sparseBackend: 'auto',
  profilePolicyByMode: {
    code: {
      profileId: 'default',
      vectorOnly: false,
      allowSparseFallback: false
    }
  },
  vectorAnnState: makeAnnState(),
  vectorAnnUsed: makeAnnUsed(),
  hnswAnnState: makeAnnState(),
  hnswAnnUsed: makeAnnUsed(),
  lanceAnnState: makeAnnState(),
  lanceAnnUsed: makeAnnUsed(),
  lancedbConfig: {},
  buildCandidateSetSqlite: () => {
    throw new Error('bm25 fallback should not run when sqlite-fts is healthy');
  },
  getTokenIndexForQuery: () => {
    throw new Error('token index should not be required for sqlite-fts path');
  },
  rankSqliteFts: () => {
    sqliteCalls += 1;
    return [{ idx: 0, score: 2 }];
  },
  rankVectorAnnSqlite: () => [],
  sqliteHasFts: () => true,
  sqliteHasTable: (_mode, tableName) => tableName === 'chunks' || tableName === 'chunks_fts',
  signal: null,
  rrf: { enabled: false }
});

const idx = {
  chunkMeta: [{ id: 0, file: 'src/a.js', tokens: ['alpha'], weight: 1 }],
  tokenIndex: null,
  filterIndex: null,
  fileRelations: null,
  phraseNgrams: null,
  minhash: null,
  denseVec: null
};

const hits = await pipeline(idx, 'code', null);

assert.equal(sqliteCalls, 1, 'expected sqlite FTS to run even when bm25 sparse tables are absent');
assert.equal(hits.length, 1, 'expected sqlite FTS search hit');
assert.equal(hits[0].scoreBreakdown?.sparse?.type, 'fts', 'expected sqlite FTS sparse type');

console.log('fts preflight does not require bm25 tables test passed');
