import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { LRUCache } from 'lru-cache';
import { getRepoCacheRoot, loadUserConfig, resolveRepoRoot } from '../dict-utils.js';
import { search, status } from '../../src/integrations/core/index.js';
import { createSqliteDbCache } from '../../src/retrieval/sqlite-cache.js';
import { createIndexCache } from '../../src/retrieval/index-cache.js';
import { createSearchValidator, normalizeMetaFilters } from './validation.js';
import { sendError, sendJson } from './response.js';
import { ERROR_CODES } from '../../src/shared/error-codes.js';
import { createSseResponder } from './sse.js';
import { incCacheEviction, setCacheSize } from '../../src/shared/metrics.js';

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
  const normalizeCacheConfig = (value, defaults) => {
    const maxEntries = Number.isFinite(Number(value?.maxEntries))
      ? Math.max(0, Math.floor(Number(value.maxEntries)))
      : defaults.maxEntries;
    const ttlMs = Number.isFinite(Number(value?.ttlMs))
      ? Math.max(0, Number(value.ttlMs))
      : defaults.ttlMs;
    return { maxEntries, ttlMs };
  };
  const repoCacheConfig = normalizeCacheConfig(repoCache, { maxEntries: 5, ttlMs: 15 * 60 * 1000 });
  const indexCacheConfig = normalizeCacheConfig(indexCache, { maxEntries: 4, ttlMs: 15 * 60 * 1000 });
  const sqliteCacheConfig = normalizeCacheConfig(sqliteCache, { maxEntries: 4, ttlMs: 15 * 60 * 1000 });
  const repoCaches = new LRUCache({
    max: repoCacheConfig.maxEntries,
    ttl: repoCacheConfig.ttlMs > 0 ? repoCacheConfig.ttlMs : undefined,
    allowStale: false,
    updateAgeOnGet: true,
    dispose: (entry, _key, reason) => {
      try {
        entry?.indexCache?.clear?.();
        entry?.sqliteCache?.closeAll?.();
      } catch {}
      if (reason === 'evict' || reason === 'expire') {
        incCacheEviction({ cache: 'repo' });
      }
      setCacheSize({ cache: 'repo', value: repoCaches.size });
    }
  });
  const authToken = typeof auth.token === 'string' && auth.token.trim()
    ? auth.token.trim()
    : null;
  const authRequired = auth.required === true;
  const allowAnyOrigin = cors.allowAnyOrigin === true;
  const allowedOrigins = Array.isArray(cors.allowedOrigins)
    ? cors.allowedOrigins.map((entry) => String(entry || '').trim()).filter(Boolean)
    : [];
  const allowLocalOrigins = !allowAnyOrigin && allowedOrigins.length === 0;
  const normalizedDefaultRepo = defaultRepo ? path.resolve(defaultRepo) : '';
  const resolvedRepoRoots = [
    normalizedDefaultRepo,
    ...allowedRepoRoots.map((entry) => path.resolve(String(entry || '')))
  ].filter(Boolean);
  const normalizePath = (value) => {
    const resolved = value ? path.resolve(value) : '';
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  };
  const toRealPath = (value) => {
    if (!value) return '';
    try {
      return fs.realpathSync(value);
    } catch {
      return path.resolve(value);
    }
  };
  const toRealPathAsync = async (value) => {
    if (!value) return '';
    try {
      return await fsPromises.realpath(value);
    } catch {
      return path.resolve(value);
    }
  };
  const normalizedRepoRoots = resolvedRepoRoots.map((root) => normalizePath(toRealPath(root)));
  const isWithinRoot = (candidate, root) => {
    if (!candidate || !root) return false;
    const relative = path.relative(root, candidate);
    if (!relative) return true;
    return !relative.startsWith('..') && !path.isAbsolute(relative);
  };
  const isAllowedRepoPath = (candidate) => normalizedRepoRoots.some((root) => isWithinRoot(candidate, root));
  const isLocalOrigin = (origin) => {
    try {
      const parsed = new URL(origin);
      const host = String(parsed.hostname || '').toLowerCase();
      return host === 'localhost' || host === '127.0.0.1' || host === '::1';
    } catch {
      return false;
    }
  };
  const isOriginAllowed = (origin) => {
    if (allowAnyOrigin) return true;
    if (allowLocalOrigins) return isLocalOrigin(origin);
    const raw = String(origin || '').trim();
    if (!raw) return false;
    const lowered = raw.toLowerCase();
    return allowedOrigins.some((entry) => {
      const normalized = String(entry || '').trim().toLowerCase();
      if (!normalized) return false;
      if (normalized.includes('://')) return normalized === lowered;
      try {
        const parsed = new URL(raw);
        return parsed.hostname.toLowerCase() === normalized;
      } catch {
        return false;
      }
    });
  };
  const resolveCorsHeaders = (req) => {
    const origin = req?.headers?.origin ? String(req.headers.origin) : '';
    if (!origin) return null;
    if (!isOriginAllowed(origin)) return null;
    return {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      Vary: 'Origin'
    };
  };

  const buildRepoCacheEntry = (repoPath) => {
    const userConfig = loadUserConfig(repoPath);
    const repoCacheRoot = getRepoCacheRoot(repoPath, userConfig);
    return {
      indexCache: createIndexCache(indexCacheConfig),
      sqliteCache: createSqliteDbCache(sqliteCacheConfig),
      lastUsed: Date.now(),
      buildId: null,
      buildPointerPath: path.join(repoCacheRoot, 'builds', 'current.json'),
      buildPointerMtimeMs: null
    };
  };

  const refreshBuildPointer = async (entry) => {
    if (!entry?.buildPointerPath) return;
    let stat = null;
    try {
      stat = await fsPromises.stat(entry.buildPointerPath);
    } catch {
      stat = null;
    }
    const nextMtime = stat?.mtimeMs || null;
    if (entry.buildPointerMtimeMs && entry.buildPointerMtimeMs === nextMtime) {
      return;
    }
    entry.buildPointerMtimeMs = nextMtime;
    if (!stat) {
      if (entry.buildId) {
        entry.indexCache?.clear?.();
        entry.sqliteCache?.closeAll?.();
      }
      entry.buildId = null;
      return;
    }
    try {
      const raw = await fsPromises.readFile(entry.buildPointerPath, 'utf8');
      const data = JSON.parse(raw) || {};
      const nextBuildId = typeof data.buildId === 'string' ? data.buildId : null;
      const changed = (entry.buildId && !nextBuildId)
        || (entry.buildId && nextBuildId && entry.buildId !== nextBuildId)
        || (!entry.buildId && nextBuildId);
      if (changed) {
        entry.indexCache?.clear?.();
        entry.sqliteCache?.closeAll?.();
      }
      entry.buildId = nextBuildId;
    } catch {
      entry.buildPointerMtimeMs = null;
    }
  };

  const getRepoCaches = (repoPath) => {
    const key = repoPath || defaultRepo;
    let entry = repoCaches.get(key);
    if (entry) {
      entry.lastUsed = Date.now();
    } else {
      entry = buildRepoCacheEntry(key);
      repoCaches.set(key, entry);
      setCacheSize({ cache: 'repo', value: repoCaches.size });
    }
    return entry;
  };

  const closeRepoCaches = () => {
    repoCaches.clear();
    setCacheSize({ cache: 'repo', value: repoCaches.size });
  };

  /**
   * Parse a JSON request body.
   * @param {import('node:http').IncomingMessage} req
   * @returns {Promise<string>}
   */
  const parseBody = (req) => new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buffer.length;
      if (maxBodyBytes && total > maxBodyBytes) {
        const err = new Error('Request body too large.');
        err.code = 'ERR_BODY_TOO_LARGE';
        reject(err);
        req.destroy();
        return;
      }
      chunks.push(buffer);
    });
    req.on('aborted', () => reject(new Error('Request aborted.')));
    req.on('end', () => resolve(Buffer.concat(chunks, total)));
    req.on('error', reject);
  });

  const parseJsonBody = async (req) => {
    const contentType = String(req?.headers?.['content-type'] || '').toLowerCase();
    if (!contentType.includes('application/json')) {
      const err = new Error('Content-Type must be application/json.');
      err.code = 'ERR_UNSUPPORTED_MEDIA_TYPE';
      throw err;
    }
    const buffer = await parseBody(req);
    if (!buffer?.length) return null;
    return JSON.parse(buffer.toString('utf8'));
  };

  const isAuthorized = (req) => {
    if (!authRequired) return true;
    if (!authToken) return false;
    const header = req?.headers?.authorization || '';
    const match = /^Bearer\s+(.+)$/i.exec(String(header));
    if (!match) return false;
    return match[1] === authToken;
  };

  /**
   * Resolve and validate a repo path.
   * @param {string|null|undefined} value
   * @returns {string}
   */
  const resolveRepo = async (value) => {
    const candidate = value ? path.resolve(value) : normalizedDefaultRepo;
    const candidateReal = normalizePath(await toRealPathAsync(candidate));
    if (value && !isAllowedRepoPath(candidateReal)) {
      const err = new Error('Repo path not permitted by server configuration.');
      err.code = ERROR_CODES.FORBIDDEN;
      throw err;
    }
    let candidateStat;
    try {
      candidateStat = await fsPromises.stat(candidateReal);
    } catch {
      candidateStat = null;
    }
    if (!candidateStat) {
      throw new Error(`Repo path not found: ${candidate}`);
    }
    if (!candidateStat.isDirectory()) {
      throw new Error(`Repo path is not a directory: ${candidate}`);
    }
    const resolvedRoot = value ? resolveRepoRoot(candidateReal) : candidateReal;
    const resolvedReal = normalizePath(await toRealPathAsync(resolvedRoot));
    if (value && !isAllowedRepoPath(resolvedReal)) {
      const err = new Error('Resolved repo root not permitted by server configuration.');
      err.code = ERROR_CODES.FORBIDDEN;
      throw err;
    }
    return resolvedReal;
  };

  /**
   * Build CLI search arguments from a request payload.
   * @param {string} repoPath
   * @param {any} payload
   * @returns {{ok:boolean,message?:string,args?:string[],query?:string}}
   */
  const buildSearchParams = (repoPath, payload) => {
    const query = payload?.query ? String(payload.query) : '';
    if (!query) {
      return { ok: false, message: 'Missing query.' };
    }
    const output = payload?.output || defaultOutput;
    const useCompact = output !== 'full' && output !== 'json';
    const searchArgs = [useCompact ? '--json-compact' : '--json', '--repo', repoPath];
    const mode = payload?.mode ? String(payload.mode) : null;
    const backend = payload?.backend ? String(payload.backend) : null;
    const ann = payload?.ann;
    const top = Number.isFinite(Number(payload?.top)) ? Number(payload.top) : null;
    const context = Number.isFinite(Number(payload?.context)) ? Number(payload.context) : null;
    const typeFilter = payload?.type ? String(payload.type) : null;
    const authorFilter = payload?.author ? String(payload.author) : null;
    const importFilter = payload?.import ? String(payload.import) : null;
    const callsFilter = payload?.calls ? String(payload.calls) : null;
    const usesFilter = payload?.uses ? String(payload.uses) : null;
    const signatureFilter = payload?.signature ? String(payload.signature) : null;
    const paramFilter = payload?.param ? String(payload.param) : null;
    const decoratorFilter = payload?.decorator ? String(payload.decorator) : null;
    const inferredTypeFilter = payload?.inferredType ? String(payload.inferredType) : null;
    const returnTypeFilter = payload?.returnType ? String(payload.returnType) : null;
    const throwsFilter = payload?.throws ? String(payload.throws) : null;
    const readsFilter = payload?.reads ? String(payload.reads) : null;
    const writesFilter = payload?.writes ? String(payload.writes) : null;
    const mutatesFilter = payload?.mutates ? String(payload.mutates) : null;
    const aliasFilter = payload?.alias ? String(payload.alias) : null;
    const awaitsFilter = payload?.awaits ? String(payload.awaits) : null;
    const riskFilter = payload?.risk ? String(payload.risk) : null;
    const riskTagFilter = payload?.riskTag ? String(payload.riskTag) : null;
    const riskSourceFilter = payload?.riskSource ? String(payload.riskSource) : null;
    const riskSinkFilter = payload?.riskSink ? String(payload.riskSink) : null;
    const riskCategoryFilter = payload?.riskCategory ? String(payload.riskCategory) : null;
    const riskFlowFilter = payload?.riskFlow ? String(payload.riskFlow) : null;
    const branchesMin = Number.isFinite(Number(payload?.branchesMin)) ? Number(payload.branchesMin) : null;
    const loopsMin = Number.isFinite(Number(payload?.loopsMin)) ? Number(payload.loopsMin) : null;
    const breaksMin = Number.isFinite(Number(payload?.breaksMin)) ? Number(payload.breaksMin) : null;
    const continuesMin = Number.isFinite(Number(payload?.continuesMin)) ? Number(payload.continuesMin) : null;
    const churnMin = Number.isFinite(Number(payload?.churnMin)) ? Number(payload.churnMin) : null;
    const chunkAuthorFilter = payload?.chunkAuthor ? String(payload.chunkAuthor) : null;
    const modifiedAfter = payload?.modifiedAfter ? String(payload.modifiedAfter) : null;
    const modifiedSince = Number.isFinite(Number(payload?.modifiedSince)) ? Number(payload.modifiedSince) : null;
    const visibilityFilter = payload?.visibility ? String(payload.visibility) : null;
    const extendsFilter = payload?.extends ? String(payload.extends) : null;
    const lintFilter = payload?.lint === true;
    const asyncFilter = payload?.async === true;
    const generatorFilter = payload?.generator === true;
    const returnsFilter = payload?.returns === true;
    const branchFilter = payload?.branch ? String(payload.branch) : null;
    const langFilter = payload?.lang ? String(payload.lang) : null;
    const caseAll = payload?.case === true;
    const caseFile = payload?.caseFile === true || caseAll;
    const caseTokens = payload?.caseTokens === true || caseAll;
    const fileFilters = [];
    const toList = (value) => (Array.isArray(value) ? value : (value == null ? [] : [value]));
    fileFilters.push(...toList(payload?.path));
    fileFilters.push(...toList(payload?.file));
    const extFilters = toList(payload?.ext);
    const metaFilters = normalizeMetaFilters(payload?.meta);
    const metaJson = payload?.metaJson || null;

    if (mode && mode !== 'both') searchArgs.push('--mode', mode);
    if (backend) searchArgs.push('--backend', backend);
    if (ann === true) searchArgs.push('--ann');
    if (ann === false) searchArgs.push('--no-ann');
    if (top) searchArgs.push('-n', String(top));
    if (context !== null) searchArgs.push('--context', String(context));
    if (typeFilter) searchArgs.push('--type', typeFilter);
    if (authorFilter) searchArgs.push('--author', authorFilter);
    if (importFilter) searchArgs.push('--import', importFilter);
    if (callsFilter) searchArgs.push('--calls', callsFilter);
    if (usesFilter) searchArgs.push('--uses', usesFilter);
    if (signatureFilter) searchArgs.push('--signature', signatureFilter);
    if (paramFilter) searchArgs.push('--param', paramFilter);
    if (decoratorFilter) searchArgs.push('--decorator', decoratorFilter);
    if (inferredTypeFilter) searchArgs.push('--inferred-type', inferredTypeFilter);
    if (returnTypeFilter) searchArgs.push('--return-type', returnTypeFilter);
    if (throwsFilter) searchArgs.push('--throws', throwsFilter);
    if (readsFilter) searchArgs.push('--reads', readsFilter);
    if (writesFilter) searchArgs.push('--writes', writesFilter);
    if (mutatesFilter) searchArgs.push('--mutates', mutatesFilter);
    if (aliasFilter) searchArgs.push('--alias', aliasFilter);
    if (awaitsFilter) searchArgs.push('--awaits', awaitsFilter);
    if (riskFilter) searchArgs.push('--risk', riskFilter);
    if (riskTagFilter) searchArgs.push('--risk-tag', riskTagFilter);
    if (riskSourceFilter) searchArgs.push('--risk-source', riskSourceFilter);
    if (riskSinkFilter) searchArgs.push('--risk-sink', riskSinkFilter);
    if (riskCategoryFilter) searchArgs.push('--risk-category', riskCategoryFilter);
    if (riskFlowFilter) searchArgs.push('--risk-flow', riskFlowFilter);
    if (branchesMin !== null) searchArgs.push('--branches', String(branchesMin));
    if (loopsMin !== null) searchArgs.push('--loops', String(loopsMin));
    if (breaksMin !== null) searchArgs.push('--breaks', String(breaksMin));
    if (continuesMin !== null) searchArgs.push('--continues', String(continuesMin));
    if (churnMin !== null) searchArgs.push('--churn', String(churnMin));
    if (chunkAuthorFilter) searchArgs.push('--chunk-author', chunkAuthorFilter);
    if (modifiedAfter) searchArgs.push('--modified-after', modifiedAfter);
    if (modifiedSince !== null) searchArgs.push('--modified-since', String(modifiedSince));
    if (visibilityFilter) searchArgs.push('--visibility', visibilityFilter);
    if (extendsFilter) searchArgs.push('--extends', extendsFilter);
    if (lintFilter) searchArgs.push('--lint');
    if (asyncFilter) searchArgs.push('--async');
    if (generatorFilter) searchArgs.push('--generator');
    if (returnsFilter) searchArgs.push('--returns');
    if (branchFilter) searchArgs.push('--branch', branchFilter);
    if (langFilter) searchArgs.push('--lang', langFilter);
    if (caseAll) searchArgs.push('--case');
    if (!caseAll && caseFile) searchArgs.push('--case-file');
    if (!caseAll && caseTokens) searchArgs.push('--case-tokens');
    for (const entry of fileFilters) {
      if (entry == null || entry === '') continue;
      searchArgs.push('--path', String(entry));
    }
    for (const entry of extFilters) {
      if (entry == null || entry === '') continue;
      searchArgs.push('--ext', String(entry));
    }
    if (Array.isArray(metaFilters)) {
      metaFilters.forEach((entry) => searchArgs.push('--meta', entry));
    }
    if (metaJson) {
      const jsonValue = typeof metaJson === 'string' ? metaJson : JSON.stringify(metaJson);
      searchArgs.push('--meta-json', jsonValue);
    }

    return { ok: true, args: searchArgs, query };
  };

  const isNoIndexError = (err) => {
    if (err?.code === ERROR_CODES.NO_INDEX) return true;
    const message = String(err?.message || err || '').toLowerCase();
    if (!message) return false;
    return message.includes('index not found')
      || message.includes('missing required tables')
      || message.includes('missing sqlite index')
      || message.includes('missing lmdb index')
      || message.includes('sqlite backend requested but index not found')
      || message.includes('lmdb backend requested but index not found');
  };

  const handleRequest = async (req, res) => {
    const requestUrl = new URL(req.url || '/', `http://${host}`);
    const corsHeaders = resolveCorsHeaders(req);
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
      const searchParams = buildSearchParams(repoPath, payload || {});
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
      await sse.sendHeaders();
      await sse.sendEvent('start', { ok: true });
      const caches = getRepoCaches(repoPath);
      await refreshBuildPointer(caches);
      try {
        const body = await search(repoPath, {
          args: searchParams.args,
          query: searchParams.query,
          emitOutput: false,
          exitOnError: false,
          indexCache: caches.indexCache,
          sqliteCache: caches.sqliteCache
        });
        if (!sse.isClosed()) {
          await sse.sendEvent('result', { ok: true, repo: repoPath, result: body });
          await sse.sendEvent('done', { ok: true });
        }
      } catch (err) {
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
      const searchParams = buildSearchParams(repoPath, payload || {});
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
        const caches = getRepoCaches(repoPath);
        await refreshBuildPointer(caches);
        const body = await search(repoPath, {
          args: searchParams.args,
          query: searchParams.query,
          emitOutput: false,
          exitOnError: false,
          indexCache: caches.indexCache,
          sqliteCache: caches.sqliteCache
        });
        sendJson(res, 200, { ok: true, repo: repoPath, result: body }, corsHeaders || {});
      } catch (err) {
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
  };

  return {
    handleRequest,
    close: closeRepoCaches
  };
};
