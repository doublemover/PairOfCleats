/**
 * Resolve mode requirements shared across backend selection and backend context setup.
 *
 * The extracted-prose flags have different meanings and must not be conflated:
 * - `needsExtractedProse` means extracted-prose data may be loaded when available.
 * - `requiresExtractedProse` means the selected search mode cannot run without it.
 *
 * @param {{
 *   runCode?:boolean,
 *   runProse?:boolean,
 *   runExtractedProse?:boolean,
 *   searchMode?:string,
 *   commentsEnabled?:boolean
 * }} [input]
 * @returns {{
 *   needsCode:boolean,
 *   needsProse:boolean,
 *   needsExtractedProse:boolean,
 *   requiresExtractedProse:boolean,
 *   joinComments:boolean,
 *   needsSqlite:boolean
 * }}
 */
export const resolveRunSearchModeNeeds = ({
  runCode = false,
  runProse = false,
  runExtractedProse = false,
  searchMode = 'mixed',
  commentsEnabled = false
} = {}) => {
  const needsCode = runCode === true;
  const needsProse = runProse === true;
  const needsExtractedProse = runExtractedProse === true;
  const requiresExtractedProse = searchMode === 'extracted-prose';
  return {
    needsCode,
    needsProse,
    needsExtractedProse,
    requiresExtractedProse,
    joinComments: commentsEnabled === true && needsCode,
    needsSqlite: needsCode || needsProse || needsExtractedProse
  };
};

/**
 * Build backend bootstrap payload consumed by `resolveRunSearchBackendContext`.
 *
 * Throughput note: this helper forwards already-resolved availability/path/state
 * objects by reference so `plan-runner` avoids rebuilding large nested literals.
 *
 * Orchestration note: `contextInput.needsExtractedProse` intentionally tracks
 * `loadExtractedProseSqlite` (actual sqlite availability), while selection uses
 * `requiresExtractedProse` to enforce hard mode requirements.
 *
 * @param {object} input
 * @param {ReturnType<typeof resolveRunSearchModeNeeds>} input.modeNeeds
 * @param {string|null|undefined} input.backendArg
 * @param {string} input.defaultBackend
 * @param {object|null} input.asOfContext
 * @param {boolean} input.emitOutput
 * @param {number|null|undefined} input.sqliteAutoChunkThreshold
 * @param {number|null|undefined} input.sqliteAutoArtifactBytes
 * @param {boolean} input.runCode
 * @param {boolean} input.runProse
 * @param {boolean} input.runExtractedProse
 * @param {(input:object)=>string|null} input.resolveSearchIndexDir
 * @param {boolean} input.sqliteRootsMixed
 * @param {boolean} input.lmdbRootsMixed
 * @param {{codePath:string,prosePath:string,extractedProsePath:string}} input.sqlitePaths
 * @param {{codePath:string,prosePath:string}} input.lmdbPaths
 * @param {{all:boolean,code:boolean,prose:boolean,extractedProse:boolean}} input.sqliteAvailability
 * @param {{all:boolean,code:boolean,prose:boolean}} input.lmdbAvailability
 * @param {boolean} input.loadExtractedProseSqlite
 * @param {object} input.vectorExtension
 * @param {object|null} input.sqliteCache
 * @param {object} input.sqliteStates
 * @param {object} input.lmdbStates
 * @param {object} input.postingsConfig
 * @param {object|null} input.sqliteFtsWeights
 * @param {number} input.maxCandidates
 * @param {any} input.queryVectorAnn
 * @param {string} input.modelIdDefault
 * @param {number} input.fileChargramN
 * @param {object} input.hnswConfig
 * @param {string|null} input.denseVectorMode
 * @param {string|null} input.storageTier
 * @param {object|null} input.sqliteReadPragmas
 * @param {string} input.rootDir
 * @param {object} input.userConfig
 * @param {object} input.stageTracker
 * @param {boolean} input.vectorAnnEnabled
 * @returns {{selectionInput:object,contextInput:object}}
 */
export const buildRunSearchBackendBootstrapInput = ({
  modeNeeds,
  backendArg,
  defaultBackend,
  asOfContext,
  emitOutput,
  sqliteAutoChunkThreshold,
  sqliteAutoArtifactBytes,
  runCode,
  runProse,
  runExtractedProse,
  resolveSearchIndexDir,
  sqliteRootsMixed,
  lmdbRootsMixed,
  sqlitePaths,
  lmdbPaths,
  sqliteAvailability,
  lmdbAvailability,
  loadExtractedProseSqlite,
  vectorExtension,
  sqliteCache,
  sqliteStates,
  lmdbStates,
  postingsConfig,
  sqliteFtsWeights,
  maxCandidates,
  queryVectorAnn,
  modelIdDefault,
  fileChargramN,
  hnswConfig,
  denseVectorMode,
  storageTier,
  sqliteReadPragmas,
  rootDir,
  userConfig,
  stageTracker,
  vectorAnnEnabled
}) => ({
  selectionInput: {
    backendArg,
    sqliteAvailable: sqliteAvailability.all,
    sqliteCodeAvailable: sqliteAvailability.code,
    sqliteProseAvailable: sqliteAvailability.prose,
    sqliteExtractedProseAvailable: sqliteAvailability.extractedProse,
    sqliteCodePath: sqlitePaths.codePath,
    sqliteProsePath: sqlitePaths.prosePath,
    sqliteExtractedProsePath: sqlitePaths.extractedProsePath,
    lmdbAvailable: lmdbAvailability.all,
    lmdbCodeAvailable: lmdbAvailability.code,
    lmdbProseAvailable: lmdbAvailability.prose,
    lmdbCodePath: lmdbPaths.codePath,
    lmdbProsePath: lmdbPaths.prosePath,
    needsSqlite: modeNeeds.needsSqlite,
    needsCode: modeNeeds.needsCode,
    needsProse: modeNeeds.needsProse,
    requiresExtractedProse: modeNeeds.requiresExtractedProse,
    defaultBackend,
    sqliteRootsMixed,
    lmdbRootsMixed,
    asOfRef: asOfContext?.ref || 'latest',
    emitOutput,
    sqliteAutoChunkThreshold,
    sqliteAutoArtifactBytes,
    runCode,
    runProse,
    runExtractedProse,
    resolveSearchIndexDir
  },
  contextInput: {
    needsCode: modeNeeds.needsCode,
    needsProse: modeNeeds.needsProse,
    loadExtractedProseSqlite,
    sqliteCodePath: sqlitePaths.codePath,
    sqliteProsePath: sqlitePaths.prosePath,
    sqliteExtractedProsePath: sqlitePaths.extractedProsePath,
    vectorExtension,
    dbCache: sqliteCache,
    sqliteStates,
    lmdbCodePath: lmdbPaths.codePath,
    lmdbProsePath: lmdbPaths.prosePath,
    lmdbStates,
    postingsConfig,
    sqliteFtsWeights,
    maxCandidates,
    queryVectorAnn,
    modelIdDefault,
    fileChargramN,
    hnswConfig,
    denseVectorMode,
    storageTier,
    sqliteReadPragmas,
    rootDir,
    userConfig,
    stageTracker,
    vectorAnnEnabled,
    emitOutput
  }
});
