import { ERROR_CODES } from '../../../src/shared/error-codes.js';
import { sendError } from '../response.js';

export const classifyBodyParseError = (err, fallbackMessage = 'Invalid request body.') => ({
  status: err?.code === 'ERR_BODY_TOO_LARGE'
    ? 413
    : err?.code === 'ERR_UNSUPPORTED_MEDIA_TYPE'
      ? 415
      : 400,
  code: ERROR_CODES.INVALID_REQUEST,
  message: err?.message || fallbackMessage
});

export const classifyRepoResolveError = (err, fallbackMessage = 'Invalid repo path.') => ({
  status: err?.code === ERROR_CODES.FORBIDDEN ? 403 : 400,
  code: err?.code === ERROR_CODES.FORBIDDEN ? ERROR_CODES.FORBIDDEN : ERROR_CODES.INVALID_REQUEST,
  message: err?.message || fallbackMessage
});

export const classifyWorkspaceRequestError = (err, fallbackMessage = 'Invalid workspace request.') => {
  const forbidden = err?.code === ERROR_CODES.FORBIDDEN
    || String(err?.message || '').toLowerCase().includes('not permitted');
  return {
    status: forbidden ? 403 : 400,
    code: forbidden ? ERROR_CODES.FORBIDDEN : ERROR_CODES.INVALID_REQUEST,
    message: err?.message || fallbackMessage
  };
};

export const sendClassifiedRequestError = (
  res,
  classification,
  corsHeaders,
  details = {}
) => {
  sendError(
    res,
    classification?.status || 500,
    classification?.code || ERROR_CODES.INTERNAL,
    classification?.message || 'Request failed.',
    details,
    corsHeaders || {}
  );
};

export const parseJsonBodyOrSendError = async (
  req,
  res,
  parseJsonBody,
  corsHeaders,
  fallbackMessage = 'Invalid request body.'
) => {
  try {
    return { ok: true, payload: await parseJsonBody(req) };
  } catch (err) {
    sendClassifiedRequestError(
      res,
      classifyBodyParseError(err, fallbackMessage),
      corsHeaders
    );
    return { ok: false, payload: null };
  }
};

export const resolveRepoOrSendError = async (
  res,
  resolveRepo,
  repoValue,
  corsHeaders,
  fallbackMessage = 'Invalid repo path.'
) => {
  try {
    return { ok: true, repoPath: await resolveRepo(repoValue) };
  } catch (err) {
    sendClassifiedRequestError(
      res,
      classifyRepoResolveError(err, fallbackMessage),
      corsHeaders
    );
    return { ok: false, repoPath: '' };
  }
};
