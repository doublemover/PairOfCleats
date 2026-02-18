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

const checkedTables = [];

const pipeline = createSearchPipeline({
  useSqlite: true,
  sqliteFtsRequested: false,
  sqliteFtsRoutingByMode: {
    byMode: {
      'extracted-prose': {
        mode: 'extracted-prose',
        desired: 'sparse',
        active: false,
        reason: 'default_sparse'
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
  postingsConfig: { enablePhraseNgrams: false, enableChargrams: false },
  phraseNgramSet: null,
  phraseRange: null,
  explain: false,
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
    'extracted-prose': {
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
  getTokenIndexForQuery: () => {
    throw new Error('getTokenIndexForQuery should not be called for file-backed extracted-prose');
  },
  rankSqliteFts: () => [],
  rankVectorAnnSqlite: () => [],
  sqliteHasDb: (mode) => mode !== 'extracted-prose',
  sqliteHasFts: () => false,
  sqliteHasTable: (mode, table) => {
    checkedTables.push(`${mode}:${table}`);
    return false;
  },
  signal: null,
  rrf: { enabled: false }
});

const idx = {
  chunkMeta: [{ id: 0, file: 'src/a.js', tokens: ['alpha'], weight: 1 }],
  tokenIndex: {
    vocab: ['alpha'],
    postings: [[[0, 1]]],
    docLengths: [1],
    avgDocLen: 1,
    totalDocs: 1
  },
  filterIndex: null,
  fileRelations: null,
  phraseNgrams: null,
  minhash: null,
  denseVec: null
};

const hits = await pipeline(idx, 'extracted-prose', null);
assert.equal(hits.length, 1, 'file-backed extracted-prose should still produce sparse hits');
assert.equal(
  checkedTables.some((entry) => entry.startsWith('extracted-prose:')),
  false,
  'sqlite table checks should not run for non-sqlite extracted-prose mode'
);

console.log('sqlite sparse checks skip non-sqlite extracted-prose test passed');
