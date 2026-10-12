import { assertRuntimeQuery } from '../../../src/contracts/validators/runtime-query.js';
import { assertRuntimeClaims } from '../../../src/contracts/validators/runtime-claims.js';
import { runRuntimeCaptureComparison, runRuntimeDerivedClaimLookup } from '../../../src/integrations/tooling/runtime-claims.js';
import { runRuntimeEvidenceLookup, runRuntimeFamilyDiscovery, classifyRuntimeEvidenceError } from '../../../src/integrations/tooling/runtime-evidence.js';
import { sendError, sendJson } from '../response.js';
import { ERROR_CODES } from '../../../src/shared/error-codes.js';
import { parseJsonBodyOrSendError, resolveRepoOrSendError } from './request-helpers.js';

export const handleRuntimeEvidenceRoute = async ({ req, res, corsHeaders, parseJsonBody, resolveRepo, operation }) => {
  const parsed = await parseJsonBodyOrSendError(req, res, parseJsonBody, corsHeaders);
  if (!parsed.ok) return true;
  try {
    if (['compare', 'claims'].includes(operation)) assertRuntimeClaims(operation === 'compare' ? 'compareService' : 'claimsService', parsed.payload);
    else assertRuntimeQuery(operation === 'families' ? 'discoveryRequest' : 'lookupRequest', parsed.payload);
  }
  catch (error) { sendError(res, 400, ERROR_CODES.INVALID_REQUEST, error.message, { runtimeCode: error.code }, corsHeaders || {}); return true; }
  const resolved = await resolveRepoOrSendError(res, resolveRepo, parsed.payload.repoRoot, corsHeaders);
  if (!resolved.ok) return true;
  const controller = new AbortController(), abort = () => controller.abort();
  req.on('aborted', abort); res.on('close', abort); res.on('error', abort);
  try {
    const runner = operation === 'compare' ? runRuntimeCaptureComparison : operation === 'claims' ? runRuntimeDerivedClaimLookup
      : operation === 'families' ? runRuntimeFamilyDiscovery : runRuntimeEvidenceLookup;
    const result = await runner({ ...parsed.payload, repoRoot: resolved.repoPath }, { signal: controller.signal });
    sendJson(res, 200, { ok: true, result }, corsHeaders || {});
  } catch (error) {
    const failure = classifyRuntimeEvidenceError(error);
    const code = failure.status === 403 ? ERROR_CODES.FORBIDDEN : failure.status === 404 ? ERROR_CODES.NOT_FOUND
      : failure.status < 500 ? ERROR_CODES.INVALID_REQUEST : ERROR_CODES.INTERNAL;
    sendError(res, failure.status, code, failure.message, { runtimeCode: failure.code, ...failure }, corsHeaders || {});
  } finally { req.off('aborted', abort); res.off('close', abort); res.off('error', abort); }
  return true;
};
