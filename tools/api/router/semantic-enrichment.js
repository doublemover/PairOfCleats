import { withHttpRequestLifetime } from './request-lifetime.js';
import { assertSemanticEnrichment } from '../../../src/contracts/validators/semantic-enrichment.js';
import { runSemanticEnrichment, classifySemanticEnrichmentError } from '../../../src/integrations/tooling/semantic-enrichment.js';
import { parseJsonBodyOrSendError, resolveRepoOrSendError } from './request-helpers.js';
import { sendError, sendJson } from '../response.js';
import { ERROR_CODES } from '../../../src/shared/error-codes.js';
export const handleSemanticEnrichmentRoute = async ({ req, res, corsHeaders, parseJsonBody, resolveRepo }) => withHttpRequestLifetime(req, res, async (lifetime) => {
  const parsed = await lifetime.prepare(() => parseJsonBodyOrSendError(req, res, parseJsonBody, corsHeaders));
  if (!parsed.ok) return true;
  try { assertSemanticEnrichment('request', parsed.payload); }
  catch (error) { sendError(res, 400, ERROR_CODES.INVALID_REQUEST, error.message, { semanticCode: error.code }, corsHeaders || {}); return true; }
  const resolved = await lifetime.prepare(() => resolveRepoOrSendError(res, resolveRepo, parsed.payload.repoRoot, corsHeaders));
  if (!resolved.ok) return true;
  const controller = lifetime;
  try {
    const result = await runSemanticEnrichment({ ...parsed.payload, repoRoot: resolved.repoPath }, { signal: controller.signal });
    sendJson(res, 200, { ok: true, result }, corsHeaders || {});
  } catch (error) {
    if (lifetime.closedAfterFailure(error)) return true;
    const failure = classifySemanticEnrichmentError(error);
    const code = failure.status === 404 ? ERROR_CODES.NOT_FOUND : failure.status === 403 ? ERROR_CODES.FORBIDDEN : failure.status < 500 ? ERROR_CODES.INVALID_REQUEST : ERROR_CODES.INTERNAL;
    sendError(res, failure.status, code, failure.message, { semanticCode: failure.code, ...failure }, corsHeaders || {});
  }
  return true;
});
