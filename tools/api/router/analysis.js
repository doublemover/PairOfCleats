import { loadUserConfig } from '../../shared/dict-utils.js';
import { resolveIndexDir } from '../../../src/retrieval/cli-index.js';
import { hasIndexMeta } from '../../../src/retrieval/cli/index-loader.js';
import { buildRiskExplainPayload } from '../../analysis/explain-risk.js';
import { normalizeRiskFilters, validateRiskFilters } from '../../../src/shared/risk-filters.js';
import { ERROR_CODES } from '../../../src/shared/error-codes.js';
import { sendError, sendJson } from '../response.js';

export async function handleRiskExplainRoute({
  req,
  res,
  corsHeaders,
  parseJsonBody,
  resolveRepo,
  validateRiskExplainPayload
}) {
  const payload = await parseJsonBody(req);
  const validation = validateRiskExplainPayload(payload);
  if (!validation.ok) {
    sendError(res, 400, ERROR_CODES.INVALID_REQUEST, 'Invalid risk explain request.', {
      errors: validation.errors
    }, corsHeaders || {});
    return true;
  }

  const repoPath = await resolveRepo(payload.repoPath || payload.repo || '');
  const userConfig = loadUserConfig(repoPath);
  const indexDir = resolveIndexDir(repoPath, 'code', userConfig);
  if (!hasIndexMeta(indexDir)) {
    sendError(res, 404, ERROR_CODES.NO_INDEX, 'Code index not found.', {
      repoPath,
      indexDir
    }, corsHeaders || {});
    return true;
  }

  const filters = normalizeRiskFilters(payload.filters || null);
  const filterValidation = validateRiskFilters(filters);
  if (!filterValidation.ok) {
    sendError(res, 400, ERROR_CODES.INVALID_REQUEST, 'Invalid risk filters.', {
      errors: filterValidation.errors
    }, corsHeaders || {});
    return true;
  }

  try {
    const result = await buildRiskExplainPayload({
      indexDir,
      chunkUid: String(payload.chunk),
      max: payload.max,
      filters
    });
    sendJson(res, 200, { ok: true, result }, corsHeaders || {});
    return true;
  } catch (err) {
    const message = err?.message || 'Failed to build risk explanation.';
    const status = /Unknown chunkUid/i.test(message) ? 400 : 500;
    const code = status === 400 ? ERROR_CODES.INVALID_REQUEST : ERROR_CODES.INTERNAL;
    sendError(res, status, code, message, {}, corsHeaders || {});
    return true;
  }
}
