#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createSearchPipeline } from '../../../src/retrieval/pipeline.js';
import { createRetrievalStageTracker } from '../../../src/retrieval/pipeline/stage-checkpoints.js';
import { ANN_PROVIDER_IDS } from '../../../src/retrieval/ann/types.js';
import { SimpleMinHash } from '../../../src/index/minhash.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();

const signatureForTokens = (tokens) => {
  const minhash = new SimpleMinHash();
  for (const token of tokens) minhash.update(token);
  return minhash.hashValues.slice();
};

const providerCandidateSizes = [];
const provider = {
  id: ANN_PROVIDER_IDS.DENSE,
  isAvailable: () => true,
  query: async ({ candidateSet }) => {
    providerCandidateSizes.push(candidateSet instanceof Set ? candidateSet.size : null);
    return [];
  }
};

const stageTracker = createRetrievalStageTracker({ enabled: true });
const pipeline = createSearchPipeline({
  useSqlite: false,
  sqliteFtsRequested: false,
  sqliteFtsNormalize: false,
  sqliteFtsProfile: null,
  sqliteFtsWeights: null,
  bm25K1: 1.2,
  bm25B: 0.75,
  fieldWeights: null,
  postingsConfig: { enablePhraseNgrams: false, enableChargrams: false },
  query: 'alpha',
  queryTokens: ['alpha'],
  queryAst: null,
  phraseNgramSet: null,
  phraseRange: null,
  explain: false,
  symbolBoost: { enabled: false },
  relationBoost: { enabled: false },
  filters: { ext: ['js'] },
  filtersActive: true,
  filterPredicates: null,
  topN: 2,
  maxCandidates: 50,
  annEnabled: true,
  annBackend: ANN_PROVIDER_IDS.DENSE,
  annCandidateCap: 100,
  annCandidateMinDocCount: 3,
  annCandidateMaxDocCount: 100,
  minhashMaxDocs: 2,
  scoreBlend: { enabled: false },
  sparseBackend: 'auto',
  vectorAnnState: { code: { available: false } },
  vectorAnnUsed: null,
  hnswAnnState: { code: { available: false } },
  hnswAnnUsed: null,
  lanceAnnState: { code: { available: false } },
  lanceAnnUsed: null,
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
});

const idx = {
  chunkMeta: [
    { id: 0, file: 'src/a.js', tokens: ['alpha', 'core'], weight: 1 },
    { id: 1, file: 'src/b.js', tokens: ['alpha', 'extra'], weight: 1 },
    { id: 2, file: 'src/c.js', tokens: ['gamma'], weight: 1 },
    { id: 3, file: 'src/d.ts', tokens: ['alpha'], weight: 1 }
  ],
  tokenIndex: {
    vocab: ['alpha', 'gamma'],
    postings: [
      [[0, 1], [1, 1], [3, 1]],
      [[2, 1]]
    ],
    docLengths: [2, 2, 1, 1],
    totalDocs: 4,
    avgDocLen: 1.5
  },
  denseVec: {
    vectors: [
      [0.1, 0.1],
      [0.2, 0.2],
      [0.3, 0.3],
      [0.4, 0.4]
    ]
  },
  minhash: {
    signatures: [
      signatureForTokens(['alpha', 'core']),
      signatureForTokens(['alpha', 'extra']),
      signatureForTokens(['gamma']),
      signatureForTokens(['alpha'])
    ]
  }
};

await pipeline(idx, 'code', [0.1, 0.2]);

assert.deepEqual(
  providerCandidateSizes,
  [3],
  'expected ANN policy to query provider with oversized filtered fallback set'
);

const annStage = stageTracker.stages.find((entry) => entry.stage === 'ann');
assert.equal(
  annStage?.candidatePolicy?.reason,
  'filtersActiveAllowedIdx',
  'expected ann candidate policy to promote undersized BM set to allowedIdx under filters'
);
assert.equal(
  annStage?.source,
  'minhash',
  'expected minhash fallback to still run on BM subset when allowedIdx fallback exceeds minhashMaxDocs'
);
assert.ok(
  Number.isFinite(annStage?.hits) && annStage.hits > 0,
  'expected minhash fallback hits for BM-constrained filtered set'
);

console.log('minhash filtered oversized fallback test passed');
