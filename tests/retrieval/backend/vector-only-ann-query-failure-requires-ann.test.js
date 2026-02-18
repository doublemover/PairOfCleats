#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createSearchPipeline } from '../../../src/retrieval/pipeline.js';
import { ANN_PROVIDER_IDS } from '../../../src/retrieval/ann/types.js';

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

const pipeline = createSearchPipeline({
  useSqlite: false,
  sqliteFtsRequested: false,
  sqliteFtsRoutingByMode: { byMode: {} },
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
  annEnabled: true,
  annBackend: 'auto',
  scoreBlend: null,
  minhashMaxDocs: null,
  sparseBackend: 'auto',
  profilePolicyByMode: {
    prose: {
      profileId: 'vector_only',
      vectorOnly: true,
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
  buildCandidateSetSqlite: () => null,
  getTokenIndexForQuery: () => null,
  rankSqliteFts: () => [],
  rankVectorAnnSqlite: () => [],
  sqliteHasFts: () => false,
  signal: null,
  rrf: { enabled: false },
  createAnnProviders: () => new Map([
    [ANN_PROVIDER_IDS.DENSE, {
      id: ANN_PROVIDER_IDS.DENSE,
      isAvailable: () => true,
      preflight: async () => true,
      query: async () => {
        throw new Error('query failed');
      }
    }]
  ])
});

const idx = {
  chunkMeta: [{ id: 0, file: 'src/doc.md', tokens: ['alpha'], weight: 1 }],
  tokenIndex: null,
  filterIndex: null,
  fileRelations: null,
  phraseNgrams: null,
  minhash: null,
  denseVec: { vectors: [new Uint8Array([1])], dims: 1, model: 'stub' }
};

let failed = false;
try {
  await pipeline(idx, 'prose', [0.1]);
} catch (err) {
  failed = true;
  assert.equal(err?.code, 'CAPABILITY_MISSING', 'expected controlled capability error');
  assert.equal(err?.reasonCode, 'retrieval_vector_required', 'expected vector-required reason code');
  assert.equal(err?.reason, 'ann_provider_unavailable', 'expected query failure to mark provider unavailable');
  assert.match(String(err?.message || err), /Vector-only search requires ANN/i);
}

if (!failed) {
  throw new Error('Expected vector-only search to fail when ANN query fails');
}

console.log('vector-only ann query failure requires ann test passed');
