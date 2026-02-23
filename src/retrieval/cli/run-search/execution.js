import { ERROR_CODES } from '../../../shared/error-codes.js';
import { RETRIEVAL_SPARSE_UNAVAILABLE_CODE } from '../../sparse/requirements.js';
import { resolveSqliteFtsRoutingByMode } from '../../routing-policy.js';
import {
  resolveSparsePreflightMissingTables,
  resolveSparsePreflightModes
} from '../preflight.js';
import {
  formatSparseMissingDetails,
  hasSparseMissingEntries
} from './shared.js';

/**
 * Create a reusable backend-context input builder.
 * Reusing this mutable object avoids reallocating large nested literals
 * across startup initialization and fallback re-initialization.
 *
 * @param {object} staticInput
 * @returns {(dynamicInput:{
 *   backendPolicy:object|null,
 *   useSqlite:boolean,
 *   useLmdb:boolean,
 *   sqliteFtsRequested:boolean,
 *   vectorAnnEnabled:boolean
 * })=>object}
 */
export const createBackendContextInputFactory = (staticInput) => {
  const contextInput = {
    ...staticInput,
    backendPolicy: null,
    useSqlite: false,
    useLmdb: false,
    sqliteFtsRequested: false,
    vectorAnnEnabled: false
  };
  return ({
    backendPolicy,
    useSqlite,
    useLmdb,
    sqliteFtsRequested,
    vectorAnnEnabled
  }) => {
    contextInput.backendPolicy = backendPolicy;
    contextInput.useSqlite = useSqlite;
    contextInput.useLmdb = useLmdb;
    contextInput.sqliteFtsRequested = sqliteFtsRequested;
    contextInput.vectorAnnEnabled = vectorAnnEnabled;
    return contextInput;
  };
};

/**
 * Evaluate sparse-table preflight before index load.
 *
 * Ordering is important: this must run after query-plan filters are compiled
 * (so `filtersActive` is accurate) and before index loading so ANN fallback
 * can reinitialize backend handles exactly once when required.
 *
 * @param {{
 *   annEnabledEffective:boolean,
 *   useSqlite:boolean,
 *   backendLabel:string,
 *   sqliteFtsEnabled:boolean,
 *   runCode:boolean,
 *   runProse:boolean,
 *   runExtractedProse:boolean,
 *   runRecords:boolean,
 *   selectedModes:string[],
 *   requiresExtractedProse:boolean,
 *   loadExtractedProseSqlite:boolean,
 *   profilePolicyByMode:Record<string, {vectorOnly?:boolean}>,
 *   postingsConfig:object,
 *   allowSparseFallback:boolean,
 *   filtersActive:boolean,
 *   sparseBackend:string,
 *   sqliteHelpers:object
 * }} input
 * @returns {{
 *   annEnabledEffective:boolean,
 *   sparseFallbackForcedByPreflight:boolean,
 *   sparseMissingByMode:Record<string, string[]>,
 *   warning:string|null,
 *   errorMessage:string|null,
 *   errorCode:string|null
 * }}
 */
export const resolveSparsePreflightFallback = ({
  annEnabledEffective,
  useSqlite,
  backendLabel,
  sqliteFtsEnabled,
  runCode,
  runProse,
  runExtractedProse,
  runRecords,
  selectedModes,
  requiresExtractedProse,
  loadExtractedProseSqlite,
  profilePolicyByMode,
  postingsConfig,
  allowSparseFallback,
  filtersActive,
  sparseBackend,
  sqliteHelpers
}) => {
  const sparseMissingByMode = {};
  if (annEnabledEffective || !useSqlite) {
    return {
      annEnabledEffective,
      sparseFallbackForcedByPreflight: false,
      sparseMissingByMode,
      warning: null,
      errorMessage: null,
      errorCode: null
    };
  }

  const sqliteFtsRouting = resolveSqliteFtsRoutingByMode({
    useSqlite,
    sqliteFtsRequested: sqliteFtsEnabled,
    sqliteFtsExplicit: backendLabel === 'sqlite-fts',
    runCode,
    runProse,
    runExtractedProse,
    runRecords
  });
  const sparsePreflightModes = resolveSparsePreflightModes({
    selectedModes,
    requiresExtractedProse,
    loadExtractedProseSqlite
  });
  const tablePresenceCache = new Map();
  for (const mode of sparsePreflightModes) {
    if (profilePolicyByMode?.[mode]?.vectorOnly) continue;
    const missing = resolveSparsePreflightMissingTables({
      sqliteHelpers,
      mode,
      postingsConfig,
      sqliteFtsRoutingByMode: sqliteFtsRouting,
      allowSparseFallback,
      filtersActive,
      sparseBackend,
      tablePresenceCache
    });
    if (missing.length) sparseMissingByMode[mode] = missing;
  }

  if (!hasSparseMissingEntries(sparseMissingByMode)) {
    return {
      annEnabledEffective,
      sparseFallbackForcedByPreflight: false,
      sparseMissingByMode,
      warning: null,
      errorMessage: null,
      errorCode: null
    };
  }

  if (allowSparseFallback === true) {
    const details = formatSparseMissingDetails(sparseMissingByMode);
    const warning = (
      `Sparse tables missing for sparse-only request (${details}). ` +
      'Enabling ANN fallback because --allow-sparse-fallback was set.'
    );
    return {
      annEnabledEffective: true,
      sparseFallbackForcedByPreflight: true,
      sparseMissingByMode,
      warning,
      errorMessage: null,
      errorCode: null
    };
  }

  const details = formatSparseMissingDetails(sparseMissingByMode, { multiline: true });
  return {
    annEnabledEffective,
    sparseFallbackForcedByPreflight: false,
    sparseMissingByMode,
    warning: null,
    errorMessage: (
      `[search] ${RETRIEVAL_SPARSE_UNAVAILABLE_CODE}: sparse-only retrieval requires sparse tables, but required tables are missing.\n${details}\n` +
      'Rebuild sparse artifacts or enable ANN fallback.'
    ),
    errorCode: ERROR_CODES.CAPABILITY_MISSING
  };
};

/**
 * Build the post-index-load sparse-fallback ANN availability error message.
 *
 * @param {{
 *   sparseMissingByMode:Record<string, string[]>,
 *   sparseFallbackModesWithoutAnn:string[]
 * }} input
 * @returns {string}
 */
export const buildSparseFallbackAnnUnavailableMessage = ({
  sparseMissingByMode,
  sparseFallbackModesWithoutAnn
}) => {
  const sparseDetails = formatSparseMissingDetails(sparseMissingByMode, { multiline: true });
  return (
    `[search] ${RETRIEVAL_SPARSE_UNAVAILABLE_CODE}: --allow-sparse-fallback was set, but no ANN path is available for mode(s): ` +
    `${sparseFallbackModesWithoutAnn.join(', ')}.\n${sparseDetails}\n` +
    'Rebuild sparse artifacts or make ANN artifacts/providers available before using sparse fallback.'
  );
};
