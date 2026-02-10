export const treeSitterState = {
  TreeSitter: null,
  TreeSitterLanguage: null,
  treeSitterInitError: null,
  treeSitterInitPromise: null,
  grammarRoot: null,
  runtimePath: null,
  // Parsers can hold non-trivial memory. In polyglot repos, keeping
  // multiple Parser instances (one per language) can balloon memory and trigger
  // V8 "Zone" OOMs on Windows. Use a single shared Parser and switch languages.
  sharedParser: null,
  sharedParserLanguageId: null,

  // Legacy cache kept for compatibility with other callers. We keep it empty
  // when using sharedParser.
  parserCache: new Map(),

  languageCache: new Map(),
  // Cache of loaded grammars keyed by runtime grammar key.
  grammarCache: new Map(),
  languageLoadPromises: new Map(),
  queryCache: new Map(),
  loggedQueryFailures: new Set(),
  chunkCache: new Map(),
  chunkCacheMaxEntries: null,
  nodeDensity: new Map(),
  loggedAdaptiveBudgets: new Set(),
  loggedMissing: new Set(),
  loggedMissingGrammar: new Set(),
  loggedEvictionWarnings: new Set(),
  loggedInitFailure: new Set(),
  loggedWorkerFailures: new Set(),
  loggedTimeoutDisable: new Set(),
  timeoutCounts: new Map(),
  disabledLanguages: new Set(),
  metrics: {
    grammarLoads: 0,
    grammarLoadFailures: 0,
    grammarMissing: 0,
    grammarEvictions: 0,
    queryBuilds: 0,
    queryFailures: 0,
    queryHits: 0,
    queryMisses: 0,
    chunkCacheHits: 0,
    chunkCacheMisses: 0,
    chunkCacheSets: 0,
    chunkCacheEvictions: 0,
    adaptiveBudgetCuts: 0,
    batchCount: 0,
    batchFiles: 0,
    batchMaxFiles: 0,
    batchDeferrals: 0,
    parserActivations: 0,
    parseFailures: 0,
    parseTimeouts: 0,
    workerFallbacks: 0,
    fallbacks: 0
  },
  treeSitterWorkerPool: null,
  treeSitterWorkerConfigSignature: null
};
