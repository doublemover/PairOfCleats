import { resolveSqliteFtsRoutingByMode } from '../../../src/retrieval/routing-policy.js';
import {
  createAlphaSearchIndex,
  createAlphaTokenIndex,
  createSearchPipelineFixture
} from '../helpers/search-pipeline-fixture.js';

export const EXPECTED_SCORE_BREAKDOWN_KEYS = [
  'schemaVersion',
  'selected',
  'sparse',
  'ann',
  'rrf',
  'blend',
  'symbol',
  'phrase',
  'relation',
  'graph'
];

export const createScoreBreakdownHits = async () => {
  const pipeline = createSearchPipelineFixture({
    useSqlite: true,
    sqliteFtsRequested: true,
    sqliteFtsRoutingByMode: resolveSqliteFtsRoutingByMode({
      useSqlite: true,
      sqliteFtsRequested: true,
      sqliteFtsExplicit: false,
      runCode: true,
      runProse: true,
      runExtractedProse: false,
      runRecords: false
    }),
    topN: 3,
    buildCandidateSetSqlite: () => new Set([0]),
    getTokenIndexForQuery: () => createAlphaTokenIndex(),
    rankSqliteFts: () => [{ idx: 0, score: 2 }],
    sqliteHasFts: (mode) => mode === 'prose'
  });

  const idx = createAlphaSearchIndex();
  return {
    codeHit: (await pipeline(idx, 'code', null))[0],
    proseHit: (await pipeline(idx, 'prose', null))[0]
  };
};
