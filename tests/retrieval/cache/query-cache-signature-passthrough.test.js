#!/usr/bin/env node
import assert from 'node:assert/strict';
import { applyTestEnv } from '../../helpers/test-env.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';
import { stableStringifyForSignature } from '../../../src/shared/stable-json.js';
import { resolveQueryCacheLookup } from '../../../src/retrieval/cli/run-search-session/cache-policy.js';

applyTestEnv();

const cacheRoot = resolveTestCachePath('query-cache-signature-passthrough');
const indexSignaturePayload = {
  backend: 'sqlite',
  asOf: { ref: 'test-ref', identityHash: 'abc123', type: 'commit' },
  sqlite: { code: 'forced-code-signature' },
  modes: { code: 'forced-mode-signature' }
};

const lookup = await resolveQueryCacheLookup({
  queryCacheEnabled: true,
  queryCacheDir: cacheRoot,
  metricsDir: cacheRoot,
  useSqlite: true,
  backendLabel: 'sqlite',
  sqliteCodePath: 'C:/definitely/missing/code.db',
  sqliteProsePath: null,
  sqliteExtractedProsePath: null,
  runCode: true,
  runProse: false,
  runRecords: false,
  runExtractedProse: false,
  extractedProseLoaded: false,
  commentsEnabled: false,
  rootDir: null,
  userConfig: {},
  indexDirByMode: null,
  indexBaseRootByMode: null,
  explicitRef: false,
  indexSignaturePayload,
  asOfContext: null,
  query: 'alpha',
  searchMode: 'code',
  topN: 10,
  sqliteFtsRequested: false,
  annActive: false,
  annBackend: null,
  vectorExtension: { annMode: null, provider: null },
  vectorAnnEnabled: false,
  annAdaptiveProviders: null,
  relationBoost: false,
  annCandidateCap: null,
  annCandidateMinDocCount: null,
  annCandidateMaxDocCount: null,
  bm25K1: 1.2,
  bm25B: 0.75,
  scoreBlend: 0.5,
  rrf: null,
  fieldWeights: null,
  symbolBoost: null,
  resolvedDenseVectorMode: 'merged',
  intentInfo: null,
  minhashMaxDocs: null,
  maxCandidates: 100,
  sparseBackend: 'sqlite',
  explain: false,
  sqliteFtsNormalize: false,
  sqliteFtsProfile: false,
  sqliteFtsWeights: null,
  sqliteFtsTrigram: false,
  sqliteFtsStemming: false,
  sqliteTailLatencyTuning: false,
  sqliteFtsOverfetchCacheKey: null,
  modelIds: { code: 'stub' },
  embeddingProvider: 'stub',
  embeddingOnnx: { modelPath: null, tokenizerId: null },
  embeddingInputFormattingByMode: {
    code: null,
    prose: null,
    'extracted-prose': null,
    records: null
  },
  contextExpansionEnabled: false,
  contextExpansionOptions: {},
  contextExpansionRespectFilters: true,
  cacheFilters: null,
  graphRankingConfig: null,
  queryCacheTtlMs: 0,
  queryCacheMaxEntries: 128,
  cacheStrategy: 'disk-first',
  cachePrewarmEnabled: false,
  cachePrewarmLimit: 0,
  cacheMemoryFreshMs: 0
});

assert.equal(lookup.cacheHit, false);
assert.equal(lookup.cacheSignature, stableStringifyForSignature(indexSignaturePayload));
assert.equal(typeof lookup.cacheKey, 'string');
assert.ok(lookup.queryCachePath.endsWith('queryCache.json'));

console.log('query cache signature passthrough test passed');
