#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createSearchPipeline } from '../../../src/retrieval/pipeline.js';
import { resolveSqliteFtsRoutingByMode } from '../../../src/retrieval/routing-policy.js';

const expectedKeys = [
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
  topN: 3,
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
  buildCandidateSetSqlite: () => new Set([0]),
  getTokenIndexForQuery: () => ({
    vocab: ['alpha'],
    vocabIndex: new Map([['alpha', 0]]),
    postings: [[[0, 1]]],
    docLengths: [1],
    totalDocs: 1,
    avgDocLen: 1
  }),
  rankSqliteFts: () => [{ idx: 0, score: 2 }],
  rankVectorAnnSqlite: () => [],
  sqliteHasFts: (mode) => mode === 'prose',
  signal: null,
  rrf: { enabled: false }
});

const idx = {
  chunkMeta: [{ id: 0, file: 'src/a.js', tokens: ['alpha'], weight: 1 }],
  tokenIndex: {
    vocab: ['alpha'],
    vocabIndex: new Map([['alpha', 0]]),
    postings: [[[0, 1]]],
    docLengths: [1],
    totalDocs: 1,
    avgDocLen: 1
  },
  filterIndex: null,
  fileRelations: null,
  phraseNgrams: null,
  minhash: null,
  denseVec: null
};

const codeHit = (await pipeline(idx, 'code', null))[0];
const proseHit = (await pipeline(idx, 'prose', null))[0];

assert.ok(codeHit?.scoreBreakdown, 'expected code hit scoreBreakdown');
assert.ok(proseHit?.scoreBreakdown, 'expected prose hit scoreBreakdown');
assert.deepEqual(Object.keys(codeHit.scoreBreakdown), expectedKeys, 'expected code scoreBreakdown contract keys');
assert.deepEqual(Object.keys(proseHit.scoreBreakdown), expectedKeys, 'expected prose scoreBreakdown contract keys');
assert.equal(codeHit.scoreBreakdown.schemaVersion, 1, 'expected schema version in code hit');
assert.equal(proseHit.scoreBreakdown.schemaVersion, 1, 'expected schema version in prose hit');

console.log('score breakdown contract parity test passed');
