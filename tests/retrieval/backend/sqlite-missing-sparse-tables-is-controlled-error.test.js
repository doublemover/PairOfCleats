#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createSearchPipeline } from '../../../src/retrieval/pipeline.js';

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
  useSqlite: true,
  sqliteFtsRequested: false,
  sqliteFtsRoutingByMode: {
    byMode: {
      code: {
        mode: 'code',
        desired: 'sparse',
        active: false,
        reason: 'default_code_sparse'
      }
    }
  },
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
  postingsConfig: { enablePhraseNgrams: true, enableChargrams: true },
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
  profilePolicyByMode: {
    code: {
      profileId: 'default',
      vectorOnly: false,
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
  sqliteHasTable: (_mode, _table) => false,
  signal: null,
  rrf: { enabled: false }
});

const idx = {
  chunkMeta: [{ id: 0, file: 'src/a.js', tokens: ['alpha'], weight: 1 }],
  tokenIndex: null,
  filterIndex: null,
  fileRelations: null,
  phraseNgrams: null,
  minhash: null,
  denseVec: null
};

let failed = false;
try {
  await pipeline(idx, 'code', null);
} catch (err) {
  failed = true;
  assert.equal(err?.code, 'CAPABILITY_MISSING', 'expected controlled capability error');
  assert.equal(err?.reasonCode, 'retrieval_sparse_unavailable', 'expected sparse unavailable reason code');
  assert.match(String(err?.message || err), /Sparse retrieval backend is unavailable/i);
}

if (!failed) {
  throw new Error('Expected missing sparse tables to produce a controlled error');
}

console.log('sqlite missing sparse tables controlled error test passed');
