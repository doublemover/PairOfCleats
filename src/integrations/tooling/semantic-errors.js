import { projectIndexFormatError } from '../../shared/index-format-error.js';

/** Shared classification for detail, discovery and trace transport adapters. */
export const classifySemanticDetailError = error => {
  const format = projectIndexFormatError(error);
  const semanticCode = format?.nativeCode || error?.code || 'ERR_SEMANTIC_DETAIL';
  const status = ['ERR_SEMANTIC_QUERY_CONTRACT', 'ERR_SEMANTIC_QUERY_LIMIT', 'ERR_SEMANTIC_OUTPUT_LIMIT'].includes(semanticCode) ? 400
    : semanticCode === 'ERR_SEMANTIC_CURSOR_EXPIRED' ? 410
      : semanticCode === 'ERR_SEMANTIC_SCOPE_MISMATCH' ? 403
        : ['ERR_INDEX_FORMAT_UNSUPPORTED', 'ERR_SEMANTIC_GENERATION_MISMATCH'].includes(semanticCode) ? 409
          : ['ERR_SEMANTIC_UNAVAILABLE', 'ERR_SEMANTIC_QUERY_INDEX_UNAVAILABLE', 'ENOENT', 'NO_INDEX'].includes(semanticCode) ? 404
            : error?.name === 'AbortError' || semanticCode === 'ERR_ABORTED' ? 499 : 500;
  return { status, semanticCode, message: error?.message || 'Semantic detail failed.',
    ...(format ? { details: format } : error?.details ? { details: error.details } : {}) };
};
