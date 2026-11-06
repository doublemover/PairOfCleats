import { withHttpRequestLifetime } from './request-lifetime.js';
import { classifySemanticDetailError } from '../../../src/integrations/tooling/semantic-errors.js';
import { assertRepositoryAnswer } from '../../../src/contracts/validators/repository-answer.js';
import { runRepositoryAnswer } from '../../../src/integrations/tooling/repository-answer.js';
import { sendError, sendJson } from '../response.js';
import { ERROR_CODES } from '../../../src/shared/error-codes.js';
import { parseJsonBodyOrSendError, resolveRepoOrSendError } from './request-helpers.js';

export const handleRepositoryAnswerRoute = async ({ req, res, corsHeaders, parseJsonBody, resolveRepo }) => withHttpRequestLifetime(req, res, async lifetime => {
  const parsed = await lifetime.prepare(() => parseJsonBodyOrSendError(req, res, parseJsonBody, corsHeaders));
  if (!parsed.ok) return true;
  try { assertRepositoryAnswer('request', parsed.payload); }
  catch (error) { sendError(res, 400, ERROR_CODES.INVALID_REQUEST, error.message, { semanticCode: error.code }, corsHeaders || {}); return true; }
  let request = parsed.payload;
  if (request.mode !== 'inspect') {
    const resolved = await lifetime.prepare(() => resolveRepoOrSendError(res, resolveRepo, request.query.repoRoot, corsHeaders));
    if (!resolved.ok) return true;
    request = { ...request, query: { ...request.query, repoRoot: resolved.repoPath } };
  }
  try {
    const result = await runRepositoryAnswer(request, { signal: lifetime.signal });
    sendJson(res, 200, { ok: true, result }, corsHeaders || {});
  } catch (error) {
    if (lifetime.closedAfterFailure(error)) return true;
    const failure = classifySemanticDetailError(error);
    const code = failure.status === 404 ? ERROR_CODES.NO_INDEX : failure.status === 403 ? ERROR_CODES.FORBIDDEN
      : failure.status < 500 ? ERROR_CODES.INVALID_REQUEST : ERROR_CODES.INTERNAL;
    sendError(res, failure.status, code, failure.message, { semanticCode: failure.semanticCode,
      ...failure.details, ...(error.diagnostics ? { diagnostics: error.diagnostics } : {}) }, corsHeaders || {});
  }
  return true;
});
