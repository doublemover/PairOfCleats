import { loadUserConfig } from '../../shared/dict-utils.js';
import { resolveIndexDir } from '../../../src/retrieval/cli-index.js';
import { hasIndexMeta } from '../../../src/retrieval/cli/index-loader.js';
import { buildRiskExplainPayload } from '../../analysis/explain-risk.js';
import { buildCompositeContextPackPayload } from '../../../src/integrations/tooling/context-pack.js';
import { attachObservability, buildChildObservability } from '../../../src/shared/observability.js';
import { normalizeRiskFilters, validateRiskFilters } from '../../../src/shared/risk-filters.js';
import { ERROR_CODES } from '../../../src/shared/error-codes.js';
import { sendError, sendJson } from '../response.js';

export async function handleRiskExplainRoute({
  req,
  res,
  corsHeaders,
  observability,
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
    const resultObservability = buildChildObservability(observability, {
      surface: 'analysis',
      operation: 'risk_explain',
      context: {
        repoRoot: repoPath,
        chunkUid: String(payload.chunk)
      }
    });
    const result = await buildRiskExplainPayload({
      indexDir,
      chunkUid: String(payload.chunk),
      max: payload.max,
      filters,
      includePartialFlows: payload.includePartialFlows === true,
      maxPartialFlows: payload.maxPartialFlows
    });
    sendJson(res, 200, attachObservability({ ok: true, result }, resultObservability), corsHeaders || {});
    return true;
  } catch (err) {
    const message = err?.message || 'Failed to build risk explanation.';
    const status = /Unknown chunkUid/i.test(message) ? 400 : 500;
    const code = status === 400 ? ERROR_CODES.INVALID_REQUEST : ERROR_CODES.INTERNAL;
    sendError(res, status, code, message, {}, corsHeaders || {});
    return true;
  }
}

export async function handleContextPackRoute({
  req,
  res,
  corsHeaders,
  observability,
  parseJsonBody,
  resolveRepo,
  validateContextPackPayload
}) {
  const payload = await parseJsonBody(req);
  const validation = validateContextPackPayload(payload);
  if (!validation.ok) {
    sendError(res, 400, ERROR_CODES.INVALID_REQUEST, 'Invalid context-pack request.', {
      errors: validation.errors
    }, corsHeaders || {});
    return true;
  }

  const repoPath = await resolveRepo(payload.repoPath || payload.repo || '');
  try {
    const resultObservability = buildChildObservability(observability, {
      surface: 'analysis',
      operation: 'context_pack',
      context: {
        repoRoot: repoPath
      }
    });
    const result = await buildCompositeContextPackPayload({
      repoRoot: repoPath,
      seed: payload.seed,
      hops: payload.hops,
      includeGraph: payload.includeGraph,
      includeTypes: payload.includeTypes,
      includeRisk: payload.includeRisk,
      includeRiskPartialFlows: payload.includeRiskPartialFlows,
      strictRisk: payload.strictRisk,
      riskFilters: payload.filters || null,
      includeImports: payload.includeImports,
      includeUsages: payload.includeUsages,
      includeCallersCallees: payload.includeCallersCallees,
      includePaths: payload.includePaths,
      maxBytes: payload.maxBytes,
      maxTokens: payload.maxTokens,
      maxTypeEntries: payload.maxTypeEntries,
      maxDepth: payload.maxDepth,
      maxFanoutPerNode: payload.maxFanoutPerNode,
      maxNodes: payload.maxNodes,
      maxEdges: payload.maxEdges,
      maxPaths: payload.maxPaths,
      maxCandidates: payload.maxCandidates,
      maxWorkUnits: payload.maxWorkUnits,
      maxWallClockMs: payload.maxWallClockMs
    });
    sendJson(res, 200, attachObservability({ ok: true, result }, resultObservability), corsHeaders || {});
    return true;
  } catch (err) {
    const message = err?.message || 'Failed to build context pack.';
    const status = Number.isFinite(err?.status) ? err.status
      : err?.code === 'ERR_CONTEXT_PACK_NO_INDEX' ? 404
        : err?.code === 'ERR_CONTEXT_PACK_INVALID_REQUEST' || err?.code === 'ERR_CONTEXT_PACK_RISK_FILTER_INVALID' ? 400
          : 500;
    const code = status === 400 ? ERROR_CODES.INVALID_REQUEST
      : status === 404 ? ERROR_CODES.NO_INDEX
        : ERROR_CODES.INTERNAL;
    sendError(res, status, code, message, {}, corsHeaders || {});
    return true;
  }
}
