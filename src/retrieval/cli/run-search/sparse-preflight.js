import { ERROR_CODES } from '../../../shared/error-codes.js';
import { resolveSparsePreflightFallback } from './execution.js';

/**
 * Resolve sparse-preflight fallback policy and normalize warning/error handling.
 *
 * @param {{
 *   annEnabledEffective:boolean,
 *   useSqlite:boolean,
 *   backendLabel:string,
 *   sqliteFtsEnabled:boolean,
 *   runCode:boolean,
 *   runProse:boolean,
 *   runExtractedProseRaw:boolean,
 *   runRecords:boolean,
 *   selectedModes:string[],
 *   requiresExtractedProse:boolean,
 *   loadExtractedProseSqlite:boolean,
 *   profilePolicyByMode:object,
 *   postingsConfig:object,
 *   allowSparseFallback:boolean,
 *   filtersActive:boolean,
 *   sparseBackend:string|null,
 *   sqliteHelpers:object,
 *   addProfileWarning:(line:string)=>void,
 *   emitOutput:boolean
 * }} input
 * @returns {{
 *   annEnabledEffective:boolean,
 *   sparseFallbackForcedByPreflight:boolean,
 *   sparseMissingByMode:object,
 *   error:{message:string,code:string}|null
 * }}
 */
export const resolveRunSearchSparsePreflight = ({
  annEnabledEffective,
  useSqlite,
  backendLabel,
  sqliteFtsEnabled,
  runCode,
  runProse,
  runExtractedProseRaw,
  runRecords,
  selectedModes,
  requiresExtractedProse,
  loadExtractedProseSqlite,
  profilePolicyByMode,
  postingsConfig,
  allowSparseFallback,
  filtersActive,
  sparseBackend,
  sqliteHelpers,
  addProfileWarning,
  emitOutput
}) => {
  const sparsePreflight = resolveSparsePreflightFallback({
    annEnabledEffective,
    useSqlite,
    backendLabel,
    sqliteFtsEnabled,
    runCode,
    runProse,
    runExtractedProse: runExtractedProseRaw,
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
  });
  if (sparsePreflight.warning) {
    addProfileWarning(sparsePreflight.warning);
    if (emitOutput) {
      console.warn(`[search] ${sparsePreflight.warning}`);
    }
  }
  if (sparsePreflight.errorMessage) {
    return {
      annEnabledEffective,
      sparseFallbackForcedByPreflight: false,
      sparseMissingByMode: {},
      error: {
        message: sparsePreflight.errorMessage,
        code: sparsePreflight.errorCode || ERROR_CODES.CAPABILITY_MISSING
      }
    };
  }
  return {
    annEnabledEffective: sparsePreflight.annEnabledEffective,
    sparseFallbackForcedByPreflight: sparsePreflight.sparseFallbackForcedByPreflight,
    sparseMissingByMode: sparsePreflight.sparseMissingByMode,
    error: null
  };
};
