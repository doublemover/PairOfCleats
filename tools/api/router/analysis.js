import { loadUserConfig } from '../../shared/dict-utils.js';
import { resolveIndexDir } from '../../../src/retrieval/cli-index.js';
import { hasIndexMeta } from '../../../src/retrieval/cli/index-loader.js';
import { buildRiskDeltaPayload } from '../../../src/context-pack/risk-delta.js';
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
      errors: filterValidation.errors,
      reason: 'invalid_risk_filters'
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
  validateContextPackPayload,
  ensureWorkspaceAllowlist
}) {
  const payload = await parseJsonBody(req);
  const validation = validateContextPackPayload(payload);
  if (!validation.ok) {
    sendError(res, 400, ERROR_CODES.INVALID_REQUEST, 'Invalid context-pack request.', {
      errors: validation.errors
    }, corsHeaders || {});
    return true;
  }

  const workspaceRequested = typeof payload.workspacePath === 'string' && payload.workspacePath.trim();
  const requestedRepo = typeof payload.repoPath === 'string' && payload.repoPath.trim()
    ? payload.repoPath
    : typeof payload.repo === 'string' && payload.repo.trim()
      ? payload.repo
      : '';
  const repoPath = requestedRepo
    ? await resolveRepo(requestedRepo)
    : null;
  try {
    const workspaceConfig = workspaceRequested && typeof ensureWorkspaceAllowlist === 'function'
      ? await ensureWorkspaceAllowlist(payload)
      : null;
    const resultObservability = buildChildObservability(observability, {
      surface: 'analysis',
      operation: 'context_pack',
      context: repoPath
        ? {
          repoRoot: repoPath
        }
        : {}
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
      maxWallClockMs: payload.maxWallClockMs,
      workspacePath: payload.workspacePath,
      workspaceId: payload.workspaceId,
      select: payload.select,
      includeDisabled: payload.includeDisabled,
      maxFederatedRepos: payload.maxFederatedRepos,
      workspaceConfig
    }, {
      trustedWorkspaceConfig: Boolean(workspaceConfig)
    });
    sendJson(res, 200, attachObservability({ ok: true, result }, resultObservability), corsHeaders || {});
    return true;
  } catch (err) {
    const message = err?.message || 'Failed to build context pack.';
    const forbidden = err?.code === ERROR_CODES.FORBIDDEN
      || String(message).toLowerCase().includes('not permitted');
    const status = Number.isFinite(err?.status) ? err.status
      : forbidden ? 403
        : err?.code === 'ERR_CONTEXT_PACK_NO_INDEX' ? 404
          : err?.code === 'ERR_CONTEXT_PACK_INVALID_REQUEST' || err?.code === 'ERR_CONTEXT_PACK_RISK_FILTER_INVALID' ? 400
            : 500;
    const details = err?.code === 'ERR_CONTEXT_PACK_RISK_FILTER_INVALID'
      ? { reason: 'invalid_risk_filters' }
      : err?.code === ERROR_CODES.FORBIDDEN ? { reason: 'workspace_not_permitted' } : {};
    const code = status === 400 ? ERROR_CODES.INVALID_REQUEST
      : status === 403 ? ERROR_CODES.FORBIDDEN
        : status === 404 ? ERROR_CODES.NO_INDEX
          : ERROR_CODES.INTERNAL;
    sendError(res, status, code, message, details, corsHeaders || {});
    return true;
  }
}

export async function handleRiskDeltaRoute({
  req,
  res,
  corsHeaders,
  observability,
  parseJsonBody,
  resolveRepo,
  validateRiskDeltaPayload
}) {
  const payload = await parseJsonBody(req);
  const validation = validateRiskDeltaPayload(payload);
  if (!validation.ok) {
    sendError(res, 400, ERROR_CODES.INVALID_REQUEST, 'Invalid risk delta request.', {
      errors: validation.errors
    }, corsHeaders || {});
    return true;
  }

  const repoPath = await resolveRepo(payload.repoPath || payload.repo || '');
  const filters = normalizeRiskFilters(payload.filters || null);
  const filterValidation = validateRiskFilters(filters);
  if (!filterValidation.ok) {
    sendError(res, 400, ERROR_CODES.INVALID_REQUEST, 'Invalid risk filters.', {
      errors: filterValidation.errors,
      reason: 'invalid_risk_filters'
    }, corsHeaders || {});
    return true;
  }

  try {
    const userConfig = loadUserConfig(repoPath);
    const resultObservability = buildChildObservability(observability, {
      surface: 'analysis',
      operation: 'risk_delta',
      context: {
        repoRoot: repoPath,
        from: String(payload.from),
        to: String(payload.to)
      }
    });
    const result = await buildRiskDeltaPayload({
      repoRoot: repoPath,
      userConfig,
      from: String(payload.from),
      to: String(payload.to),
      seed: String(payload.seed),
      filters,
      includePartialFlows: payload.includePartialFlows === true
    });
    sendJson(res, 200, attachObservability({ ok: true, result }, resultObservability), corsHeaders || {});
    return true;
  } catch (err) {
    const status = err?.code === ERROR_CODES.INVALID_REQUEST ? 400
      : err?.code === ERROR_CODES.NOT_FOUND ? 404
        : 500;
    const code = status === 400 ? ERROR_CODES.INVALID_REQUEST
      : status === 404 ? ERROR_CODES.NOT_FOUND
        : ERROR_CODES.INTERNAL;
    sendError(res, status, code, err?.message || 'Failed to build risk delta.', {
      ...(err?.reason ? { reason: err.reason } : {})
    }, corsHeaders || {});
    return true;
  }
}
