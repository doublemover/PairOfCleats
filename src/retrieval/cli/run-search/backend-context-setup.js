import { runWithOperationalFailurePolicy } from '../../../shared/ops-failure-injection.js';
import { createBackendContextInputFactory } from './execution.js';
import { createBackendContextWithTracking } from './backend-context.js';

/**
 * Build backend context input factory and initialize retrieval backend context.
 *
 * @param {{
 *   needsCode:boolean,
 *   needsProse:boolean,
 *   loadExtractedProseSqlite:boolean,
 *   sqliteCodePath:string,
 *   sqliteProsePath:string,
 *   sqliteExtractedProsePath:string,
 *   backendForcedSqlite:boolean,
 *   backendForcedLmdb:boolean,
 *   backendForcedTantivy:boolean,
 *   vectorExtension:object,
 *   sqliteCache:object|null,
 *   sqliteStates:object,
 *   lmdbCodePath:string,
 *   lmdbProsePath:string,
 *   lmdbStates:object,
 *   postingsConfig:object,
 *   sqliteFtsWeights:object|null,
 *   maxCandidates:number,
 *   queryVectorAnn:any,
 *   modelIdDefault:string,
 *   fileChargramN:number,
 *   hnswConfig:object,
 *   denseVectorMode:string|null,
 *   storageTier:string|null,
 *   sqliteReadPragmas:object|null,
 *   rootDir:string,
 *   userConfig:object,
 *   stageTracker:object,
 *   backendPolicy:any,
 *   useSqliteSelection:boolean,
 *   useLmdbSelection:boolean,
 *   sqliteFtsEnabled:boolean,
 *   vectorAnnEnabled:boolean,
 *   emitOutput:boolean
 * }} input
 * @returns {Promise<{buildBackendContextInput:(input:object)=>object,backendContext:object}>}
 */
export const initializeBackendContext = async ({
  needsCode,
  needsProse,
  loadExtractedProseSqlite,
  sqliteCodePath,
  sqliteProsePath,
  sqliteExtractedProsePath,
  backendForcedSqlite,
  backendForcedLmdb,
  backendForcedTantivy,
  vectorExtension,
  sqliteCache,
  sqliteStates,
  lmdbCodePath,
  lmdbProsePath,
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
  backendPolicy,
  useSqliteSelection,
  useLmdbSelection,
  sqliteFtsEnabled,
  vectorAnnEnabled,
  emitOutput
}) => {
  const buildBackendContextInput = createBackendContextInputFactory({
    needsCode,
    needsProse,
    needsExtractedProse: loadExtractedProseSqlite,
    sqliteCodePath,
    sqliteProsePath,
    sqliteExtractedProsePath,
    backendForcedSqlite,
    backendForcedLmdb,
    backendForcedTantivy,
    vectorExtension,
    dbCache: sqliteCache,
    sqliteStates,
    lmdbCodePath,
    lmdbProsePath,
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
    root: rootDir,
    userConfig
  });
  const backendInitResult = await runWithOperationalFailurePolicy({
    target: 'retrieval.hotpath',
    operation: 'backend-context',
    execute: async () => createBackendContextWithTracking({
      stageTracker,
      contextInput: buildBackendContextInput({
        backendPolicy,
        useSqlite: useSqliteSelection,
        useLmdb: useLmdbSelection,
        sqliteFtsRequested: sqliteFtsEnabled,
        vectorAnnEnabled
      }),
      stageName: 'startup.backend'
    }),
    log: (message) => {
      if (emitOutput) console.warn(message);
    }
  });
  return {
    buildBackendContextInput,
    backendContext: backendInitResult.value
  };
};
