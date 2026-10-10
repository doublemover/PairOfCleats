import { classifySemanticDetailError } from '../../../src/integrations/tooling/semantic-detail.js';
import { assertSemanticFind } from '../../../src/contracts/validators/semantic-find.js';
import { runSemanticFind } from '../../../src/integrations/tooling/semantic-find.js';
import { sendError, sendJson } from '../response.js';
import { ERROR_CODES } from '../../../src/shared/error-codes.js';
import { parseJsonBodyOrSendError, resolveRepoOrSendError } from './request-helpers.js';

export const handleSemanticFindRoute = async ({ req, res, corsHeaders, parseJsonBody, resolveRepo }) => {
  const parsed = await parseJsonBodyOrSendError(req, res, parseJsonBody, corsHeaders);
  if (!parsed.ok) return true;
  try { assertSemanticFind('request', parsed.payload); } catch (error) {
    sendError(res, 400, ERROR_CODES.INVALID_REQUEST, error.message, { semanticCode: error.code }, corsHeaders || {});
    return true;
  }
  const resolved = await resolveRepoOrSendError(res, resolveRepo, parsed.payload.repoRoot, corsHeaders);
  if (!resolved.ok) return true;
  const controller = new AbortController();
  const abort = () => controller.abort();
  req.on('aborted', abort); res.on('close', abort); res.on('error', abort);
  try {
    const result = await runSemanticFind({ ...parsed.payload, repoRoot: resolved.repoPath }, { signal: controller.signal });
    sendJson(res, 200, { ok: true, result }, corsHeaders || {});
  } catch (error) {
    const failure = classifySemanticDetailError(error);
    const code = failure.status === 404 ? ERROR_CODES.NO_INDEX : failure.status === 403 ? ERROR_CODES.FORBIDDEN
      : failure.status < 500 ? ERROR_CODES.INVALID_REQUEST : ERROR_CODES.INTERNAL;
    sendError(res, failure.status, code, failure.message, { semanticCode: failure.semanticCode, ...failure.details }, corsHeaders || {});
  } finally {
    req.off('aborted', abort); res.off('close', abort); res.off('error', abort);
  }
  return true;
};
