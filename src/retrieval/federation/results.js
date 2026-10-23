import { createError, ERROR_CODES } from '../../shared/error-codes.js';

const keys = { code: 'code', prose: 'prose', 'extracted-prose': 'extractedProse', records: 'records' };

/** Missing mode payloads are failed work, never evidence of a healthy no-hit call. */
export const validateFederatedModeResult = (result, modes) => {
  if (!result || typeof result !== 'object' || Array.isArray(result) || result.ok === false) {
    throw createError(result?.code || ERROR_CODES.INTERNAL, result?.message || 'Repository did not return a successful search result.');
  }
  for (const mode of modes) {
    const hits = result[keys[mode]];
    if (!Array.isArray(hits) || hits.some(hit => !hit || typeof hit !== 'object' || Array.isArray(hit))) {
      throw createError(ERROR_CODES.INTERNAL, `Repository did not fulfill the admitted ${mode} result contract.`);
    }
  }
};
