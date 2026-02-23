import { ERROR_CODES } from '../../../shared/error-codes.js';
import { resolveBackendSelection } from '../policy.js';

/**
 * Resolve retrieval backend selection and apply mixed-root / auto-threshold
 * policy overrides used by run-search startup.
 *
 * @param {{
 *   backendArg:string|null|undefined,
 *   sqliteAvailable:boolean,
 *   sqliteCodeAvailable:boolean,
 *   sqliteProseAvailable:boolean,
 *   sqliteExtractedProseAvailable:boolean,
 *   sqliteCodePath:string,
 *   sqliteProsePath:string,
 *   sqliteExtractedProsePath:string,
 *   lmdbAvailable:boolean,
 *   lmdbCodeAvailable:boolean,
 *   lmdbProseAvailable:boolean,
 *   lmdbCodePath:string,
 *   lmdbProsePath:string,
 *   needsSqlite:boolean,
 *   needsCode:boolean,
 *   needsProse:boolean,
 *   requiresExtractedProse:boolean,
 *   defaultBackend:string,
 *   sqliteRootsMixed:boolean,
 *   lmdbRootsMixed:boolean,
 *   autoBackendRequested:boolean,
 *   autoSqliteAllowed:boolean,
 *   autoSqliteReason:string|null,
 *   asOfRef:string|null,
 *   emitOutput:boolean
 * }} input
 * @returns {Promise<{
 *   backendPolicy:any,
 *   useSqliteSelection:boolean,
 *   useLmdbSelection:boolean,
 *   sqliteFtsEnabled:boolean,
 *   backendForcedSqlite:boolean,
 *   backendForcedLmdb:boolean,
 *   backendForcedTantivy:boolean,
 *   error:{message:string,code:string}|null
 * }>}
 */
export const resolveRunSearchBackendSelection = async ({
  backendArg,
  sqliteAvailable,
  sqliteCodeAvailable,
  sqliteProseAvailable,
  sqliteExtractedProseAvailable,
  sqliteCodePath,
  sqliteProsePath,
  sqliteExtractedProsePath,
  lmdbAvailable,
  lmdbCodeAvailable,
  lmdbProseAvailable,
  lmdbCodePath,
  lmdbProsePath,
  needsSqlite,
  needsCode,
  needsProse,
  requiresExtractedProse,
  defaultBackend,
  sqliteRootsMixed,
  lmdbRootsMixed,
  autoBackendRequested,
  autoSqliteAllowed,
  autoSqliteReason,
  asOfRef,
  emitOutput
}) => {
  const backendSelection = await resolveBackendSelection({
    backendArg,
    sqliteAvailable,
    sqliteCodeAvailable,
    sqliteProseAvailable,
    sqliteExtractedProseAvailable,
    sqliteCodePath,
    sqliteProsePath,
    sqliteExtractedProsePath,
    lmdbAvailable,
    lmdbCodeAvailable,
    lmdbProseAvailable,
    lmdbCodePath,
    lmdbProsePath,
    needsSqlite,
    needsCode,
    needsProse,
    needsExtractedProse: requiresExtractedProse,
    defaultBackend,
    onWarn: console.warn
  });
  if (backendSelection.error) {
    return {
      backendPolicy: null,
      useSqliteSelection: false,
      useLmdbSelection: false,
      sqliteFtsEnabled: false,
      backendForcedSqlite: false,
      backendForcedLmdb: false,
      backendForcedTantivy: false,
      error: {
        message: backendSelection.error.message,
        code: ERROR_CODES.INVALID_REQUEST
      }
    };
  }
  let {
    backendPolicy,
    useSqlite: useSqliteSelection,
    useLmdb: useLmdbSelection,
    sqliteFtsRequested,
    backendForcedSqlite,
    backendForcedLmdb,
    backendForcedTantivy
  } = backendSelection;
  if (sqliteRootsMixed) {
    if (backendForcedSqlite) {
      return {
        backendPolicy,
        useSqliteSelection: false,
        useLmdbSelection,
        sqliteFtsEnabled: false,
        backendForcedSqlite,
        backendForcedLmdb,
        backendForcedTantivy,
        error: {
          message: `[search] --backend sqlite cannot be used with --as-of ${asOfRef}: code/prose resolve to different index roots.`,
          code: ERROR_CODES.INVALID_REQUEST
        }
      };
    }
    if (emitOutput && autoBackendRequested) {
      console.warn('[search] sqlite backend disabled: explicit as-of target resolves code/prose to different roots.');
    }
    useSqliteSelection = false;
  }
  if (lmdbRootsMixed) {
    if (backendForcedLmdb) {
      return {
        backendPolicy,
        useSqliteSelection,
        useLmdbSelection: false,
        sqliteFtsEnabled: false,
        backendForcedSqlite,
        backendForcedLmdb,
        backendForcedTantivy,
        error: {
          message: `[search] --backend lmdb cannot be used with --as-of ${asOfRef}: code/prose resolve to different index roots.`,
          code: ERROR_CODES.INVALID_REQUEST
        }
      };
    }
    if (emitOutput && autoBackendRequested) {
      console.warn('[search] lmdb backend disabled: explicit as-of target resolves code/prose to different roots.');
    }
    useLmdbSelection = false;
  }
  if (!autoSqliteAllowed && autoBackendRequested && useSqliteSelection && !backendForcedSqlite) {
    useSqliteSelection = false;
    useLmdbSelection = false;
    if (autoSqliteReason) {
      backendPolicy = backendPolicy ? { ...backendPolicy, reason: autoSqliteReason } : backendPolicy;
      if (emitOutput) {
        console.warn(`[search] ${autoSqliteReason}. Falling back to file-backed indexes.`);
      }
    }
  }
  const sqliteFtsEnabled = sqliteFtsRequested || (autoBackendRequested && useSqliteSelection);
  return {
    backendPolicy,
    useSqliteSelection,
    useLmdbSelection,
    sqliteFtsEnabled,
    backendForcedSqlite,
    backendForcedLmdb,
    backendForcedTantivy,
    error: null
  };
};
