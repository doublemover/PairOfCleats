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
    sqliteFtsExplicit: false,
    runCode: false,
    runProse: true,
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
  vectorAnnState: makeAnnState(),
  vectorAnnUsed: makeAnnUsed(),
  hnswAnnState: makeAnnState(),
  hnswAnnUsed: makeAnnUsed(),
  lanceAnnState: makeAnnState(),
  lanceAnnUsed: makeAnnUsed(),
  lancedbConfig: {},
  buildCandidateSetSqlite: () => new Set([0]),
  getTokenIndexForQuery: () => ({
    vocab: ['alpha'],
    vocabIndex: new Map([['alpha', 0]]),
    postings: [[[0, 1]]],
    docLengths: [1],
    totalDocs: 1,
    avgDocLen: 1
  }),
  rankSqliteFts: () => {
    sqliteCalls += 1;
    return [{ idx: 0, score: 3 }];
  },
  rankVectorAnnSqlite: () => [],
  sqliteHasFts: () => true,
  sqliteHasTable: (_mode, tableName) => tableName !== 'chunks_fts',
  signal: null,
  rrf: { enabled: false }
});

const idx = {
  chunkMeta: [{ id: 0, file: 'src/prose.md', tokens: ['alpha'], weight: 1 }],
  tokenIndex: {
    vocab: ['alpha'],
    vocabIndex: new Map([['alpha', 0]]),
    postings: [[[0, 1]]],
    docLengths: [1],
    totalDocs: 1,
    avgDocLen: 1
  },
  filterIndex: null,
  fileRelations: null,
  phraseNgrams: null,
  minhash: null,
  denseVec: null
};

const hits = await pipeline(idx, 'prose', null);

assert.equal(sqliteCalls, 0, 'expected sqlite FTS call to be skipped when table is unavailable');
assert.equal(hits.length, 1, 'expected controlled fallback hit result');
assert.equal(hits[0].scoreBreakdown?.sparse?.type, 'bm25', 'expected sparse fallback when FTS table is missing');
assert.equal(hits[0].scoreBreakdown?.sparse?.ftsFallback, true, 'expected explain fallback marker');

console.log('fts missing table fallback test passed');
