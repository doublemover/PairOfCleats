import fs from 'node:fs';
import path from 'node:path';
import { resolveRepoRoot } from '../dict-utils.js';
import { search, status } from '../../src/integrations/core/index.js';
import { createSqliteDbCache } from '../../src/retrieval/sqlite-cache.js';
import { createSearchValidator, normalizeMetaFilters } from './validation.js';
import { sendError, sendJson } from './response.js';
import { ERROR_CODES } from '../../src/shared/error-codes.js';
import { createSseResponder } from './sse.js';

/**
 * Create an API router for the HTTP server.
 * @param {{host:string,defaultRepo:string,defaultOutput:string,metricsRegistry:any}} config
 */
export const createApiRouter = ({ host, defaultRepo, defaultOutput, metricsRegistry }) => {
  const validateSearchPayload = createSearchValidator();
  const repoCaches = new Map();

  const getRepoCaches = (repoPath) => {
    const key = repoPath || defaultRepo;
    const existing = repoCaches.get(key);
    if (existing) {
      existing.lastUsed = Date.now();
      return existing;
    }
    const entry = {
      indexCache: new Map(),
      sqliteCache: createSqliteDbCache(),
      lastUsed: Date.now()
    };
    repoCaches.set(key, entry);
    return entry;
  };

  const closeRepoCaches = () => {
    for (const entry of repoCaches.values()) {
      entry.sqliteCache?.closeAll?.();
    }
    repoCaches.clear();
  };

  /**
   * Parse a JSON request body.
   * @param {import('node:http').IncomingMessage} req
   * @returns {Promise<string>}
   */
  const parseBody = (req) => new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) {
        reject(new Error('Request body too large.'));
        req.destroy();
      }
    });
    req.on('aborted', () => reject(new Error('Request aborted.')));
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });

  /**
   * Resolve and validate a repo path.
   * @param {string|null|undefined} value
   * @returns {string}
   */
  const resolveRepo = (value) => {
    const candidate = value ? path.resolve(value) : defaultRepo;
    if (!fs.existsSync(candidate)) {
      throw new Error(`Repo path not found: ${candidate}`);
    }
    if (!fs.statSync(candidate).isDirectory()) {
      throw new Error(`Repo path is not a directory: ${candidate}`);
    }
    return value ? resolveRepoRoot(candidate) : candidate;
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
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (requestUrl.pathname === '/health' && req.method === 'GET') {
      sendJson(res, 200, { ok: true, uptimeMs: Math.round(process.uptime() * 1000) });
      return;
    }

    if (requestUrl.pathname === '/metrics' && req.method === 'GET') {
      try {
        const body = await metricsRegistry.metrics();
        res.writeHead(200, {
          'Content-Type': metricsRegistry.contentType || 'text/plain; version=0.0.4; charset=utf-8',
          'Access-Control-Allow-Origin': '*'
        });
        res.end(body);
      } catch (err) {
        sendError(res, 500, ERROR_CODES.INTERNAL, 'Failed to render metrics.', {
          error: err?.message || String(err)
        });
      }
      return;
    }

    if (requestUrl.pathname === '/status/stream' && req.method === 'GET') {
      const sse = createSseResponder(req, res);
      let repoPath = '';
      try {
        repoPath = resolveRepo(requestUrl.searchParams.get('repo'));
      } catch (err) {
        await sse.sendHeaders();
        await sse.sendEvent('error', {
          ok: false,
          code: ERROR_CODES.INVALID_REQUEST,
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
        repoPath = resolveRepo(requestUrl.searchParams.get('repo'));
      } catch (err) {
        sendError(res, 400, ERROR_CODES.INVALID_REQUEST, err?.message || 'Invalid repo path.');
        return;
      }
      try {
        const payload = await status(repoPath);
        sendJson(res, 200, { ok: true, repo: repoPath, status: payload });
      } catch (err) {
        sendError(res, 500, ERROR_CODES.INTERNAL, 'Failed to collect status.', {
          error: err?.message || String(err)
        });
      }
      return;
    }

    if (requestUrl.pathname === '/search/stream' && req.method === 'POST') {
      const sse = createSseResponder(req, res);
      let raw;
      try {
        raw = await parseBody(req);
      } catch (err) {
        sendError(res, 413, ERROR_CODES.INVALID_REQUEST, err?.message || 'Request body too large.');
        return;
      }
      let payload = null;
      try {
        payload = raw ? JSON.parse(raw) : null;
      } catch {
        sendError(res, 400, ERROR_CODES.INVALID_REQUEST, 'Invalid JSON payload.');
        return;
      }
      const validation = validateSearchPayload(payload);
      if (!validation.ok) {
        sendError(res, 400, ERROR_CODES.INVALID_REQUEST, 'Invalid search payload.', {
          errors: validation.errors
        });
        return;
      }
      let repoPath = '';
      try {
        repoPath = resolveRepo(payload?.repoPath || payload?.repo);
      } catch (err) {
        sendError(res, 400, ERROR_CODES.INVALID_REQUEST, err?.message || 'Invalid repo path.');
        return;
      }
      const searchParams = buildSearchParams(repoPath, payload || {});
      if (!searchParams.ok) {
        sendError(res, 400, ERROR_CODES.INVALID_REQUEST, searchParams.message || 'Invalid search payload.');
        return;
      }
      await sse.sendHeaders();
      await sse.sendEvent('start', { ok: true });
      const caches = getRepoCaches(repoPath);
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
      let raw;
      try {
        raw = await parseBody(req);
      } catch (err) {
        sendError(res, 413, ERROR_CODES.INVALID_REQUEST, err?.message || 'Request body too large.');
        return;
      }
      let payload = null;
      try {
        payload = raw ? JSON.parse(raw) : null;
      } catch {
        sendError(res, 400, ERROR_CODES.INVALID_REQUEST, 'Invalid JSON payload.');
        return;
      }
      const validation = validateSearchPayload(payload);
      if (!validation.ok) {
        sendError(res, 400, ERROR_CODES.INVALID_REQUEST, 'Invalid search payload.', {
          errors: validation.errors
        });
        return;
      }
      let repoPath = '';
      try {
        repoPath = resolveRepo(payload?.repoPath || payload?.repo);
      } catch (err) {
        sendError(res, 400, ERROR_CODES.INVALID_REQUEST, err?.message || 'Invalid repo path.');
        return;
      }
      const searchParams = buildSearchParams(repoPath, payload || {});
      if (!searchParams.ok) {
        sendError(res, 400, ERROR_CODES.INVALID_REQUEST, searchParams.message || 'Invalid search payload.');
        return;
      }
      try {
        const caches = getRepoCaches(repoPath);
        const body = await search(repoPath, {
          args: searchParams.args,
          query: searchParams.query,
          emitOutput: false,
          exitOnError: false,
          indexCache: caches.indexCache,
          sqliteCache: caches.sqliteCache
        });
        sendJson(res, 200, { ok: true, repo: repoPath, result: body });
      } catch (err) {
        if (isNoIndexError(err)) {
          sendError(res, 409, ERROR_CODES.NO_INDEX, err?.message || 'Index not found.', {
            error: err?.message || String(err)
          });
          return;
        }
        sendError(res, 500, ERROR_CODES.INTERNAL, 'Search failed.', { error: err?.message || String(err) });
      }
      return;
    }

    sendError(res, 404, ERROR_CODES.NOT_FOUND, 'Not found.');
  };

  return {
    handleRequest,
    close: closeRepoCaches
  };
};
