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
  proseHits: [], extractedProseHits: [], recordHits: [], ...overrides
});
