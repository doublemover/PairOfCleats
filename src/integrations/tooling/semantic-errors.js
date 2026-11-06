import { projectIndexFormatError } from '../../shared/index-format-error.js';
import { observeStorageResource } from '../../shared/storage/failure-observation.js';

/** Shared classification for detail, discovery and trace transport adapters. */
export const classifySemanticDetailError = error => {
  const format = projectIndexFormatError(error);
  const observation = observeStorageResource(error, { phase: 'semantic-transport-error' });
  observation.requireSettled();
  let code, name, message, details;
  try {
    code = error?.code; name = error?.name; message = error?.message; details = error?.details;
  } catch (inspection) { throw observation.retain(inspection, { inspectionPresent: true }); }
  observation.requireSettled();
  const semanticCode = format?.nativeCode || (typeof code === 'string' && code ? code : 'ERR_SEMANTIC_DETAIL');
  const status = ['ERR_SEMANTIC_QUERY_CONTRACT', 'ERR_SEMANTIC_QUERY_LIMIT', 'ERR_SEMANTIC_OUTPUT_LIMIT', 'ERR_ANSWER_EVIDENCE_CONTRACT', 'ERR_ANSWER_RESPONSE_BUDGET'].includes(semanticCode) ? 400
    : semanticCode === 'ERR_SEMANTIC_CURSOR_EXPIRED' ? 410
      : semanticCode === 'ERR_SEMANTIC_SCOPE_MISMATCH' ? 403
        : ['ERR_INDEX_FORMAT_UNSUPPORTED', 'ERR_SEMANTIC_GENERATION_MISMATCH', 'ERR_ANSWER_BASE_MISMATCH'].includes(semanticCode) ? 409
          : ['ERR_SEMANTIC_UNAVAILABLE', 'ERR_SEMANTIC_QUERY_INDEX_UNAVAILABLE', 'ENOENT', 'NO_INDEX'].includes(semanticCode) ? 404
            : name === 'AbortError' || semanticCode === 'ERR_ABORTED' ? 499 : 500;
  return { status, semanticCode, message: typeof message === 'string' && message ? message : 'Semantic detail failed.',
    ...(format ? { details: format } : details ? { details } : {}) };
};
