import { createRetrievalExecutionOutcome } from '../../../src/retrieval/pipeline/execution-outcome.js';

/** Explicit healthy authored payload metadata for storage-ownership fixtures.
 * These declarations are fixtures, not evidence that a runtime check was run.
 */
export const createCacheFixtureExecutions = () => Object.fromEntries(['code', 'prose', 'extracted-prose', 'records']
  .map(mode => [mode, createRetrievalExecutionOutcome({ mode, requestedSparse: 'js-bm25', effectiveSparse: 'bm25' })]));

export const createQueryCacheLookupInput = (queryCacheDir, overrides = {}) => ({
  queryCacheEnabled: true, queryCacheDir, metricsDir: queryCacheDir,
  indexSignaturePayload: { backend: 'memory', modes: { code: 'admitted-index' } },
  query: 'alpha', searchMode: 'code', backendLabel: 'memory', topN: 5,
  runCode: true, runProse: false, runExtractedProse: false, runRecords: false,
  vectorExtension: {}, embeddingOnnx: {}, contextExpansionOptions: {},
  queryCacheTtlMs: 60000, queryCacheMaxEntries: 32, cacheStrategy: 'memory-first',
  cachePrewarmEnabled: false, cacheMemoryFreshMs: 1000, ...overrides
});

export const createQueryCachePersistInput = (lookup, overrides = {}) => ({
  ...lookup, queryCacheEnabled: true, queryCacheTtlMs: 60000, queryCacheMaxEntries: 32,
  query: 'alpha', backendLabel: 'memory', codeHits: [{ id: 0, file: 'source.js' }],
  executionOutcomes: createCacheFixtureExecutions(),
  proseHits: [], extractedProseHits: [], recordHits: [], ...overrides
});
