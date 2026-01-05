import assert from 'node:assert/strict';
import { createSearchPipeline } from '../src/retrieval/pipeline.js';

const idx = {
  chunkMeta: [
    {
      id: 0,
      file: 'a.js',
      start: 0,
      end: 10,
      kind: 'FunctionDeclaration',
      name: 'foo',
      tokens: ['alpha']
    },
    {
      id: 1,
      file: 'b.js',
      start: 0,
      end: 10,
      kind: 'FunctionDeclaration',
      name: 'bar',
      tokens: ['alpha']
    }
  ],
  fileRelations: new Map([
    ['a.js', { exports: ['foo'] }],
    ['b.js', { exports: [] }]
  ])
};

const searchPipeline = createSearchPipeline({
  useSqlite: false,
  sqliteFtsRequested: false,
  sqliteFtsNormalize: false,
  sqliteFtsProfile: 'balanced',
  sqliteFtsWeights: null,
  bm25K1: 1.2,
  bm25B: 0.75,
  postingsConfig: {
    enablePhraseNgrams: false,
    enableChargrams: false,
    phraseMinN: 2,
    phraseMaxN: 3,
    chargramMinN: 3,
    chargramMaxN: 3
  },
  queryTokens: ['alpha'],
  phraseNgramSet: null,
  phraseRange: null,
  symbolBoost: {
    enabled: true,
    definitionWeight: 1.4,
    exportWeight: 1.2
  },
  filters: {},
  filtersActive: false,
  topN: 2,
  annEnabled: false,
  scoreBlend: { enabled: false },
  minhashMaxDocs: 0,
  vectorAnnState: null,
  vectorAnnUsed: {},
  buildCandidateSetSqlite: () => null,
  getTokenIndexForQuery: () => null,
  rankSqliteFts: () => [],
  rankVectorAnnSqlite: () => []
});

const results = searchPipeline(idx, 'code', null);
assert.equal(results.length, 2, 'expected two results');
assert.equal(results[0].name, 'foo', 'expected exported definition to rank first');
assert.ok(results[0].score > results[1].score, 'expected boosted score to win');
assert.ok(results[0].scoreBreakdown?.symbol?.definition, 'expected definition flag');
assert.ok(results[0].scoreBreakdown?.symbol?.export, 'expected export flag');
assert.ok(results[0].scoreBreakdown?.symbol?.factor > 1, 'expected symbol boost factor');

console.log('symbol boost test passed');
