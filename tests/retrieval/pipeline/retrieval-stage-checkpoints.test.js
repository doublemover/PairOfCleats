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
  topN: 3,
  maxCandidates: null,
  annEnabled: true,
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
  stageTracker
};

const idx = {
  chunkMeta: [
    {
      id: 0,
      file: 'src/a.js',
      start: 0,
      end: 10,
      tokens: ['alpha'],
      weight: 1
    }
  ],
  tokenIndex: {
    vocab: ['alpha'],
    postings: [[[0, 1]]],
    docLengths: [1],
    totalDocs: 1,
    avgDocLen: 1
  },
  filterIndex: null,
  fileRelations: null,
  repoMap: null,
  minhash: null
};

const pipeline = createSearchPipeline(context);
await pipeline(idx, 'code', [0, 0]);

const stages = stageTracker.stages.map((entry) => entry.stage);
assert.ok(stages.includes('filter'), 'expected filter stage');
assert.ok(stages.includes('candidates'), 'expected candidates stage');
assert.ok(stages.includes('ann'), 'expected ann stage');
assert.ok(stages.includes('fusion'), 'expected fusion stage');
assert.ok(stages.includes('rank'), 'expected rank stage');

console.log('retrieval stage checkpoints test passed');
