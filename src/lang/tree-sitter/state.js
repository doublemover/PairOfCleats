export const treeSitterState = {
  TreeSitter: null,
  TreeSitterLanguage: null,
  treeSitterInitError: null,
  treeSitterInitPromise: null,
  wasmRoot: null,
  wasmRuntimePath: null,
  // Parsers can hold non-trivial native/WASM memory. In polyglot repos, keeping
  // multiple Parser instances (one per language) can balloon memory and trigger
  // V8 "Zone" OOMs on Windows. Use a single shared Parser and switch languages.
  sharedParser: null,
  sharedParserLanguageId: null,

  // Legacy cache kept for compatibility with other callers. We keep it empty
  // when using sharedParser.
  parserCache: new Map(),

  languageCache: new Map(),
  // Cache of languages keyed by wasm file name. This deduplicates aliases that
  // share the same wasm (e.g. javascript/jsx).
  wasmLanguageCache: new Map(),
  languageLoadPromises: new Map(),
  queryCache: new Map(),
  loggedQueryFailures: new Set(),
  loggedMissing: new Set(),
  loggedMissingWasm: new Set(),
  loggedEvictionWarnings: new Set(),
  loggedInitFailure: new Set(),
  loggedWorkerFailures: new Set(),
  loggedTimeoutDisable: new Set(),
  timeoutCounts: new Map(),
  disabledLanguages: new Set(),
  metrics: {
    wasmLoads: 0,
    wasmLoadFailures: 0,
    wasmMissing: 0,
    wasmEvictions: 0,
    queryBuilds: 0,
    queryFailures: 0,
    queryHits: 0,
    queryMisses: 0,
    parserActivations: 0,
    parseFailures: 0,
    parseTimeouts: 0,
    workerFallbacks: 0,
    fallbacks: 0
  },
  treeSitterWorkerPool: null,
  treeSitterWorkerConfigSignature: null
};
