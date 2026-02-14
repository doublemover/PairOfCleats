#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSearchPipeline } from '../../../src/retrieval/pipeline.js';
import { resolveSqliteFtsRoutingByMode } from '../../../src/retrieval/routing-policy.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const expectedPath = path.join(__dirname, 'golden', 'score-breakdown-snapshots.json');
const expected = JSON.parse(fs.readFileSync(expectedPath, 'utf8'));

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

const snapshot = {
  code: codeHit?.scoreBreakdown || null,
  prose: proseHit?.scoreBreakdown || null
};

assert.deepEqual(snapshot, expected, 'score breakdown snapshot drift detected');

console.log('score breakdown snapshots test passed');
