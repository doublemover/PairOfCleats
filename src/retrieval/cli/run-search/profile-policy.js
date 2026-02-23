import {
  INDEX_PROFILE_VECTOR_ONLY,
  resolveProfileCohortModes,
  resolveProfileForState
} from '../preflight.js';
import { ERROR_CODES } from '../../../shared/error-codes.js';

/**
 * Resolve selected-mode retrieval profile policy and ANN fallback coercions.
 *
 * This helper keeps vector-only profile constraints centralized so the
 * top-level run-search flow can remain orchestration-focused.
 *
 * @param {{
 *   runCode:boolean,
 *   runProse:boolean,
 *   runRecords:boolean,
 *   runExtractedProse:boolean,
 *   requiresExtractedProse:boolean,
 *   indexStateByMode:Record<string, any>,
 *   allowSparseFallback:boolean,
 *   allowUnsafeMix:boolean,
 *   annFlagPresent:boolean,
 *   annEnabled:boolean,
 *   scoreMode:string|null
 * }} input
 * @returns {{
 *   selectedModes:string[],
 *   profilePolicyByMode:Record<string,{profileId:string|null,vectorOnly:boolean,allowSparseFallback:boolean,sparseUnavailableReason:string|null}>,
 *   vectorOnlyModes:string[],
 *   annEnabledEffective:boolean,
 *   warnings:string[],
 *   error:{message:string,code:string}|null
 * }}
 */
export const resolveRunSearchProfilePolicy = ({
  runCode,
  runProse,
  runRecords,
  runExtractedProse,
  requiresExtractedProse,
  indexStateByMode,
  allowSparseFallback,
  allowUnsafeMix,
  annFlagPresent,
  annEnabled,
  scoreMode
}) => {
  const selectedModes = resolveProfileCohortModes({
    runCode,
    runProse,
    runRecords,
    runExtractedProse,
    requiresExtractedProse
  });
  const profilePolicyByMode = {};
  const vectorOnlyModes = [];
  const profileModeDetails = [];
  const uniqueProfileIds = new Set();
  const warnings = [];
  let annEnabledEffective = annEnabled;
  for (const mode of selectedModes) {
    const profileId = resolveProfileForState(indexStateByMode[mode]);
    const vectorOnly = profileId === INDEX_PROFILE_VECTOR_ONLY;
    profilePolicyByMode[mode] = {
      profileId,
      vectorOnly,
      allowSparseFallback: allowSparseFallback === true,
      sparseUnavailableReason: vectorOnly ? 'profile_vector_only' : null
    };
    if (vectorOnly) vectorOnlyModes.push(mode);
    if (!indexStateByMode[mode]) continue;
    if (typeof profileId !== 'string' || !profileId) continue;
    uniqueProfileIds.add(profileId);
    profileModeDetails.push(`${mode}:${profileId}`);
  }
  if (uniqueProfileIds.size > 1) {
    const details = profileModeDetails.join(', ');
    if (allowUnsafeMix !== true) {
      return {
        selectedModes,
        profilePolicyByMode,
        vectorOnlyModes,
        annEnabledEffective,
        warnings,
        error: {
          message:
            `[search] retrieval_profile_mismatch: mixed index profiles detected (${details}). ` +
            'Rebuild indexes to a single profile or pass --allow-unsafe-mix to override.',
          code: ERROR_CODES.INVALID_REQUEST
        }
      };
    }
    warnings.push(`Unsafe mixed-profile cohort override enabled (--allow-unsafe-mix): ${details}.`);
  }
  const sparseOnlyRequested = scoreMode === 'sparse' || (annFlagPresent && annEnabled === false);
  if (vectorOnlyModes.length && sparseOnlyRequested) {
    if (allowSparseFallback !== true) {
      const details = vectorOnlyModes.join(', ');
      return {
        selectedModes,
        profilePolicyByMode,
        vectorOnlyModes,
        annEnabledEffective,
        warnings,
        error: {
          message:
            `[search] retrieval_profile_mismatch: sparse-only retrieval cannot run against vector_only index profile (${details}). ` +
            'Re-run with ANN enabled or pass --allow-sparse-fallback to allow ANN fallback.',
          code: ERROR_CODES.INVALID_REQUEST
        }
      };
    }
    warnings.push(
      `Sparse-only request overridden for vector_only mode(s): ${vectorOnlyModes.join(', ')}. ANN fallback was used.`
    );
    annEnabledEffective = true;
  }
  if (vectorOnlyModes.length && annEnabledEffective !== true) {
    warnings.push(
      `Forcing ANN on for vector_only mode(s): ${vectorOnlyModes.join(', ')}. Sparse providers are unavailable.`
    );
    annEnabledEffective = true;
  }
  return {
    selectedModes,
    profilePolicyByMode,
    vectorOnlyModes,
    annEnabledEffective,
    warnings,
    error: null
  };
};
