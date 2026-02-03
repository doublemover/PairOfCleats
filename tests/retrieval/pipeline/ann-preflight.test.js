#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createSearchPipeline } from '../../../src/retrieval/pipeline.js';
import { createRetrievalStageTracker } from '../../../src/retrieval/pipeline/stage-checkpoints.js';
import { ANN_PROVIDER_IDS } from '../../../src/retrieval/ann/types.js';

process.env.PAIROFCLEATS_TESTING = '1';

let preflightCalls = 0;
let queryCalls = 0;

const provider = {
  id: ANN_PROVIDER_IDS.DENSE,
  isAvailable: () => true,
  preflight: async () => {
    preflightCalls += 1;
    return false;
  },
  query: async () => {
    queryCalls += 1;
    return [{ idx: 0, sim: 0.9 }];
  }
};

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
  createAnnProviders: () => new Map([[ANN_PROVIDER_IDS.DENSE, provider]])
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
const resultsAgain = await pipeline(idx, 'code', [0.1, 0.2]);

assert.ok(results.length > 0, 'expected sparse fallback results');
assert.ok(resultsAgain.length > 0, 'expected sparse fallback results on second run');
assert.equal(preflightCalls, 1, 'expected preflight to run once');
assert.equal(queryCalls, 0, 'expected ANN query to be skipped after preflight failure');

const annStages = stageTracker.stages.filter((entry) => entry.stage === 'ann');
const lastAnnStage = annStages[annStages.length - 1];
assert.ok(lastAnnStage, 'expected ann stage to be recorded');
assert.equal(lastAnnStage.warned, true, 'expected ann fallback warning');
assert.equal(lastAnnStage.providerAvailable, false, 'expected provider to be unavailable after preflight failure');

console.log('ann preflight test passed');
