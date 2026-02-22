#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createSearchPipeline } from '../../../src/retrieval/pipeline.js';
import { ANN_PROVIDER_IDS } from '../../../src/retrieval/ann/types.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();

const annCandidateSets = [];
const provider = {
  id: ANN_PROVIDER_IDS.DENSE,
  isAvailable: () => true,
  query: async ({ candidateSet }) => {
    const resolved = candidateSet
      ? Array.from(candidateSet).sort((a, b) => a - b)
      : null;
    annCandidateSets.push(resolved);
    if (candidateSet && candidateSet.has(2)) {
      return [{ idx: 2, sim: 0.95 }];
    }
    return [];
  }
};

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
  topN: 3,
  maxCandidates: 50,
  annEnabled: true,
  annBackend: ANN_PROVIDER_IDS.DENSE,
  annCandidateCap: 0.5,
  annCandidateMinDocCount: 1,
  annCandidateMaxDocCount: 100,
  scoreBlend: { enabled: false },
  minhashMaxDocs: null,
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
  createAnnProviders: () => new Map([[ANN_PROVIDER_IDS.DENSE, provider]])
});

const idx = {
  chunkMeta: [
    { id: 0, tokens: ['alpha'], weight: 1, file: 'src/a.js', kind: 'Definition' },
    { id: 1, tokens: ['alpha'], weight: 1, file: 'src/b.js', kind: 'Definition' },
    { id: 2, tokens: ['gamma'], weight: 1, file: 'src/c.js', kind: 'Definition' },
    { id: 3, tokens: ['alpha'], weight: 1, file: 'src/d.ts', kind: 'Definition' }
  ],
  tokenIndex: {
    vocab: ['alpha'],
    postings: [
      [[0, 1], [1, 1], [3, 1]]
    ],
    docLengths: [1, 1, 1, 1],
    totalDocs: 4,
    avgDocLen: 1
  },
  denseVec: {
    vectors: [
      [0.1, 0.1],
      [0.2, 0.2],
      [0.9, 0.9],
      [0.3, 0.3]
    ]
  },
  minhash: { signatures: [] }
};

const results = await pipeline(idx, 'code', [0.4, 0.4]);

assert.equal(
  annCandidateSets.length,
  2,
  'expected ANN fallback retry when fractional cap is clamped to one candidate'
);
assert.deepEqual(
  annCandidateSets[0],
  [0, 1],
  'expected first ANN attempt to use BM-constrained filtered candidates'
);
assert.deepEqual(
  annCandidateSets[1],
  [0, 1, 2],
  'expected ANN fallback attempt to expand to full allowed filter set'
);
assert.ok(
  results.some((entry) => entry.id === 2 && entry.annSource === ANN_PROVIDER_IDS.DENSE),
  'expected fallback ANN hit from allowed set outside BM-derived subset'
);

console.log('ann fallback filtered-too-large fractional cap test passed');
