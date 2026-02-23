import { ERROR_CODES } from '../../../shared/error-codes.js';
import {
  buildSparseFallbackAnnUnavailableMessage
} from './execution.js';
import { resolveSparseFallbackModesWithoutAnn } from '../preflight.js';

/**
 * Ensure sparse-fallback modes still have ANN capability after index load.
 *
 * @param {{
 *   sparseFallbackForcedByPreflight:boolean,
 *   sparseMissingByMode:object,
 *   idxCode:any,
 *   idxProse:any,
 *   idxExtractedProse:any,
 *   idxRecords:any,
 *   vectorAnnState:any,
 *   hnswAnnState:any,
 *   lanceAnnState:any
 * }} input
 * @returns {Promise<{message:string,code:string}|null>}
 */
export const enforceSparseFallbackAnnAvailability = async ({
  sparseFallbackForcedByPreflight,
  sparseMissingByMode,
  idxCode,
  idxProse,
  idxExtractedProse,
  idxRecords,
  vectorAnnState,
  hnswAnnState,
  lanceAnnState
}) => {
  if (!sparseFallbackForcedByPreflight) return null;
  const sparseFallbackModesWithoutAnn = await resolveSparseFallbackModesWithoutAnn({
    sparseMissingByMode,
    idxByMode: {
      code: idxCode,
      prose: idxProse,
      'extracted-prose': idxExtractedProse,
      records: idxRecords
    },
    vectorAnnState,
    hnswAnnState,
    lanceAnnState
  });
  if (!sparseFallbackModesWithoutAnn.length) return null;
  return {
    message: buildSparseFallbackAnnUnavailableMessage({
      sparseMissingByMode,
      sparseFallbackModesWithoutAnn
    }),
    code: ERROR_CODES.CAPABILITY_MISSING
  };
};
