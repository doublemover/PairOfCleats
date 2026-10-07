import { createLmdbBackend } from '../cli-lmdb.js';
import { createSqliteBackend } from '../cli-sqlite.js';
import { resolveIndexDir } from '../cli-index.js';
import { createLmdbHelpers } from '../lmdb-helpers.js';
import { createSqliteHelpers } from '../sqlite-helpers.js';
import { createBackendDisposer } from './backend-disposal.js';

/**
 * Build backend context for retrieval by wiring SQLite/LMDB handles, helper
 * factories, and backend-policy metadata for the current run.
 *
 * @param {object} input
 * @returns {Promise<object>}
 */
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
  generationContext = null,
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
  userConfig,
  indexResolveOptions = {}
}) => {
  const disposers = new Set();
  const dispose = createBackendDisposer(disposers);
  try {
    const lmdbBackend = await createLmdbBackend({
      useLmdb: useLmdbInput,
      needsCode,
      needsProse,
      lmdbCodePath,
      lmdbProsePath,
      backendForcedLmdb,
      lmdbStates
    });
    disposers.add(() => lmdbBackend.dispose());
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
      sqliteStates,
      generationContext
    });
    disposers.add(() => sqliteBackend.dispose());
    let useSqlite = sqliteBackend.useSqlite;
    let dbCode = sqliteBackend.dbCode;
    let dbProse = sqliteBackend.dbProse;
    let dbExtractedProse = sqliteBackend.dbExtractedProse;
    let lmdbCode = lmdbBackend.dbCode;
    let lmdbProse = lmdbBackend.dbProse;

    if (useSqlite) {
      await lmdbBackend.dispose();
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
      // External ANN files must use the same historical target as the store.
      // Do not resolve absent, unrequested modes of a partial snapshot.
      code: useLmdb && needsCode ? resolveIndexDir(root, 'code', userConfig, indexResolveOptions) : null,
      prose: useLmdb && needsProse ? resolveIndexDir(root, 'prose', userConfig, indexResolveOptions) : null
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
      lmdbHelpers,
      dispose
    };
  } catch (error) {
    try { await dispose(); } catch {}
    throw error;
  }
};
