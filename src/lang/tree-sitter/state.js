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
  loggedMissing: new Set(),
  loggedInitFailure: new Set(),
  loggedWorkerFailures: new Set(),
  treeSitterWorkerPool: null,
  treeSitterWorkerConfigSignature: null
};
