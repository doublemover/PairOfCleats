/** Exact saved format dispatch. These adapters do not collect, attach, or parse arbitrary native logs. */
export const OFFLINE_RUNTIME_ADAPTERS = Object.freeze([
  Object.freeze({ format: 'inspector-cpu-profile', formatVersion: '1', adapter: 'cpu-profile',
    origin: 'inspector-format', evidenceKinds: ['cpuProfile'], execution: false }),
  Object.freeze({ format: 'pairofcleats-code-log', formatVersion: '1', adapter: 'code-log',
    origin: 'saved-interchange', evidenceKinds: ['scriptMetadata', 'sourceMapping', 'codeVersion', 'codeLifecycle',
      'nativeDisassembly', 'optimization', 'deoptimization', 'typeObservation', 'icEvent', 'mapEvent', 'compilerFeedback'], execution: false })
]);
export const selectOfflineRuntimeAdapter = artifact => OFFLINE_RUNTIME_ADAPTERS.find(row =>
  row.format === artifact.format && row.formatVersion === artifact.formatVersion) || null;
