import { search, status } from '../../src/integrations/core/index.js';
import { createSearchValidator } from './validation.js';
import { sendError, sendJson } from './response.js';
import { ERROR_CODES } from '../../src/shared/error-codes.js';
import { createSseResponder } from './sse.js';
import { createAuthGuard } from './router/auth.js';
import { createBodyParser } from './router/body.js';
import { createRepoCacheManager } from './router/cache.js';
import { createCorsResolver } from './router/cors.js';
import { createRepoResolver } from './router/paths.js';
import { buildSearchParams, isNoIndexError } from './router/search.js';

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
  const validateSearchPayload = createSearchValidator();
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





  // helper functions moved to router modules

  const handleRequest = async (req, res) => {
    let corsHeaders = null;
    try {
      const requestUrl = new URL(req.url || '/', `http://${host}`);
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
        await sse.sendEvent('start', { ok: true, repo: repoPath });
        try {
          const payload = await status(repoPath);
          if (!sse.isClosed()) {
            await sse.sendEvent('result', { ok: true, repo: repoPath, status: payload });
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
          sendJson(res, 200, { ok: true, repo: repoPath, status: payload }, corsHeaders || {});
        } catch (err) {
          sendError(res, 500, ERROR_CODES.INTERNAL, 'Failed to collect status.', {
            error: err?.message || String(err)
          }, corsHeaders || {});
        }
        return;
      }

      if (requestUrl.pathname === '/search/stream' && req.method === 'POST') {
        const sse = createSseResponder(req, res, { headers: corsHeaders || {} });
        const abortController = new AbortController();
        const abort = () => abortController.abort();
        req.on('aborted', abort);
        res.on('close', abort);
        res.on('error', abort);
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
            corsHeaders || {}
          );
          return;
        }
        const payload = raw;
        const validation = validateSearchPayload(payload);
        if (!validation.ok) {
          sendError(res, 400, ERROR_CODES.INVALID_REQUEST, 'Invalid search payload.', {
            errors: validation.errors
          }, corsHeaders || {});
          return;
        }
        let repoPath = '';
        try {
          repoPath = await resolveRepo(payload?.repoPath || payload?.repo);
        } catch (err) {
          const code = err?.code === ERROR_CODES.FORBIDDEN ? ERROR_CODES.FORBIDDEN : ERROR_CODES.INVALID_REQUEST;
          const status = err?.code === ERROR_CODES.FORBIDDEN ? 403 : 400;
          sendError(res, status, code, err?.message || 'Invalid repo path.', {}, corsHeaders || {});
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
            corsHeaders || {}
          );
          return;
        }
        const controller = new AbortController();
        const abortRequest = () => controller.abort();
        req.on('aborted', abortRequest);
        res.on('close', abortRequest);
        res.on('error', abortRequest);
        await sse.sendHeaders();
        await sse.sendEvent('start', { ok: true });
        await sse.sendEvent('progress', { ok: true, phase: 'search', message: 'Searching.' });
        const caches = getRepoCaches(repoPath);
        await refreshBuildPointer(caches);
        try {
          await sse.sendEvent('progress', { ok: true, phase: 'search', message: 'Running search.' });
          const body = await search(repoPath, {
            args: searchParams.args,
            query: searchParams.query,
            emitOutput: false,
            exitOnError: false,
            indexCache: caches.indexCache,
            sqliteCache: caches.sqliteCache,
            signal: controller.signal
          });
          if (!sse.isClosed()) {
            await sse.sendEvent('result', { ok: true, repo: repoPath, result: body });
            await sse.sendEvent('done', { ok: true });
          }
        } catch (err) {
          if (controller.signal.aborted || sse.isClosed()) {
            sse.end();
            return;
          }
          const isNoIndex = isNoIndexError(err);
          await sse.sendEvent('error', {
            ok: false,
            code: isNoIndex ? ERROR_CODES.NO_INDEX : ERROR_CODES.INTERNAL,
            message: err?.message || 'Search failed.'
          });
          await sse.sendEvent('done', { ok: false });
        }
        sse.end();
        return;
      }

      if (requestUrl.pathname === '/search' && req.method === 'POST') {
        const abortController = new AbortController();
        const abort = () => abortController.abort();
        req.on('aborted', abort);
        res.on('close', abort);
        res.on('error', abort);
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
        const validation = validateSearchPayload(payload);
        if (!validation.ok) {
          sendError(res, 400, ERROR_CODES.INVALID_REQUEST, 'Invalid search payload.', {
            errors: validation.errors
          }, corsHeaders || {});
          return;
        }
        let repoPath = '';
        try {
          repoPath = await resolveRepo(payload?.repoPath || payload?.repo);
        } catch (err) {
          const code = err?.code === ERROR_CODES.FORBIDDEN ? ERROR_CODES.FORBIDDEN : ERROR_CODES.INVALID_REQUEST;
          const status = err?.code === ERROR_CODES.FORBIDDEN ? 403 : 400;
          sendError(res, status, code, err?.message || 'Invalid repo path.', {}, corsHeaders || {});
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
            corsHeaders || {}
          );
          return;
        }
        try {
          const controller = new AbortController();
          const abortRequest = () => controller.abort();
          req.on('aborted', abortRequest);
          res.on('close', abortRequest);
          res.on('error', abortRequest);
          const caches = getRepoCaches(repoPath);
          await refreshBuildPointer(caches);
          const body = await search(repoPath, {
            args: searchParams.args,
            query: searchParams.query,
            emitOutput: false,
            exitOnError: false,
            indexCache: caches.indexCache,
            sqliteCache: caches.sqliteCache,
            signal: controller.signal
          });
          sendJson(res, 200, { ok: true, repo: repoPath, result: body }, corsHeaders || {});
        } catch (err) {
          if (req.aborted || res.writableEnded) return;
          if (isNoIndexError(err)) {
            sendError(res, 409, ERROR_CODES.NO_INDEX, err?.message || 'Index not found.', {
              error: err?.message || String(err)
            }, corsHeaders || {});
            return;
          }
          sendError(
            res,
            500,
            ERROR_CODES.INTERNAL,
            'Search failed.',
            { error: err?.message || String(err) },
            corsHeaders || {}
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
