export const treeSitterState = {
  TreeSitter: null,
  TreeSitterLanguage: null,
  treeSitterInitError: null,
  treeSitterInitPromise: null,
  wasmRoot: null,
  wasmRuntimePath: null,
  parserCache: new Map(),
  languageCache: new Map(),
  languageLoadPromises: new Map(),
  loggedMissing: new Set(),
  loggedInitFailure: new Set(),
  loggedWorkerFailures: new Set(),
  treeSitterWorkerPool: null,
  treeSitterWorkerConfigSignature: null
};
