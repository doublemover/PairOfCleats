#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createSearchPipeline } from '../../../src/retrieval/pipeline.js';

let sqliteCalls = 0;
const rankSqliteFts = () => {
  sqliteCalls += 1;
  return [{ idx: 0, score: 1 }];
};

const vectorAnnState = {
  code: { available: false },
  prose: { available: false },
  records: { available: false },
  'extracted-prose': { available: false }
};
const vectorAnnUsed = {
  code: false,
  prose: false,
  records: false,
  'extracted-prose': false
};
const hnswAnnState = {
  code: { available: false },
  prose: { available: false },
  records: { available: false },
  'extracted-prose': { available: false }
};
const hnswAnnUsed = { ...vectorAnnUsed };
const lanceAnnState = { ...hnswAnnState };
const lanceAnnUsed = { ...vectorAnnUsed };

const pipeline = createSearchPipeline({
  useSqlite: true,
  sqliteFtsRequested: true,
  sqliteFtsNormalize: false,
  sqliteFtsProfile: null,
  sqliteFtsWeights: [],
  bm25K1: 1.2,
  bm25B: 0.75,
  fieldWeights: null,
  postingsConfig: { enablePhraseNgrams: false, enableChargrams: false },
  queryTokens: ['hello'],
  queryAst: null,
  phraseNgramSet: null,
  phraseRange: null,
  explain: false,
  symbolBoost: null,
  filters: { filePrefilter: { enabled: true } },
  filtersActive: undefined,
  topN: 5,
  annEnabled: false,
  annBackend: 'auto',
  scoreBlend: null,
  minhashMaxDocs: null,
  sparseBackend: 'auto',
  vectorAnnState,
  vectorAnnUsed,
  hnswAnnState,
  hnswAnnUsed,
  lanceAnnState,
  lanceAnnUsed,
  lancedbConfig: {},
  buildCandidateSetSqlite: () => new Set(),
  getTokenIndexForQuery: () => null,
  rankSqliteFts,
  rankVectorAnnSqlite: () => [],
  sqliteHasFts: () => true,
  signal: null,
  rrf: { enabled: false }
});

const idx = {
  chunkMeta: [{ id: 0, file: 'foo.js', tokens: [] }],
  fileRelations: null,
  filterIndex: null,
  phraseNgrams: null,
  minhash: null,
  denseVec: null
};

const hits = await pipeline(idx, 'code', null);
assert.equal(sqliteCalls, 1, 'expected sqlite FTS to be invoked when filters are internal-only');
assert.equal(hits.length, 1, 'expected a single hit from sqlite FTS');
assert.equal(hits[0].file, 'foo.js');

console.log('sqlite FTS eligibility test passed');
