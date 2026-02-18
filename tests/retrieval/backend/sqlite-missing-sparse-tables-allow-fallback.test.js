#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createSearchPipeline } from '../../../src/retrieval/pipeline.js';
import { SimpleMinHash } from '../../../src/index/minhash.js';

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

const signatureForTokens = (tokens) => {
  const minhash = new SimpleMinHash();
  for (const token of tokens) minhash.update(token);
  return minhash.hashValues.slice();
};

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
      allowSparseFallback: true
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
  chunkMeta: [
    { id: 0, file: 'src/a.js', tokens: ['alpha', 'core'], weight: 1 },
    { id: 1, file: 'src/b.js', tokens: ['alpha', 'extra'], weight: 1 }
  ],
  minhash: {
    signatures: [
      signatureForTokens(['alpha', 'core']),
      signatureForTokens(['alpha', 'extra'])
    ]
  },
  tokenIndex: null,
  filterIndex: null,
  fileRelations: null,
  phraseNgrams: null,
  denseVec: null
};

const hits = await pipeline(idx, 'code', null);

assert.ok(hits.length > 0, 'expected ANN fallback hits when sparse is unavailable and fallback policy is enabled');
assert.ok(hits.every((entry) => entry.annSource === 'minhash'), 'expected minhash ANN fallback source');

console.log('sqlite missing sparse tables allow fallback test passed');
