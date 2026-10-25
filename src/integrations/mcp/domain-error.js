import { classifySemanticDetailError } from '../tooling/semantic-errors.js';
import { ERROR_CODES } from '../../shared/error-codes.js';
import { getRuntimeClaimPublication } from '../../shared/runtime-claim-publication.js';

const KEYS = new Set(['complete', 'state', 'source', 'fileBacked', 'substituted', 'missing', 'truncated',
  'truncatedBytes', 'truncatedTokens', 'warningCodes', 'policy', 'strictEvidence', 'included', 'count',
  'total', 'shown', 'omitted', 'status', 'reason', 'code', 'currentHash', 'indexedHash', 'drift',
  'primary', 'types', 'risk', 'semantic', 'graph', 'extraction', 'analysis', 'response', 'returnedCount',
  'analysisStatus', 'strictFailure', 'reasons', 'requested', 'maximum', 'limit', 'actual', 'field',
  'expected', 'generation', 'semanticRevision', 'baseBuildId', 'expiresAt', 'coverage', 'warnings', 'sourceIdentity',
  'records', 'bytes', 'workMs', 'maxRecords', 'maxBytes', 'maxWorkMs']);

const projectDetails = input => {
  let visited = 0, truncated = false;
  const visit = (value, depth = 0) => {
    if (++visited > 128 || depth > 8) { truncated = true; return null; }
    if (value == null || typeof value === 'boolean') return value;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'string') { truncated ||= value.length > 512; return value.slice(0, 512); }
    if (Array.isArray(value)) {
      truncated ||= value.length > 16;
      return value.slice(0, 16).map(entry => visit(entry, depth + 1));
    }
    if (typeof value !== 'object') return null;
    const result = {};
    for (const key of KEYS) {
      const field = Object.getOwnPropertyDescriptor(value, key);
      if (field && Object.hasOwn(field, 'value')) result[key] = visit(field.value, depth + 1);
    }
    return result;
  };
  const result = visit(input);
  if (truncated && result && !Array.isArray(result) && typeof result === 'object') {
    result.truncated = true;
    if (Object.hasOwn(result, 'complete')) result.complete = false;
  }
  return Buffer.byteLength(JSON.stringify(result)) <= 16384 ? result
    : { truncated: true, reason: 'domain_details_budget' };
};

/** Explicit domain fields only. No Error causes, arbitrary properties or paths. */
export const projectMcpDomainError = error => {
  const result = {};
  const publication = getRuntimeClaimPublication(error);
  if (publication) result.runtimeClaimPublication = publication;
  if (typeof error?.reason === 'string' && /^[a-z0-9_-]{1,128}$/.test(error.reason)) result.reason = error.reason;
  if (error?.evidence && typeof error.evidence === 'object') result.evidence = projectDetails(error.evidence);
  if (error?.details && typeof error.details === 'object') result.details = projectDetails(error.details);
  if (typeof error?.code === 'string' && error.code.startsWith('ERR_SEMANTIC_')) {
    const domain = classifySemanticDetailError(error);
    result.code = ({ 400: ERROR_CODES.INVALID_REQUEST, 403: ERROR_CODES.FORBIDDEN, 404: ERROR_CODES.NO_INDEX,
      409: ERROR_CODES.INVALID_REQUEST, 410: ERROR_CODES.INVALID_REQUEST, 499: ERROR_CODES.CANCELLED })[domain.status]
      || ERROR_CODES.INTERNAL;
    if (domain.status === 410) {
      result.reason = 'semantic_cursor_expired';
      result.hint = 'Start a fresh discovery request for the selected generation; do not replay the expired cursor.';
    } else if (domain.status === 409) result.hint = 'Select the intended published generation and create a fresh request.';
  }
  return result;
};
