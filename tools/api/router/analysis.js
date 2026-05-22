import { loadUserConfig } from '../../shared/dict-utils.js';
import { resolveIndexDir } from '../../../src/retrieval/cli-index.js';
import { hasIndexMeta } from '../../../src/retrieval/cli/index-loader.js';
import { buildRiskDeltaPayload } from '../../../src/context-pack/risk-delta.js';
import { buildRiskExplainPayload } from '../../analysis/explain-risk.js';
import { projectRiskDeltaRequest, projectRiskExplainRequest } from '../../analysis/risk-request.js';
import { buildCompositeContextPackPayload } from '../../../src/integrations/tooling/context-pack.js';
import { buildContextPackRequestInput } from '../../../src/shared/context-pack-request.js';
import { attachObservability, buildChildObservability } from '../../../src/shared/observability.js';
import { ERROR_CODES } from '../../../src/shared/error-codes.js';
import { sendError, sendJson } from '../response.js';
import {
  classifyWorkspaceRequestError,
  parseJsonBodyOrSendError,
  resolveRepoOrSendError
} from './request-helpers.js';

export async function handleRiskExplainRoute({
  req,
  res,
  corsHeaders,
  observability,
  parseJsonBody,
  resolveRepo,
  validateRiskExplainPayload
}) {
  const parsedBody = await parseJsonBodyOrSendError(req, res, parseJsonBody, corsHeaders);
  if (!parsedBody.ok) return true;
  const payload = parsedBody.payload;
  const validation = validateRiskExplainPayload(payload);
  if (!validation.ok) {
    sendError(res, 400, ERROR_CODES.INVALID_REQUEST, 'Invalid risk explain request.', {
      errors: validation.errors
    }, corsHeaders || {});
    return true;
  }

  const resolvedRepo = await resolveRepoOrSendError(
    res,
    resolveRepo,
    payload.repoPath || payload.repo || '',
    corsHeaders
  );
  if (!resolvedRepo.ok) return true;
  const repoPath = resolvedRepo.repoPath;
  const userConfig = loadUserConfig(repoPath);
  const indexDir = resolveIndexDir(repoPath, 'code', userConfig);
  if (!hasIndexMeta(indexDir)) {
    sendError(res, 404, ERROR_CODES.NO_INDEX, 'Code index not found.', {
      repoPath,
      indexDir
    }, corsHeaders || {});
    return true;
  }

  const riskRequest = projectRiskExplainRequest(payload);
  const { filters, filterValidation } = riskRequest;
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
        chunkUid: riskRequest.chunkUid
      }
    });
    const result = await buildRiskExplainPayload({
      indexDir,
      chunkUid: riskRequest.chunkUid,
      max: riskRequest.max,
      filters,
      includePartialFlows: riskRequest.includePartialFlows,
      maxPartialFlows: riskRequest.maxPartialFlows
    });
    sendJson(res, 200, attachObservability({ ok: true, result }, resultObservability), corsHeaders || {});
    return true;
  } catch (err) {
    const message = err?.message || 'Failed to build risk explanation.';
    const isUnknownChunk = (
      err?.code === ERROR_CODES.INVALID_REQUEST && err?.reason === 'unknown_chunk_uid'
    ) || /Unknown chunkUid/i.test(message);
    const status = isUnknownChunk ? 400 : 500;
    const code = status === 400 ? ERROR_CODES.INVALID_REQUEST : ERROR_CODES.INTERNAL;
    sendError(res, status, code, message, isUnknownChunk ? { reason: 'unknown_chunk_uid' } : {}, corsHeaders || {});
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
  const parsedBody = await parseJsonBodyOrSendError(req, res, parseJsonBody, corsHeaders);
  if (!parsedBody.ok) return true;
  const payload = parsedBody.payload;
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
  let repoPath = null;
  if (!(workspaceRequested && !requestedRepo)) {
    const resolvedRepo = await resolveRepoOrSendError(
      res,
      resolveRepo,
      requestedRepo,
      corsHeaders
    );
    if (!resolvedRepo.ok) return true;
    repoPath = resolvedRepo.repoPath;
  }
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
    const result = await buildCompositeContextPackPayload(
      buildContextPackRequestInput(payload, {
        repoRoot: repoPath,
        riskFilters: payload.filters || null,
        workspaceConfig
      }),
      {
        trustedWorkspaceConfig: Boolean(workspaceConfig)
      }
    );
    sendJson(res, 200, attachObservability({ ok: true, result }, resultObservability), corsHeaders || {});
    return true;
  } catch (err) {
    const message = err?.message || 'Failed to build context pack.';
    const workspaceRequestError = classifyWorkspaceRequestError(err);
    const status = Number.isFinite(err?.status) ? err.status
      : workspaceRequestError.status === 403 ? 403
        : err?.code === 'ERR_CONTEXT_PACK_NO_INDEX' ? 404
          : err?.code === 'ERR_CONTEXT_PACK_INVALID_REQUEST'
              || err?.code === 'ERR_CONTEXT_PACK_RISK_FILTER_INVALID'
              || err?.code === 'ERR_CONTEXT_PACK_STRICT_EVIDENCE' ? 400
            : 500;
    const details = err?.code === 'ERR_CONTEXT_PACK_RISK_FILTER_INVALID'
      ? { reason: 'invalid_risk_filters' }
      : err?.code === 'ERR_CONTEXT_PACK_STRICT_EVIDENCE'
        ? { reason: 'strict_evidence_incomplete', evidence: err?.evidence || null }
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
  const parsedBody = await parseJsonBodyOrSendError(req, res, parseJsonBody, corsHeaders);
  if (!parsedBody.ok) return true;
  const payload = parsedBody.payload;
  const validation = validateRiskDeltaPayload(payload);
  if (!validation.ok) {
    sendError(res, 400, ERROR_CODES.INVALID_REQUEST, 'Invalid risk delta request.', {
      errors: validation.errors
    }, corsHeaders || {});
    return true;
  }

  const resolvedRepo = await resolveRepoOrSendError(
    res,
    resolveRepo,
    payload.repoPath || payload.repo || '',
    corsHeaders
  );
  if (!resolvedRepo.ok) return true;
  const repoPath = resolvedRepo.repoPath;
  const riskRequest = projectRiskDeltaRequest(payload);
  const { filters, filterValidation } = riskRequest;
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
        from: riskRequest.fromRef,
        to: riskRequest.toRef
      }
    });
    const result = await buildRiskDeltaPayload({
      repoRoot: repoPath,
      userConfig,
      from: riskRequest.fromRef,
      to: riskRequest.toRef,
      seed: riskRequest.seed,
      filters,
      includePartialFlows: riskRequest.includePartialFlows
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
