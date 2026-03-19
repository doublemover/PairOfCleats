import path from 'node:path';
import { search, status } from '../../src/integrations/core/index.js';
import { MCP_SCHEMA_VERSION } from '../../src/integrations/mcp/defs.js';
import { runFederatedSearch } from '../../src/retrieval/federation/coordinator.js';
import { loadWorkspaceConfig } from '../../src/workspace/config.js';
import { resolveFederationCacheRoot } from '../../src/workspace/manifest.js';
import {
  createContextPackValidator,
  createFederatedSearchValidator,
  createRiskDeltaValidator,
  createRiskExplainValidator,
  createSearchValidator
} from './validation.js';
import { sendError, sendJson } from './response.js';
import { ERROR_CODES } from '../../src/shared/error-codes.js';
import { getToolVersion, isWithinRoot, toRealPathSync } from '../shared/dict-utils.js';
import { createSseResponder } from './sse.js';
import { createAuthGuard } from './router/auth.js';
import { createBodyParser } from './router/body.js';
import { createRepoCacheManager } from './router/cache.js';
import { createCorsResolver } from './router/cors.js';
import { createRepoResolver } from './router/paths.js';
import { handleIndexDiffsRoute } from './router/index-diffs.js';
import { handleIndexSnapshotsRoute } from './router/index-snapshots.js';
import { handleContextPackRoute, handleRiskDeltaRoute, handleRiskExplainRoute } from './router/analysis.js';
import { buildSearchParams, buildSearchPayloadFromQuery, isNoIndexError } from './router/search.js';
import { getApiWorkflowCapabilities, getRuntimeCapabilityManifest } from '../../src/shared/runtime-capability-manifest.js';
import {
  attachObservability,
  buildChildObservability,
  buildObservabilityHeaders,
  normalizeObservability
} from '../../src/shared/observability.js';

/**
 * Create an API router for the HTTP server.
 * @param {{
 *  host:string,
 *  defaultRepo:string,
 *  defaultOutput:string,
 *  metricsRegistry:any,
 *  cors?:{allowedOrigins?:string[],allowAnyOrigin?:boolean},
 *  auth?:{token?:string|null,required?:boolean},
 *  allowedRepoRoots?:string[],
 *  maxBodyBytes?:number,
 *  repoCache?:{maxEntries?:number,ttlMs?:number},
 *  indexCache?:{maxEntries?:number,ttlMs?:number},
 *  sqliteCache?:{maxEntries?:number,ttlMs?:number}
 * }} config
 */
export const createApiRouter = ({
  host,
  defaultRepo,
  defaultOutput,
  metricsRegistry,
  cors = {},
  auth = {},
  allowedRepoRoots = [],
  maxBodyBytes = 1_000_000,
  repoCache = {},
  indexCache = {},
  sqliteCache = {}
}) => {
  const toolVersion = getToolVersion() || '0.0.0';
  const validateSearchPayload = createSearchValidator();
  const validateFederatedPayload = createFederatedSearchValidator();
  const validateRiskExplainPayload = createRiskExplainValidator();
  const validateRiskDeltaPayload = createRiskDeltaValidator();
  const validateContextPackPayload = createContextPackValidator();
  const { resolveCorsHeaders } = createCorsResolver(cors);
  const { isAuthorized } = createAuthGuard(auth);
  const { parseJsonBody } = createBodyParser({ maxBodyBytes });
  const { resolveRepo } = createRepoResolver({ defaultRepo, allowedRepoRoots });
  const { getRepoCaches, closeRepoCaches, refreshBuildPointer } = createRepoCacheManager({
    defaultRepo,
    repoCache,
    indexCache,
    sqliteCache
  });
  const canonicalConfiguredAllowedRoots = [defaultRepo, ...allowedRepoRoots]
    .filter((entry) => typeof entry === 'string' && entry.trim())
    .map((entry) => toRealPathSync(path.resolve(entry)));
  const canonicalWorkspacePolicyRoots = Array.from(new Set([
    ...canonicalConfiguredAllowedRoots,
    // Always include the default federation cache root so explicit repo-root
    // allowlists do not accidentally block workspace-path/cache-root workflows.
    resolveFederationCacheRoot(null)
  ]));
  const isAllowedWorkspacePath = (workspacePath) => {
    if (!canonicalWorkspacePolicyRoots.length) return true;
    const workspaceCanonical = toRealPathSync(workspacePath);
    return canonicalWorkspacePolicyRoots.some((root) => isWithinRoot(workspaceCanonical, root));
  };

  const resolveWorkspacePath = (payload) => {
    const value = payload?.workspacePath;
    if (typeof value !== 'string') return '';
    const trimmed = value.trim();
    if (!trimmed) return '';
    return path.resolve(trimmed);
  };

  /**
   * Classify federated failures caused by client input that passed schema shape
   * validation but failed semantic checks (for example cohort selector issues).
   *
   * These must map to HTTP 400 instead of 500 so callers can distinguish
   * retryable server faults from request fixes.
   *
   * @param {any} err
   * @returns {boolean}
   */
  const isFederatedClientError = (err) => {
    if (!err) return false;
    if (err.code === ERROR_CODES.INVALID_REQUEST) return true;
    if (typeof err.code === 'string' && err.code.startsWith('ERR_FEDERATED_')) return true;
    const message = String(err.message || '').toLowerCase();
    return message.includes('invalid cohort selector')
      || message.includes('multiple global cohort selectors')
      || message.includes('requested cohort')
      || message.includes('multiple cohorts detected');
  };

  /**
   * Validate federated workspace inputs against server path allowlists.
   *
   * This enforces both repo roots and the resolved federated cache root so
   * manifest/query-cache writes cannot escape configured allowed roots. The
   * returned workspace config snapshot is then passed into the federated
   * coordinator as trusted input to avoid a post-validation reload race.
   *
   * @param {any} payload
   * @returns {Promise<any>}
   */
  const ensureWorkspaceAllowlist = async (payload) => {
    const resolvedWorkspacePath = resolveWorkspacePath(payload);
    if (!resolvedWorkspacePath) {
      throw new Error('Federated search requires workspacePath.');
    }
    if (!isAllowedWorkspacePath(resolvedWorkspacePath)) {
      const err = new Error('Workspace path not permitted by server configuration.');
      err.code = ERROR_CODES.FORBIDDEN;
      throw err;
    }
    const workspaceConfig = loadWorkspaceConfig(resolvedWorkspacePath);
    for (const repo of workspaceConfig.repos) {
      await resolveRepo(repo.repoRootCanonical);
    }
    const federationCacheRoot = resolveFederationCacheRoot(workspaceConfig);
    if (!isAllowedWorkspacePath(federationCacheRoot)) {
      const err = new Error('Workspace cache root not permitted by server configuration.');
      err.code = ERROR_CODES.FORBIDDEN;
      throw err;
    }
    if (payload?.workspaceId && payload.workspaceId !== workspaceConfig.repoSetId) {
      throw new Error('workspaceId does not match the provided workspacePath.');
    }
    return workspaceConfig;
  };

  const mergeResponseHeaders = (headers, observability = null) => ({
    ...(headers || {}),
    ...buildObservabilityHeaders(observability)
  });

  const createRequestObservability = (req, requestUrl, operation, context = {}) => normalizeObservability({
    correlationId: req?.headers?.['x-correlation-id'] || null,
    parentCorrelationId: req?.headers?.['x-parent-correlation-id'] || null,
    requestId: req?.headers?.['x-request-id'] || null
  }, {
    surface: 'api',
    operation,
    context: {
      method: req?.method || null,
      path: requestUrl?.pathname || null,
      ...context
    }
  });





  // helper functions moved to router modules

  const handleRequest = async (req, res) => {
    let corsHeaders = null;
    try {
      const requestUrl = new URL(req.url || '/', 'http://localhost');
      corsHeaders = resolveCorsHeaders(req);
      const origin = req?.headers?.origin ? String(req.headers.origin) : '';
      if (origin && !corsHeaders) {
        sendError(res, 403, ERROR_CODES.FORBIDDEN, 'Origin not allowed.', {}, {});
        return;
      }
      if (req.method === 'OPTIONS') {
        res.writeHead(204, corsHeaders || {});
        res.end();
        return;
      }
      if (!isAuthorized(req)) {
        sendError(res, 401, ERROR_CODES.UNAUTHORIZED, 'Missing or invalid API token.', {}, corsHeaders || {});
        return;
      }

      if (requestUrl.pathname === '/health' && req.method === 'GET') {
        sendJson(res, 200, { ok: true, uptimeMs: Math.round(process.uptime() * 1000) }, corsHeaders || {});
        return;
      }

      if (requestUrl.pathname === '/capabilities' && req.method === 'GET') {
        const runtimeManifest = getRuntimeCapabilityManifest();
        sendJson(res, 200, {
          ok: true,
          schemaVersion: MCP_SCHEMA_VERSION,
          toolVersion,
          serverInfo: {
            name: 'PairOfCleats',
            version: toolVersion
          },
          capabilities: getApiWorkflowCapabilities({ runtimeCapabilities: runtimeManifest.runtimeCapabilities }),
          runtimeCapabilities: runtimeManifest.runtimeCapabilities,
          runtimeManifest
        }, corsHeaders || {});
        return;
      }

      if (requestUrl.pathname === '/metrics' && req.method === 'GET') {
        try {
          const body = await metricsRegistry.metrics();
          res.writeHead(200, {
            'Content-Type': metricsRegistry.contentType || 'text/plain; version=0.0.4; charset=utf-8',
            ...(corsHeaders || {})
          });
          res.end(body);
        } catch (err) {
          sendError(res, 500, ERROR_CODES.INTERNAL, 'Failed to render metrics.', {
            error: err?.message || String(err)
          }, corsHeaders || {});
        }
        return;
      }

      if (requestUrl.pathname === '/analysis/risk-explain' && req.method === 'POST') {
        const requestObservability = createRequestObservability(req, requestUrl, 'risk_explain');
        await handleRiskExplainRoute({
          req,
          res,
          corsHeaders: mergeResponseHeaders(corsHeaders, requestObservability),
          observability: requestObservability,
          parseJsonBody,
          resolveRepo,
          validateRiskExplainPayload
        });
        return;
      }

      if (requestUrl.pathname === '/analysis/risk-delta' && req.method === 'POST') {
        const requestObservability = createRequestObservability(req, requestUrl, 'risk_delta');
        await handleRiskDeltaRoute({
          req,
          res,
          corsHeaders: mergeResponseHeaders(corsHeaders, requestObservability),
          observability: requestObservability,
          parseJsonBody,
          resolveRepo,
          validateRiskDeltaPayload
        });
        return;
      }

      if (requestUrl.pathname === '/analysis/context-pack' && req.method === 'POST') {
        const requestObservability = createRequestObservability(req, requestUrl, 'context_pack');
        await handleContextPackRoute({
          req,
          res,
          corsHeaders: mergeResponseHeaders(corsHeaders, requestObservability),
          observability: requestObservability,
          parseJsonBody,
          resolveRepo,
          validateContextPackPayload
        });
        return;
      }

      if (requestUrl.pathname === '/status/stream' && req.method === 'GET') {
        const sse = createSseResponder(req, res, { headers: corsHeaders || {} });
        let repoPath = '';
        try {
          repoPath = await resolveRepo(requestUrl.searchParams.get('repo'));
        } catch (err) {
          await sse.sendHeaders();
          await sse.sendEvent('error', {
            ok: false,
            code: err?.code || ERROR_CODES.INVALID_REQUEST,
            message: err?.message || 'Invalid repo path.'
          });
          await sse.sendEvent('done', { ok: false });
          sse.end();
          return;
        }
        await sse.sendHeaders();
        await sse.sendEvent('start', { ok: true });
        try {
          const payload = await status(repoPath);
          if (!sse.isClosed()) {
            await sse.sendEvent('result', { ok: true, status: payload });
            await sse.sendEvent('done', { ok: true });
          }
        } catch (err) {
          await sse.sendEvent('error', {
            ok: false,
            code: ERROR_CODES.INTERNAL,
            message: err?.message || 'Failed to collect status.'
          });
          await sse.sendEvent('done', { ok: false });
        }
        sse.end();
        return;
      }

      if (requestUrl.pathname === '/status' && req.method === 'GET') {
        let repoPath = '';
        try {
          repoPath = await resolveRepo(requestUrl.searchParams.get('repo'));
        } catch (err) {
          const code = err?.code === ERROR_CODES.FORBIDDEN ? ERROR_CODES.FORBIDDEN : ERROR_CODES.INVALID_REQUEST;
          const status = err?.code === ERROR_CODES.FORBIDDEN ? 403 : 400;
          sendError(res, status, code, err?.message || 'Invalid repo path.', {}, corsHeaders || {});
          return;
        }
        try {
          const payload = await status(repoPath);
          sendJson(res, 200, { ok: true, status: payload }, corsHeaders || {});
        } catch (err) {
          sendError(res, 500, ERROR_CODES.INTERNAL, 'Failed to collect status.', {
            error: err?.message || String(err)
          }, corsHeaders || {});
        }
        return;
      }

      if (await handleIndexSnapshotsRoute({
        req,
        res,
        requestUrl,
        pathname: requestUrl.pathname,
        corsHeaders,
        resolveRepo,
        parseJsonBody
      })) {
        return;
      }

      if (await handleIndexDiffsRoute({
        req,
        res,
        requestUrl,
        pathname: requestUrl.pathname,
        corsHeaders,
        resolveRepo
      })) {
        return;
      }

      if (requestUrl.pathname === '/search/federated' && req.method === 'POST') {
        const controller = new AbortController();
        const abortRequest = () => controller.abort();
        req.on('aborted', abortRequest);
        res.on('close', abortRequest);
        res.on('error', abortRequest);
        let payload = null;
        try {
          payload = await parseJsonBody(req);
        } catch (err) {
          const status = err?.code === 'ERR_BODY_TOO_LARGE' ? 413
            : err?.code === 'ERR_UNSUPPORTED_MEDIA_TYPE' ? 415
              : 400;
          sendError(
            res,
            status,
            ERROR_CODES.INVALID_REQUEST,
            err?.message || 'Invalid request body.',
            {},
            corsHeaders || {}
          );
          return;
        }
        const validation = validateFederatedPayload(payload);
        if (!validation.ok) {
          sendError(res, 400, ERROR_CODES.INVALID_REQUEST, 'Invalid federated search payload.', {
            errors: validation.errors
          }, corsHeaders || {});
          return;
        }
        let workspaceConfig = null;
        try {
          workspaceConfig = await ensureWorkspaceAllowlist(payload);
        } catch (err) {
          const forbidden = err?.code === ERROR_CODES.FORBIDDEN
            || String(err?.message || '').toLowerCase().includes('not permitted');
          sendError(
            res,
            forbidden ? 403 : 400,
            forbidden ? ERROR_CODES.FORBIDDEN : ERROR_CODES.INVALID_REQUEST,
            err?.message || 'Invalid workspace request.',
            {},
            corsHeaders || {}
          );
          return;
        }
        try {
          const federatedRepoCaches = new Map();
          /**
           * Reuse API-managed per-repo caches for federated requests so repeated
           * /search/federated calls avoid reopening index/sqlite resources.
           *
           * @param {string} repoPath
           * @returns {Promise<{indexCache:any, sqliteCache:any}>}
           */
          const resolveFederatedRepoCaches = async (repoPath) => {
            const repoKey = toRealPathSync(path.resolve(repoPath));
            let entry = federatedRepoCaches.get(repoKey);
            if (!entry) {
              entry = getRepoCaches(repoKey);
              federatedRepoCaches.set(repoKey, entry);
            }
            await refreshBuildPointer(entry);
            return entry;
          };
          const result = await runFederatedSearch({
            ...payload,
            workspacePath: workspaceConfig.workspacePath,
            workspaceConfig
          }, {
            signal: controller.signal,
            resolveRepoCaches: resolveFederatedRepoCaches,
            trustedWorkspaceConfig: true
          });
          sendJson(res, 200, result, corsHeaders || {});
        } catch (err) {
          if (req.aborted || res.writableEnded) return;
          const isNoIndex = isNoIndexError(err);
          const isClientError = isFederatedClientError(err);
          sendError(
            res,
            isNoIndex ? 409 : isClientError ? 400 : 500,
            isNoIndex ? ERROR_CODES.NO_INDEX : isClientError ? ERROR_CODES.INVALID_REQUEST : (err?.code || ERROR_CODES.INTERNAL),
            err?.message || 'Federated search failed.',
            { error: err?.message || String(err) },
            corsHeaders || {}
          );
        }
        return;
      }

      if (requestUrl.pathname === '/search' && req.method === 'GET') {
        const requestObservability = createRequestObservability(req, requestUrl, 'search');
        const responseHeaders = mergeResponseHeaders(corsHeaders, requestObservability);
        const controller = new AbortController();
        const abortRequest = () => controller.abort();
        req.on('aborted', abortRequest);
        res.on('close', abortRequest);
        res.on('error', abortRequest);
        const { payload, errors: queryErrors } = buildSearchPayloadFromQuery(requestUrl.searchParams);
        if (Array.isArray(queryErrors) && queryErrors.length) {
          sendError(res, 400, ERROR_CODES.INVALID_REQUEST, 'Invalid search payload.', {
            errors: queryErrors
          }, responseHeaders);
          return;
        }
        const validation = validateSearchPayload(payload);
        if (!validation.ok) {
          sendError(res, 400, ERROR_CODES.INVALID_REQUEST, 'Invalid search payload.', {
            errors: validation.errors
          }, responseHeaders);
          return;
        }
        let repoPath = '';
        try {
          repoPath = await resolveRepo(payload?.repoPath || payload?.repo);
        } catch (err) {
          const code = err?.code === ERROR_CODES.FORBIDDEN ? ERROR_CODES.FORBIDDEN : ERROR_CODES.INVALID_REQUEST;
          const status = err?.code === ERROR_CODES.FORBIDDEN ? 403 : 400;
          sendError(res, status, code, err?.message || 'Invalid repo path.', {}, responseHeaders);
          return;
        }
        const searchObservability = buildChildObservability(requestObservability, {
          surface: 'search',
          operation: 'search',
          context: {
            repoRoot: repoPath
          }
        });
        const searchParams = buildSearchParams(repoPath, payload || {}, defaultOutput);
        if (!searchParams.ok) {
          sendError(
            res,
            400,
            ERROR_CODES.INVALID_REQUEST,
            searchParams.message || 'Invalid search payload.',
            {},
            responseHeaders
          );
          return;
        }
        try {
          const caches = getRepoCaches(repoPath);
          await refreshBuildPointer(caches);
          const body = await search(repoPath, {
            args: searchParams.args,
            query: searchParams.query,
            emitOutput: false,
            exitOnError: false,
            indexCache: caches.indexCache,
            sqliteCache: caches.sqliteCache,
            signal: controller.signal,
            observability: searchObservability
          });
          sendJson(res, 200, attachObservability({ ok: true, result: body }, requestObservability), responseHeaders);
        } catch (err) {
          if (req.aborted || res.writableEnded || controller.signal.aborted) return;
          if (isNoIndexError(err)) {
            sendError(res, 409, ERROR_CODES.NO_INDEX, err?.message || 'Index not found.', {
              error: err?.message || String(err)
            }, responseHeaders);
            return;
          }
          sendError(
            res,
            500,
            ERROR_CODES.INTERNAL,
            'Search failed.',
            { error: err?.message || String(err) },
            responseHeaders
          );
        }
        return;
      }

      if (requestUrl.pathname === '/search/stream' && req.method === 'POST') {
        const requestObservability = createRequestObservability(req, requestUrl, 'search_stream');
        const responseHeaders = mergeResponseHeaders(corsHeaders, requestObservability);
        const searchObservability = buildChildObservability(requestObservability, {
          surface: 'search',
          operation: 'search',
          context: {
            stream: true
          }
        });
        const sse = createSseResponder(req, res, { headers: responseHeaders });
        const controller = new AbortController();
        const abortRequest = () => controller.abort();
        req.on('aborted', abortRequest);
        res.on('close', abortRequest);
        res.on('error', abortRequest);
        let raw;
        try {
          raw = await parseJsonBody(req);
        } catch (err) {
          const status = err?.code === 'ERR_BODY_TOO_LARGE' ? 413
            : err?.code === 'ERR_UNSUPPORTED_MEDIA_TYPE' ? 415
              : 400;
          sendError(
            res,
            status,
            ERROR_CODES.INVALID_REQUEST,
            err?.message || 'Invalid request body.',
            {},
            responseHeaders
          );
          return;
        }
        const payload = raw;
        const validation = validateSearchPayload(payload);
        if (!validation.ok) {
          sendError(res, 400, ERROR_CODES.INVALID_REQUEST, 'Invalid search payload.', {
            errors: validation.errors
          }, responseHeaders);
          return;
        }
        let repoPath = '';
        try {
          repoPath = await resolveRepo(payload?.repoPath || payload?.repo);
        } catch (err) {
          const code = err?.code === ERROR_CODES.FORBIDDEN ? ERROR_CODES.FORBIDDEN : ERROR_CODES.INVALID_REQUEST;
          const status = err?.code === ERROR_CODES.FORBIDDEN ? 403 : 400;
          sendError(res, status, code, err?.message || 'Invalid repo path.', {}, responseHeaders);
          return;
        }
        const searchParams = buildSearchParams(repoPath, payload || {}, defaultOutput);
        if (!searchParams.ok) {
          sendError(
            res,
            400,
            ERROR_CODES.INVALID_REQUEST,
            searchParams.message || 'Invalid search payload.',
            {},
            responseHeaders
          );
          return;
        }
        await sse.sendHeaders();
        await sse.sendEvent('start', attachObservability({ ok: true }, requestObservability));
        await sse.sendEvent('progress', attachObservability({ ok: true, phase: 'search', message: 'Searching.' }, requestObservability));
        const caches = getRepoCaches(repoPath);
        await refreshBuildPointer(caches);
        try {
          await sse.sendEvent('progress', attachObservability({ ok: true, phase: 'search', message: 'Running search.' }, requestObservability));
          const body = await search(repoPath, {
            args: searchParams.args,
            query: searchParams.query,
            emitOutput: false,
            exitOnError: false,
            indexCache: caches.indexCache,
            sqliteCache: caches.sqliteCache,
            signal: controller.signal,
            observability: searchObservability
          });
          if (!sse.isClosed()) {
            await sse.sendEvent('result', attachObservability({ ok: true, result: body }, requestObservability));
            await sse.sendEvent('done', attachObservability({ ok: true }, requestObservability));
          }
        } catch (err) {
          if (controller.signal.aborted || sse.isClosed()) {
            sse.end();
            return;
          }
          const isNoIndex = isNoIndexError(err);
          await sse.sendEvent('error', attachObservability({
            ok: false,
            code: isNoIndex ? ERROR_CODES.NO_INDEX : ERROR_CODES.INTERNAL,
            message: err?.message || 'Search failed.'
          }, requestObservability));
          await sse.sendEvent('done', attachObservability({ ok: false }, requestObservability));
        }
        sse.end();
        return;
      }

      if (requestUrl.pathname === '/search' && req.method === 'POST') {
        const requestObservability = createRequestObservability(req, requestUrl, 'search');
        const responseHeaders = mergeResponseHeaders(corsHeaders, requestObservability);
        const controller = new AbortController();
        const abortRequest = () => controller.abort();
        req.on('aborted', abortRequest);
        res.on('close', abortRequest);
        res.on('error', abortRequest);
        let payload = null;
        try {
          payload = await parseJsonBody(req);
        } catch (err) {
          const status = err?.code === 'ERR_BODY_TOO_LARGE' ? 413
            : err?.code === 'ERR_UNSUPPORTED_MEDIA_TYPE' ? 415
              : 400;
          sendError(
            res,
            status,
            ERROR_CODES.INVALID_REQUEST,
            err?.message || 'Invalid request body.',
            {},
            responseHeaders
          );
          return;
        }
        const validation = validateSearchPayload(payload);
        if (!validation.ok) {
          sendError(res, 400, ERROR_CODES.INVALID_REQUEST, 'Invalid search payload.', {
            errors: validation.errors
          }, responseHeaders);
          return;
        }
        let repoPath = '';
        try {
          repoPath = await resolveRepo(payload?.repoPath || payload?.repo);
        } catch (err) {
          const code = err?.code === ERROR_CODES.FORBIDDEN ? ERROR_CODES.FORBIDDEN : ERROR_CODES.INVALID_REQUEST;
          const status = err?.code === ERROR_CODES.FORBIDDEN ? 403 : 400;
          sendError(res, status, code, err?.message || 'Invalid repo path.', {}, responseHeaders);
          return;
        }
        const searchObservability = buildChildObservability(requestObservability, {
          surface: 'search',
          operation: 'search',
          context: {
            repoRoot: repoPath
          }
        });
        const searchParams = buildSearchParams(repoPath, payload || {}, defaultOutput);
        if (!searchParams.ok) {
          sendError(
            res,
            400,
            ERROR_CODES.INVALID_REQUEST,
            searchParams.message || 'Invalid search payload.',
            {},
            responseHeaders
          );
          return;
        }
        try {
          const caches = getRepoCaches(repoPath);
          await refreshBuildPointer(caches);
          const body = await search(repoPath, {
            args: searchParams.args,
            query: searchParams.query,
            emitOutput: false,
            exitOnError: false,
            indexCache: caches.indexCache,
            sqliteCache: caches.sqliteCache,
            signal: controller.signal,
            observability: searchObservability
          });
          sendJson(res, 200, attachObservability({ ok: true, result: body }, requestObservability), responseHeaders);
        } catch (err) {
          if (req.aborted || res.writableEnded) return;
          if (isNoIndexError(err)) {
            sendError(res, 409, ERROR_CODES.NO_INDEX, err?.message || 'Index not found.', {
              error: err?.message || String(err)
            }, responseHeaders);
            return;
          }
          sendError(
            res,
            500,
            ERROR_CODES.INTERNAL,
            'Search failed.',
            { error: err?.message || String(err) },
            responseHeaders
          );
        }
        return;
      }

      sendError(res, 404, ERROR_CODES.NOT_FOUND, 'Not found.', {}, corsHeaders || {});
    } catch (err) {
      if (res.writableEnded) return;
      sendError(
        res,
        500,
        ERROR_CODES.INTERNAL,
        'Unhandled server error.',
        { error: err?.message || String(err) },
        corsHeaders || {}
      );
    }
  };

  return {
    handleRequest,
    close: closeRepoCaches
  };
};
