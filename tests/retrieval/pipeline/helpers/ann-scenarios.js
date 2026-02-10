import { createSearchPipeline } from '../../../../src/retrieval/pipeline.js';
import { createRetrievalStageTracker } from '../../../../src/retrieval/pipeline/stage-checkpoints.js';
import { applyTestEnv } from '../../../helpers/test-env.js';

const createAnnAvailabilityState = () => ({
  code: { available: false },
  prose: { available: false },
  records: { available: false },
  'extracted-prose': { available: false }
});

const createAnnUsageState = () => ({
  code: false,
  prose: false,
  records: false,
  'extracted-prose': false
});

export const buildAnnPipelineFixture = ({ createAnnProviders = () => new Map() } = {}) => {
  applyTestEnv();

  const stageTracker = createRetrievalStageTracker({ enabled: true });
  const context = {
    useSqlite: false,
    sqliteFtsRequested: false,
    sqliteFtsNormalize: false,
    sqliteFtsProfile: 'balanced',
    sqliteFtsWeights: null,
    bm25K1: 1.2,
    bm25B: 0.75,
    fieldWeights: null,
    postingsConfig: {
      enablePhraseNgrams: false,
      enableChargrams: false,
      phraseMinN: 2,
      phraseMaxN: 3,
      chargramMinN: 3,
      chargramMaxN: 3
    },
    queryTokens: ['alpha'],
    queryAst: null,
    phraseNgramSet: null,
    phraseRange: null,
    explain: false,
    symbolBoost: { enabled: false },
    filters: {},
    filtersActive: false,
    topN: 2,
    maxCandidates: null,
    annEnabled: true,
    annBackend: 'dense',
    scoreBlend: null,
    minhashMaxDocs: null,
    sparseBackend: 'auto',
    vectorAnnState: createAnnAvailabilityState(),
    vectorAnnUsed: createAnnUsageState(),
    hnswAnnState: createAnnAvailabilityState(),
    hnswAnnUsed: createAnnUsageState(),
    lanceAnnState: createAnnAvailabilityState(),
    lanceAnnUsed: createAnnUsageState(),
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
    createAnnProviders
  };

  const idx = {
    chunkMeta: [
      { id: 0, file: 'src/a.js', tokens: ['alpha'], weight: 1 },
      { id: 1, file: 'src/b.js', tokens: ['alpha', 'beta'], weight: 1 }
    ],
    tokenIndex: {
      vocab: ['alpha', 'beta'],
      postings: [
        [[0, 1], [1, 1]],
        [[1, 1]]
      ],
      docLengths: [1, 2],
      totalDocs: 2,
      avgDocLen: 1.5
    },
    denseVec: {
      vectors: [
        [0.1, 0.2],
        [0.2, 0.1]
      ],
      dims: 2,
      minVal: -1,
      maxVal: 1,
      levels: 256,
      scale: 1
    },
    filterIndex: null,
    fileRelations: null,
    repoMap: null,
    minhash: null
  };

  return { stageTracker, context, idx };
};

export const runAnnFallbackScenario = async ({
  createAnnProviders,
  vector = [0.1, 0.2],
  runs = 1
} = {}) => {
  const { stageTracker, context, idx } = buildAnnPipelineFixture({ createAnnProviders });
  const pipeline = createSearchPipeline(context);
  const outputs = [];
  for (let i = 0; i < runs; i += 1) {
    outputs.push(await pipeline(idx, 'code', vector));
  }
  return { outputs, stageTracker };
};
