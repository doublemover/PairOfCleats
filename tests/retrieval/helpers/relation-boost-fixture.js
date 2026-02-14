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

export const createRelationBoostPipeline = ({
  query = 'alpha',
  queryTokens = ['alpha'],
  explain = true,
  filters = {},
  relationBoost = { enabled: true },
  rankSqliteFts = () => [{ idx: 0, score: 1 }],
  annEnabled = false,
  annBackend = 'auto',
  annCandidateCap = 20000,
  annCandidateMinDocCount = 100,
  annCandidateMaxDocCount = 20000,
  vectorAnnAvailable = false,
  rankVectorAnnSqlite = () => []
} = {}) => createSearchPipeline({
  useSqlite: true,
  sqliteFtsRequested: true,
  sqliteFtsRoutingByMode: {
    byMode: {
      code: {
        desired: 'fts',
        route: 'fts'
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
  query,
  queryTokens,
  queryAst: null,
  bm25K1: 1.2,
  bm25B: 0.75,
  fieldWeights: null,
  postingsConfig: { enablePhraseNgrams: false, enableChargrams: false },
  phraseNgramSet: null,
  phraseRange: null,
  explain,
  symbolBoost: { enabled: false },
  relationBoost,
  filters,
  filtersActive: false,
  topN: 10,
  annEnabled,
  annBackend,
  scoreBlend: null,
  annCandidateCap,
  annCandidateMinDocCount,
  annCandidateMaxDocCount,
  minhashMaxDocs: null,
  sparseBackend: 'auto',
  vectorAnnState: {
    ...makeAnnState(),
    code: { available: vectorAnnAvailable },
    prose: { available: false },
    records: { available: false },
    'extracted-prose': { available: false }
  },
  vectorAnnUsed: makeAnnUsed(),
  hnswAnnState: makeAnnState(),
  hnswAnnUsed: makeAnnUsed(),
  lanceAnnState: makeAnnState(),
  lanceAnnUsed: makeAnnUsed(),
  lancedbConfig: {},
  buildCandidateSetSqlite: () => new Set([0]),
  getTokenIndexForQuery: () => ({
    vocab: ['alpha'],
    vocabIndex: new Map([['alpha', 0]]),
    postings: [[[0, 1]]],
    docLengths: [1],
    totalDocs: 1,
    avgDocLen: 1
  }),
  rankSqliteFts,
  rankVectorAnnSqlite,
  sqliteHasFts: () => true,
  signal: null,
  rrf: { enabled: false }
});

export const createRelationBoostIndex = ({
  chunks = [],
  fileRelations = null
} = {}) => ({
  chunkMeta: chunks,
  tokenIndex: {
    vocab: ['alpha'],
    vocabIndex: new Map([['alpha', 0]]),
    postings: [[[0, 1]]],
    docLengths: chunks.map(() => 1),
    totalDocs: chunks.length,
    avgDocLen: 1
  },
  filterIndex: null,
  fileRelations,
  phraseNgrams: null,
  minhash: null,
  denseVec: null
});
