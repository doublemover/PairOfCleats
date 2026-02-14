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

const sqliteCalls = [];
const rankSqliteFts = (_idx, _tokens, mode) => {
  sqliteCalls.push(mode);
  return [{ idx: 0, score: 2 }];
};

const routingPolicy = resolveSqliteFtsRoutingByMode({
  useSqlite: true,
  sqliteFtsRequested: true,
  sqliteFtsExplicit: false,
  runCode: true,
  runProse: true,
  runExtractedProse: false,
  runRecords: false
});

assert.equal(routingPolicy.byMode.code.desired, 'sparse', 'expected code mode default sparse route');
assert.equal(routingPolicy.byMode.prose.desired, 'fts', 'expected prose mode default fts route');

const pipeline = createSearchPipeline({
  useSqlite: true,
  sqliteFtsRequested: true,
  sqliteFtsRoutingByMode: routingPolicy,
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
  getTokenIndexForQuery: (tokens, mode) => (mode === 'code' ? {
    vocab: ['alpha'],
    vocabIndex: new Map([['alpha', 0]]),
    postings: [[[0, 1]]],
    docLengths: [1],
    totalDocs: 1,
    avgDocLen: 1
  } : null),
  rankSqliteFts,
  rankVectorAnnSqlite: () => [],
  sqliteHasFts: () => true,
  signal: null,
  rrf: { enabled: false }
});

const idx = {
  chunkMeta: [{ id: 0, file: 'src/a.js', tokens: ['alpha'], weight: 1 }],
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

const codeHits = await pipeline(idx, 'code', null);
const proseHits = await pipeline(idx, 'prose', null);

assert.equal(sqliteCalls.length, 1, 'expected sqlite FTS to run only for prose mode');
assert.equal(sqliteCalls[0], 'prose', 'expected sqlite FTS call for prose mode');
assert.equal(codeHits.length, 1, 'expected code mode result');
assert.equal(codeHits[0].scoreBreakdown?.sparse?.type, 'bm25', 'expected code mode sparse fallback');
assert.equal(proseHits.length, 1, 'expected prose mode result');
assert.equal(proseHits[0].scoreBreakdown?.sparse?.type, 'fts', 'expected prose mode to route to fts');
assert.equal(typeof proseHits[0].scoreBreakdown?.sparse?.match, 'string', 'expected explain MATCH output for prose fts');

console.log('search routing policy test passed');
