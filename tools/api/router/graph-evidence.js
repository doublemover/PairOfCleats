import { withHttpRequestLifetime } from './request-lifetime.js';
import { parseJsonBodyOrSendError, resolveRepoOrSendError } from './request-helpers.js';
import { assertGraphEvidence } from '../../../src/contracts/validators/graph-evidence.js';
import { runGraphEvidence, classifyGraphEvidenceError } from '../../../src/integrations/tooling/graph-evidence.js';
import { sendError, sendJson } from '../response.js';
import { ERROR_CODES } from '../../../src/shared/error-codes.js';

export const handleGraphEvidenceRoute = async ({ req, res, corsHeaders, parseJsonBody, resolveRepo }) =>
  withHttpRequestLifetime(req, res, async lifetime => {
    const parsed = await lifetime.prepare(() => parseJsonBodyOrSendError(req, res, parseJsonBody, corsHeaders));
    if (!parsed.ok) return true;
    try { assertGraphEvidence('request', parsed.payload); }
    catch (error) { sendError(res, 400, ERROR_CODES.INVALID_REQUEST, error.message, { graphCode: error.code }, corsHeaders || {}); return true; }
    const resolved = await lifetime.prepare(() => resolveRepoOrSendError(res, resolveRepo, parsed.payload.repoRoot, corsHeaders));
    if (!resolved.ok) return true;
    try {
      const result = await runGraphEvidence({ ...parsed.payload, repoRoot: resolved.repoPath }, { signal: lifetime.signal });
      if (Buffer.byteLength(JSON.stringify({ ok: true, result })) > (parsed.payload.limits?.bytes ?? 1048576)) {
        throw Object.assign(new Error('Graph evidence HTTP envelope exceeds requested bytes.'), { code: 'ERR_GRAPH_EVIDENCE_OUTPUT_BYTES' });
      }
      if (!lifetime.closed()) sendJson(res, 200, { ok: true, result }, corsHeaders || {});
    } catch (error) {
      if (lifetime.closedAfterFailure(error)) return true;
      const failure = classifyGraphEvidenceError(error);
      sendError(res, failure.status, failure.status === 403 ? ERROR_CODES.FORBIDDEN : failure.status === 404
        ? ERROR_CODES.NO_INDEX : failure.status < 500 ? ERROR_CODES.INVALID_REQUEST : ERROR_CODES.INTERNAL,
      failure.message, { graphCode: failure.code }, corsHeaders || {});
    }
    return true;
  });
