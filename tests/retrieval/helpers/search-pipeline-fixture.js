import { createSearchPipeline } from '../../../src/retrieval/pipeline.js';

export const makeAnnState = () => ({
  code: { available: false },
  prose: { available: false },
  records: { available: false },
  'extracted-prose': { available: false }
});

export const makeAnnUsed = () => ({
  code: false,
  prose: false,
  records: false,
  'extracted-prose': false
});

export const createAlphaTokenIndex = (docCount = 1) => ({
  vocab: ['alpha'],
  vocabIndex: new Map([['alpha', 0]]),
  postings: [[[0, 1]]],
  docLengths: new Array(docCount).fill(1),
  totalDocs: docCount,
  avgDocLen: 1
});

export const createAlphaSearchIndex = ({
  chunks = [{ id: 0, file: 'src/a.js', tokens: ['alpha'], weight: 1 }],
  tokenIndex = createAlphaTokenIndex(chunks.length),
  fileRelations = null,
  repoMap = null,
  denseVec = null
} = {}) => ({
  chunkMeta: chunks,
  tokenIndex,
  filterIndex: null,
  fileRelations,
  repoMap,
  phraseNgrams: null,
  minhash: null,
  denseVec
});

export const createSearchPipelineFixture = (overrides = {}) => createSearchPipeline({
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
  annEnabled: false,
  annBackend: 'auto',
  scoreBlend: null,
  minhashMaxDocs: null,
  sparseBackend: 'auto',
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
  ...overrides
});
