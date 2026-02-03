#!/usr/bin/env node
import { createSearchPipeline } from '../../../src/retrieval/pipeline.js';

let initCount = 0;
const createAnnProviders = () => {
  initCount += 1;
  return new Map([
    ['js', {
      id: 'dense',
      isAvailable: () => true,
      query: async () => []
    }]
  ]);
};

const searchPipeline = createSearchPipeline({
  useSqlite: false,
  sqliteFtsRequested: false,
  sqliteFtsNormalize: false,
  sqliteFtsProfile: null,
  sqliteFtsWeights: null,
  bm25K1: 1.2,
  bm25B: 0.75,
  fieldWeights: null,
  postingsConfig: { enablePhraseNgrams: false, enableChargrams: false },
  queryTokens: ['alpha'],
  queryAst: null,
  phraseNgramSet: null,
  phraseRange: null,
  explain: false,
  symbolBoost: { enabled: false },
  filters: {},
  filtersActive: false,
  topN: 2,
  maxCandidates: 50,
  annEnabled: true,
  annBackend: 'dense',
  scoreBlend: { enabled: false },
  minhashMaxDocs: null,
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
  createAnnProviders
});

const idx = {
  chunkMeta: [
    { id: 0, tokens: ['alpha'], weight: 1, file: 'a.js', kind: 'Definition' },
    { id: 1, tokens: ['alpha'], weight: 1, file: 'b.js', kind: 'Definition' }
  ],
  minhash: { signatures: [] }
};

const warnings = [];
const originalWarn = console.warn;
console.warn = (msg) => warnings.push(String(msg));

const results = await searchPipeline(idx, 'code', null);

console.warn = originalWarn;

if (initCount !== 0) {
  console.error(`ann nonvector fallback failed: expected no provider init, got ${initCount}`);
  process.exit(1);
}
if (warnings.length !== 0) {
  console.error(`ann nonvector fallback failed: expected no warnings, got ${warnings.length}`);
  process.exit(1);
}
if (!Array.isArray(results) || results.length === 0) {
  console.error('ann nonvector fallback failed: expected sparse results.');
  process.exit(1);
}

console.log('ann nonvector fallback test passed');
