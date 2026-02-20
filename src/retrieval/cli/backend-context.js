import { createLmdbBackend } from '../cli-lmdb.js';
import { createSqliteBackend } from '../cli-sqlite.js';
import { resolveIndexDir } from '../cli-index.js';
import { createLmdbHelpers } from '../lmdb-helpers.js';
import { createSqliteHelpers } from '../sqlite-helpers.js';

export const createBackendContext = async ({
  backendPolicy,
  useSqlite: useSqliteInput,
  useLmdb: useLmdbInput,
  needsCode,
  needsProse,
  needsExtractedProse,
  sqliteCodePath,
  sqliteProsePath,
  sqliteExtractedProsePath,
  sqliteFtsRequested,
  backendForcedSqlite,
  backendForcedLmdb,
  backendForcedTantivy,
  vectorExtension,
  vectorAnnEnabled,
  dbCache,
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
  root,
  userConfig
}) => {
  const lmdbBackend = await createLmdbBackend({
    useLmdb: useLmdbInput,
    needsCode,
    needsProse,
    lmdbCodePath,
    lmdbProsePath,
    backendForcedLmdb,
    lmdbStates
  });
  let useLmdb = lmdbBackend.useLmdb;

  const sqliteBackend = await createSqliteBackend({
    useSqlite: useSqliteInput,
    needsCode,
    needsProse,
    needsExtractedProse,
    sqliteCodePath,
    sqliteProsePath,
    sqliteExtractedProsePath,
    sqliteFtsRequested,
    backendForcedSqlite,
    vectorExtension,
    vectorAnnEnabled,
    storageTier,
    sqliteReadPragmas,
    dbCache,
    sqliteStates
  });
  let useSqlite = sqliteBackend.useSqlite;
  let dbCode = sqliteBackend.dbCode;
  let dbProse = sqliteBackend.dbProse;
  let dbExtractedProse = sqliteBackend.dbExtractedProse;
  let lmdbCode = lmdbBackend.dbCode;
  let lmdbProse = lmdbBackend.dbProse;

  if (useSqlite) {
    useLmdb = false;
    lmdbCode = null;
    lmdbProse = null;
  }

  const vectorAnnState = sqliteBackend.vectorAnnState;
  const vectorAnnUsed = sqliteBackend.vectorAnnUsed;
  const vectorAnnConfigByMode = sqliteBackend.vectorAnnConfigByMode;
  const backendLabel = backendForcedTantivy
    ? 'tantivy'
    : (useSqlite
      ? (sqliteFtsRequested ? 'sqlite-fts' : 'sqlite')
      : (useLmdb ? 'lmdb' : 'memory'));
  const backendPolicyInfo = backendPolicy ? { ...backendPolicy, backendLabel } : { backendLabel };

  const getSqliteDb = (mode) => {
    if (!useSqlite) return null;
    if (mode === 'code') return dbCode;
    if (mode === 'prose') return dbProse;
    if (mode === 'extracted-prose') return dbExtractedProse;
    return null;
  };

  const getLmdbDb = (mode) => {
    if (!useLmdb) return null;
    if (mode === 'code') return lmdbCode;
    if (mode === 'prose') return lmdbProse;
    return null;
  };

  const sqliteHelpers = createSqliteHelpers({
    getDb: getSqliteDb,
    postingsConfig,
    sqliteFtsWeights,
    maxCandidates,
    vectorExtension,
    vectorAnnConfigByMode,
    vectorAnnState,
    queryVectorAnn,
    modelIdDefault,
    fileChargramN
  });

  const lmdbIndexDirs = {
    code: resolveIndexDir(root, 'code', userConfig),
    prose: resolveIndexDir(root, 'prose', userConfig)
  };
  const lmdbHelpers = createLmdbHelpers({
    getDb: getLmdbDb,
    hnswConfig,
    denseVectorMode,
    modelIdDefault,
    fileChargramN,
    indexDirs: lmdbIndexDirs
  });

  return {
    useSqlite,
    useLmdb,
    dbCode,
    dbProse,
    dbExtractedProse,
    lmdbCode,
    lmdbProse,
    backendLabel,
    backendPolicyInfo,
    vectorAnnState,
    vectorAnnUsed,
    sqliteHelpers,
    lmdbHelpers
  };
};
