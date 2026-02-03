#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createSearchPipeline } from '../../../src/retrieval/pipeline.js';
import { createRetrievalStageTracker } from '../../../src/retrieval/pipeline/stage-checkpoints.js';

process.env.PAIROFCLEATS_TESTING = '1';

const stageTracker = createRetrievalStageTracker({ enabled: true });

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
  annEnabled: true,
  annBackend: 'dense',
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
  stageTracker,
  createAnnProviders: () => new Map()
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
  denseVec: {
    vectors: [
      [0.1, 0.2],
      [0.2, 0.1]
    ],
    dims: 2,
    minVal: -1,
    maxVal: 1,
    levels: 256,
    scale: 1
  },
  filterIndex: null,
  fileRelations: null,
  repoMap: null,
  minhash: null
};

const pipeline = createSearchPipeline(context);
const results = await pipeline(idx, 'code', [0.1, 0.2]);

assert.ok(Array.isArray(results) && results.length > 0, 'expected sparse results to return');

const annStage = stageTracker.stages.find((entry) => entry.stage === 'ann');
assert.ok(annStage, 'expected ann stage');
assert.equal(annStage.warned, true, 'expected ann fallback warning');
assert.equal(annStage.providerAvailable, false, 'expected ann provider to be unavailable');

console.log('ann optional skip test passed');
