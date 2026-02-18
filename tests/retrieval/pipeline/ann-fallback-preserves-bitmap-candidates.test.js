#!/usr/bin/env node
import assert from 'node:assert/strict';
import { buildFilterIndex } from '../../../src/retrieval/filter-index.js';
import { getBitmapSize, isRoaringAvailable } from '../../../src/retrieval/bitmap.js';
import { createSearchPipeline } from '../../../src/retrieval/pipeline.js';
import { ANN_PROVIDER_IDS } from '../../../src/retrieval/ann/types.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();

if (!isRoaringAvailable()) {
  console.log('roaring-wasm not available; skipping ann fallback bitmap candidate test');
  process.exit(0);
}

const providerCandidateKinds = [];
const providerCandidateSizes = [];
const hasCandidateId = (candidateSet, id) => {
  if (!candidateSet) return false;
  if (candidateSet instanceof Set) return candidateSet.has(id);
  if (typeof candidateSet.has === 'function') return candidateSet.has(id);
  if (typeof candidateSet.contains === 'function') return candidateSet.contains(id);
  if (typeof candidateSet.includes === 'function') return candidateSet.includes(id);
  return false;
};

const provider = {
  id: ANN_PROVIDER_IDS.DENSE,
  isAvailable: () => true,
  query: async ({ candidateSet }) => {
    providerCandidateKinds.push(candidateSet instanceof Set ? 'set' : 'bitmap');
    providerCandidateSizes.push(getBitmapSize(candidateSet));
    if (hasCandidateId(candidateSet, 2)) {
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
  annCandidateCap: 100,
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

const chunkMeta = [
  { id: 0, tokens: ['alpha'], weight: 1, file: 'src/a.js', ext: '.js', kind: 'Definition' },
  { id: 1, tokens: ['alpha'], weight: 1, file: 'src/b.js', ext: '.js', kind: 'Definition' },
  { id: 2, tokens: ['gamma'], weight: 1, file: 'src/c.js', ext: '.js', kind: 'Definition' },
  { id: 3, tokens: ['alpha'], weight: 1, file: 'src/d.ts', ext: '.ts', kind: 'Definition' }
];
const filterIndex = buildFilterIndex(chunkMeta);
// Force dynamic bitmap output in filterChunkIds by removing bitmap min-size metadata.
filterIndex.bitmap = null;

const idx = {
  chunkMeta,
  tokenIndex: {
    vocab: ['alpha'],
    postings: [
      [[0, 1], [1, 1], [3, 1]]
    ],
    docLengths: [1, 1, 1, 1],
    totalDocs: 4,
    avgDocLen: 1
  },
  filterIndex,
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

assert.equal(providerCandidateKinds.length, 2, 'expected fallback ANN retry under active filters');
assert.equal(providerCandidateKinds[0], 'set', 'expected primary ANN query to use BM-constrained Set candidates');
assert.equal(providerCandidateKinds[1], 'bitmap', 'expected ANN fallback query to keep bitmap allowlist candidates');
assert.deepEqual(providerCandidateSizes, [2, 3], 'expected fallback candidate sizes to reflect BM and filtered allowlist cohorts');
assert.ok(
  results.some((entry) => entry.id === 2 && entry.annSource === ANN_PROVIDER_IDS.DENSE),
  'expected fallback ANN hit from bitmap allowlist expansion'
);

console.log('ann fallback preserves bitmap candidate set test passed');
