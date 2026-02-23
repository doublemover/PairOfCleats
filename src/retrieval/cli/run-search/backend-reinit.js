import { ERROR_CODES } from '../../../shared/error-codes.js';
import { createBackendContextWithTracking } from './backend-context.js';

/**
 * Reinitialize backend context after sparse-preflight forced ANN fallback.
 *
 * @param {{
 *   stageTracker:object,
 *   buildBackendContextInput:(input:object)=>object,
 *   backendPolicy:any,
 *   useSqliteSelection:boolean,
 *   useLmdbSelection:boolean,
 *   sqliteFtsEnabled:boolean,
 *   vectorAnnEnabled:boolean,
 *   backendForcedLmdb:boolean
 * }} input
 * @returns {Promise<{
 *   useSqlite:boolean,
 *   useLmdb:boolean,
 *   backendLabel:string,
 *   backendPolicyInfo:any,
 *   vectorAnnState:any,
 *   vectorAnnUsed:any,
 *   sqliteHelpers:any,
 *   lmdbHelpers:any,
 *   error:{message:string,code:string}|null
 * }>}
 */
export const reinitializeBackendAfterSparseFallback = async ({
  stageTracker,
  buildBackendContextInput,
  backendPolicy,
  useSqliteSelection,
  useLmdbSelection,
  sqliteFtsEnabled,
  vectorAnnEnabled,
  backendForcedLmdb
}) => {
  const backendContext = await createBackendContextWithTracking({
    stageTracker,
    contextInput: buildBackendContextInput({
      backendPolicy,
      useSqlite: useSqliteSelection,
      useLmdb: useLmdbSelection,
      sqliteFtsRequested: sqliteFtsEnabled,
      vectorAnnEnabled
    }),
    stageName: 'startup.backend.reinit'
  });
  const {
    useSqlite,
    useLmdb,
    backendLabel,
    backendPolicyInfo,
    vectorAnnState,
    vectorAnnUsed,
    sqliteHelpers,
    lmdbHelpers
  } = backendContext;
  if (backendForcedLmdb && !useLmdb) {
    return {
      useSqlite,
      useLmdb,
      backendLabel,
      backendPolicyInfo,
      vectorAnnState,
      vectorAnnUsed,
      sqliteHelpers,
      lmdbHelpers,
      error: {
        message: 'LMDB backend requested but unavailable.',
        code: ERROR_CODES.INVALID_REQUEST
      }
    };
  }
  return {
    useSqlite,
    useLmdb,
    backendLabel,
    backendPolicyInfo,
    vectorAnnState,
    vectorAnnUsed,
    sqliteHelpers,
    lmdbHelpers,
    error: null
  };
};
