import { ANN_PROVIDER_IDS } from '../../../../src/retrieval/ann/types.js';
import { createSearchPipeline } from '../../../../src/retrieval/pipeline.js';

export const createAvailableDenseAnnProvider = (query) => ({
  id: ANN_PROVIDER_IDS.DENSE,
  isAvailable: () => true,
  query
});

export const createAnnProviderMap = (provider) => (
  provider
    ? new Map([[provider.id || ANN_PROVIDER_IDS.DENSE, provider]])
    : new Map()
);

export const createInMemorySearchPipelineContext = ({
  provider,
  createAnnProviders,
  query = 'alpha',
  queryTokens = ['alpha'],
  filters = {},
  filtersActive = false,
  topN = 2,
  maxCandidates = 50,
  annCandidateCap = 100,
  annCandidateMinDocCount = 1,
  annCandidateMaxDocCount = 100,
  minhashMaxDocs = null,
  stageTracker,
  overrides = {}
} = {}) => ({
  useSqlite: false,
  sqliteFtsRequested: false,
  sqliteFtsNormalize: false,
  sqliteFtsProfile: null,
  sqliteFtsWeights: null,
  bm25K1: 1.2,
  bm25B: 0.75,
  fieldWeights: null,
  postingsConfig: { enablePhraseNgrams: false, enableChargrams: false },
  query,
  queryTokens,
  queryAst: null,
  phraseNgramSet: null,
  phraseRange: null,
  explain: false,
  symbolBoost: { enabled: false },
  relationBoost: { enabled: false },
  filters,
  filtersActive,
  filterPredicates: null,
  topN,
  maxCandidates,
  annEnabled: true,
  annBackend: ANN_PROVIDER_IDS.DENSE,
  annCandidateCap,
  annCandidateMinDocCount,
  annCandidateMaxDocCount,
  scoreBlend: { enabled: false },
  minhashMaxDocs,
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
  createAnnProviders: typeof createAnnProviders === 'function'
    ? createAnnProviders
    : () => createAnnProviderMap(provider),
  ...overrides
});

export const createInMemorySearchPipeline = (options = {}) => (
  createSearchPipeline(createInMemorySearchPipelineContext(options))
);
