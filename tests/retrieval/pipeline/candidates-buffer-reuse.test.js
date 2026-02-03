#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createSearchPipeline } from '../../../src/retrieval/pipeline.js';
import { createCandidatePool } from '../../../src/retrieval/pipeline/candidate-pool.js';
import { createScoreBufferPool } from '../../../src/retrieval/pipeline/score-buffer.js';

process.env.PAIROFCLEATS_TESTING = '1';

const candidatePool = createCandidatePool({ maxSets: 2, maxEntries: 100 });
const scoreBufferPool = createScoreBufferPool({ maxBuffers: 2, maxEntries: 100 });

const context = {
  useSqlite: false,
  sqliteFtsRequested: false,
  sqliteFtsNormalize: false,
  sqliteFtsProfile: 'balanced',
  sqliteFtsWeights: null,
  bm25K1: 1.2,
  bm25B: 0.75,
  fieldWeights: null,
  postingsConfig: {
    enablePhraseNgrams: false,
    enableChargrams: false,
    phraseMinN: 2,
    phraseMaxN: 3,
    chargramMinN: 3,
    chargramMaxN: 3
  },
  queryTokens: ['alpha'],
  queryAst: null,
  phraseNgramSet: null,
  phraseRange: null,
  explain: false,
  symbolBoost: { enabled: false },
  filters: {},
  filtersActive: false,
  topN: 2,
  maxCandidates: null,
  annEnabled: false,
  annBackend: 'js',
  scoreBlend: null,
  minhashMaxDocs: null,
  sparseBackend: 'auto',
  vectorAnnState: {
    code: { available: false },
    prose: { available: false },
    records: { available: false },
    'extracted-prose': { available: false }
  },
  vectorAnnUsed: {
    code: false,
    prose: false,
    records: false,
    'extracted-prose': false
  },
  hnswAnnState: {
    code: { available: false },
    prose: { available: false },
    records: { available: false },
    'extracted-prose': { available: false }
  },
  hnswAnnUsed: {
    code: false,
    prose: false,
    records: false,
    'extracted-prose': false
  },
  lanceAnnState: {
    code: { available: false },
    prose: { available: false },
    records: { available: false },
    'extracted-prose': { available: false }
  },
  lanceAnnUsed: {
    code: false,
    prose: false,
    records: false,
    'extracted-prose': false
  },
  lancedbConfig: {},
  buildCandidateSetSqlite: () => null,
  getTokenIndexForQuery: () => null,
  rankSqliteFts: () => ({ hits: [], type: 'fts' }),
  rankVectorAnnSqlite: () => [],
  sqliteHasFts: () => false,
  signal: null,
  rrf: { enabled: false },
  graphRankingConfig: { enabled: false },
  candidatePool,
  scoreBufferPool
};

const idx = {
  chunkMeta: [
    { id: 0, file: 'src/a.js', tokens: ['alpha'], weight: 1 },
    { id: 1, file: 'src/b.js', tokens: ['alpha', 'beta'], weight: 1 }
  ],
  tokenIndex: {
    vocab: ['alpha', 'beta'],
    postings: [
      [[0, 1], [1, 1]],
      [[1, 1]]
    ],
    docLengths: [1, 2],
    totalDocs: 2,
    avgDocLen: 1.5
  },
  filterIndex: null,
  fileRelations: null,
  repoMap: null,
  minhash: null
};

const pipeline = createSearchPipeline(context);

await pipeline(idx, 'code', null);
const allocationsAfterFirst = {
  candidate: candidatePool.stats.allocations,
  score: scoreBufferPool.stats.allocations
};

await pipeline(idx, 'code', null);

assert.ok(candidatePool.stats.reuses > 0, 'expected candidate pool reuse');
assert.ok(scoreBufferPool.stats.reuses > 0, 'expected score buffer reuse');
assert.equal(candidatePool.stats.allocations, allocationsAfterFirst.candidate, 'no extra candidate allocations');
assert.equal(scoreBufferPool.stats.allocations, allocationsAfterFirst.score, 'no extra score allocations');

console.log('candidates buffer reuse test passed');
