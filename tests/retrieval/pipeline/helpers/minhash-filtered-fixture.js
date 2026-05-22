import { SimpleMinHash } from '../../../../src/index/minhash.js';
import { createRetrievalStageTracker } from '../../../../src/retrieval/pipeline/stage-checkpoints.js';
import { applyTestEnv } from '../../../helpers/test-env.js';
import { createInMemorySearchPipeline } from './in-memory-search-pipeline-fixture.js';

const signatureForTokens = (tokens) => {
  const minhash = new SimpleMinHash();
  for (const token of tokens) minhash.update(token);
  return minhash.hashValues.slice();
};

export const createFilteredMinhashIndex = () => ({
  chunkMeta: [
    { id: 0, file: 'src/a.js', tokens: ['alpha', 'core'], weight: 1 },
    { id: 1, file: 'src/b.js', tokens: ['alpha', 'extra'], weight: 1 },
    { id: 2, file: 'src/c.js', tokens: ['gamma'], weight: 1 },
    { id: 3, file: 'src/d.ts', tokens: ['alpha'], weight: 1 }
  ],
  tokenIndex: {
    vocab: ['alpha', 'gamma'],
    postings: [
      [[0, 1], [1, 1], [3, 1]],
      [[2, 1]]
    ],
    docLengths: [2, 2, 1, 1],
    totalDocs: 4,
    avgDocLen: 1.5
  },
  denseVec: {
    vectors: [
      [0.1, 0.1],
      [0.2, 0.2],
      [0.3, 0.3],
      [0.4, 0.4]
    ]
  },
  minhash: {
    signatures: [
      signatureForTokens(['alpha', 'core']),
      signatureForTokens(['alpha', 'extra']),
      signatureForTokens(['gamma']),
      signatureForTokens(['alpha'])
    ]
  }
});

export const createFilteredMinhashPipelineFixture = ({
  provider,
  topN
}) => {
  applyTestEnv();

  const stageTracker = createRetrievalStageTracker({ enabled: true });
  const pipeline = createInMemorySearchPipeline({
    provider,
    topN,
    filters: { ext: ['js'] },
    filtersActive: true,
    annCandidateCap: 100,
    annCandidateMinDocCount: 3,
    minhashMaxDocs: 2,
    stageTracker
  });

  return {
    idx: createFilteredMinhashIndex(),
    pipeline,
    stageTracker
  };
};
