import { assertSemanticEnrichment } from '../../../src/contracts/validators/semantic-enrichment.js';
import { runSemanticEnrichment, classifySemanticEnrichmentError } from '../../../src/integrations/tooling/semantic-enrichment.js';
import { parseJsonBodyOrSendError, resolveRepoOrSendError } from './request-helpers.js';
import { sendError, sendJson } from '../response.js';
import { ERROR_CODES } from '../../../src/shared/error-codes.js';
export const handleSemanticEnrichmentRoute = async ({ req, res, corsHeaders, parseJsonBody, resolveRepo }) => {
  const parsed = await parseJsonBodyOrSendError(req, res, parseJsonBody, corsHeaders);
  if (!parsed.ok) return true;
  try { assertSemanticEnrichment('request', parsed.payload); }
  catch (error) { sendError(res, 400, ERROR_CODES.INVALID_REQUEST, error.message, { semanticCode: error.code }, corsHeaders || {}); return true; }
  const resolved = await resolveRepoOrSendError(res, resolveRepo, parsed.payload.repoRoot, corsHeaders);
  if (!resolved.ok) return true;
  const controller = new AbortController(), abort = () => controller.abort();
  req.on('aborted', abort); res.on('close', abort); res.on('error', abort);
  try {
    const result = await runSemanticEnrichment({ ...parsed.payload, repoRoot: resolved.repoPath }, { signal: controller.signal });
    sendJson(res, 200, { ok: true, result }, corsHeaders || {});
  } catch (error) {
    const failure = classifySemanticEnrichmentError(error);
    const code = failure.status === 404 ? ERROR_CODES.NOT_FOUND : failure.status < 500 ? ERROR_CODES.INVALID_REQUEST : ERROR_CODES.INTERNAL;
    sendError(res, failure.status, code, failure.message, { semanticCode: failure.code, ...failure }, corsHeaders || {});
  } finally { req.off('aborted', abort); res.off('close', abort); res.off('error', abort); }
  return true;
};
