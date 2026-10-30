import { projectIndexFormatError } from '../../shared/index-format-error.js';
import { getRuntimeClaimPublication } from '../../shared/runtime-claim-publication.js';
import { getRuntimeClaimVerification } from '../../shared/runtime-claim-verification.js';

export const classifyRuntimeEvidenceError = error => {
  const format = projectIndexFormatError(error);
  const code = error.code || 'ERR_RUNTIME_QUERY_FAILED';
  const status = format || ['ERR_RUNTIME_QUERY_SCOPE', 'ERR_RUNTIME_IMPORT_INTEGRITY', 'ERR_RUNTIME_CLAIMS_INTEGRITY', 'ERR_RUNTIME_QUERY_INDEX_UNAVAILABLE', 'ERR_RUNTIME_FAMILY_CONTRACT'].includes(code) ? 409
    : code === 'ERR_RUNTIME_DESTINATION_FORBIDDEN' ? 403 : code === 'ERR_RUNTIME_FAMILY_UNAVAILABLE' ? 404
      : code === 'ERR_RUNTIME_QUERY_CURSOR' ? 410 : code === 'ERR_RUNTIME_QUERY_BUDGET' ? 422
        : code === 'ABORT_ERR' ? 499 : code === 'ERR_RUNTIME_QUERY_CONTRACT' || error instanceof TypeError ? 400 : 500;
  const publication = getRuntimeClaimPublication(error);
  const verification = getRuntimeClaimVerification(error);
  return { status, code: format?.nativeCode || code, message: error.message || 'Runtime evidence lookup failed.', ...(format || {}),
    ...(publication ? { runtimeClaimPublication: publication } : {}),
    ...(verification ? { runtimeClaimVerification: verification } : {}) };
};
