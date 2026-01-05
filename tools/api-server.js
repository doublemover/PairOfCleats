#!/usr/bin/env node
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createCli } from '../src/shared/cli.js';
import { resolveRepoRoot } from './dict-utils.js';
import { search, status } from '../src/integrations/core/index.js';
import { createSqliteDbCache } from '../src/retrieval/sqlite-cache.js';

const argv = createCli({
  scriptName: 'api-server',
  options: {
    host: { type: 'string', default: '127.0.0.1' },
    port: { type: 'string', default: '7345' },
    output: { type: 'string', default: 'compact' },
    json: { type: 'boolean', default: false },
    quiet: { type: 'boolean', default: false },
    repo: { type: 'string' }
  }
}).parse();

const host = argv.host || '127.0.0.1';
const port = Number.isFinite(Number(argv.port)) ? Number(argv.port) : 7345;
const defaultRepo = argv.repo ? path.resolve(argv.repo) : resolveRepoRoot(process.cwd());
const jsonOutput = argv.json === true;
const quiet = argv.quiet === true;

const log = (message) => {
  if (quiet) return;
  if (jsonOutput) console.error(message);
  else console.log(message);
};

/**
 * Normalize meta filters into CLI-friendly key/value strings.
 * @param {any} meta
 * @returns {string[]|null}
 */
const normalizeMetaFilters = (meta) => {
  if (!meta) return null;
  if (Array.isArray(meta)) {
    const entries = meta.flatMap((entry) => {
      if (entry == null) return [];
      if (typeof entry === 'string') return [entry];
      if (typeof entry === 'object') {
        return Object.entries(entry).map(([key, value]) =>
          value == null || value === '' ? String(key) : `${key}=${value}`
        );
      }
      return [String(entry)];
    });
    return entries.length ? entries : null;
  }
  if (typeof meta === 'object') {
    const entries = Object.entries(meta).map(([key, value]) =>
      value == null || value === '' ? String(key) : `${key}=${value}`
    );
    return entries.length ? entries : null;
  }
  return [String(meta)];
};

/**
 * Write a JSON payload to the HTTP response.
 * @param {import('node:http').ServerResponse} res
 * @param {number} statusCode
 * @param {any} payload
 */
const sendJson = (res, statusCode, payload) => {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*'
  });
  res.end(body);
};

/**
 * Write SSE headers for streaming responses.
 * @param {import('node:http').ServerResponse} res
 */
const sendSseHeaders = (res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  });
  res.write('\n');
};

/**
 * Send a Server-Sent Event payload.
 * @param {import('node:http').ServerResponse} res
 * @param {string} event
 * @param {any} payload
 */
const sendSseEvent = (res, event, payload) => {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
};

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
 * Write an error payload to the HTTP response.
 * @param {import('node:http').ServerResponse} res
 * @param {number} statusCode
 * @param {string} message
 * @param {object} [details]
 */
const sendError = (res, statusCode, message, details = {}) => {
  sendJson(res, statusCode, { ok: false, message, ...details });
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
  const output = payload?.output || argv.output;
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

const server = http.createServer(async (req, res) => {
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

  if (requestUrl.pathname === '/status/stream' && req.method === 'GET') {
    let repoPath = '';
    try {
      repoPath = resolveRepo(requestUrl.searchParams.get('repo'));
    } catch (err) {
      sendSseHeaders(res);
      sendSseEvent(res, 'error', { ok: false, message: err?.message || 'Invalid repo path.' });
      sendSseEvent(res, 'done', { ok: false });
      res.end();
      return;
    }
    sendSseHeaders(res);
    sendSseEvent(res, 'start', { ok: true, repo: repoPath });
    try {
      const payload = await status(repoPath);
      sendSseEvent(res, 'result', { ok: true, repo: repoPath, status: payload });
      sendSseEvent(res, 'done', { ok: true });
    } catch (err) {
      sendSseEvent(res, 'error', {
        ok: false,
        message: err?.message || 'Failed to collect status.'
      });
      sendSseEvent(res, 'done', { ok: false });
    }
    res.end();
    return;
  }

  if (requestUrl.pathname === '/status' && req.method === 'GET') {
    let repoPath = '';
    try {
      repoPath = resolveRepo(requestUrl.searchParams.get('repo'));
    } catch (err) {
      sendError(res, 400, err?.message || 'Invalid repo path.');
      return;
    }
    try {
      const payload = await status(repoPath);
      sendJson(res, 200, { ok: true, repo: repoPath, status: payload });
    } catch (err) {
      sendError(res, 500, 'Failed to collect status.', { error: err?.message || String(err) });
    }
    return;
  }

  if (requestUrl.pathname === '/search/stream' && req.method === 'POST') {
    sendSseHeaders(res);
    sendSseEvent(res, 'start', { ok: true });
    let raw;
    try {
      raw = await parseBody(req);
    } catch (err) {
      sendSseEvent(res, 'error', { ok: false, message: err?.message || 'Request body too large.' });
      sendSseEvent(res, 'done', { ok: false });
      res.end();
      return;
    }
    let payload = null;
    try {
      payload = raw ? JSON.parse(raw) : null;
    } catch {
      sendSseEvent(res, 'error', { ok: false, message: 'Invalid JSON payload.' });
      sendSseEvent(res, 'done', { ok: false });
      res.end();
      return;
    }
    let repoPath = '';
    try {
      repoPath = resolveRepo(payload?.repoPath || payload?.repo);
    } catch (err) {
      sendSseEvent(res, 'error', { ok: false, message: err?.message || 'Invalid repo path.' });
      sendSseEvent(res, 'done', { ok: false });
      res.end();
      return;
    }
    const searchParams = buildSearchParams(repoPath, payload || {});
    if (!searchParams.ok) {
      sendSseEvent(res, 'error', { ok: false, message: searchParams.message || 'Invalid search payload.' });
      sendSseEvent(res, 'done', { ok: false });
      res.end();
      return;
    }
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
      sendSseEvent(res, 'result', { ok: true, repo: repoPath, result: body });
      sendSseEvent(res, 'done', { ok: true });
    } catch (err) {
      sendSseEvent(res, 'error', {
        ok: false,
        message: err?.message || 'Search failed.'
      });
      sendSseEvent(res, 'done', { ok: false });
    }
    res.end();
    return;
  }

  if (requestUrl.pathname === '/search' && req.method === 'POST') {
    let raw;
    try {
      raw = await parseBody(req);
    } catch (err) {
      sendError(res, 413, err?.message || 'Request body too large.');
      return;
    }
    let payload = null;
    try {
      payload = raw ? JSON.parse(raw) : null;
    } catch {
      sendError(res, 400, 'Invalid JSON payload.');
      return;
    }
    let repoPath = '';
    try {
      repoPath = resolveRepo(payload?.repoPath || payload?.repo);
    } catch (err) {
      sendError(res, 400, err?.message || 'Invalid repo path.');
      return;
    }
    const searchParams = buildSearchParams(repoPath, payload || {});
    if (!searchParams.ok) {
      sendError(res, 400, searchParams.message || 'Invalid search payload.');
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
      sendError(res, 500, 'Search failed.', { error: err?.message || String(err) });
    }
    return;
  }

  sendError(res, 404, 'Not found.');
});

server.listen({ port, host }, () => {
  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;
  const baseUrl = `http://${host}:${actualPort}`;
  if (jsonOutput) {
    console.log(JSON.stringify({ ok: true, host, port: actualPort, repo: defaultRepo, baseUrl }));
  } else {
    log(`[api] listening at ${baseUrl}`);
    log(`[api] repo root: ${defaultRepo}`);
  }
});

const shutdown = (signal) => {
  log(`[api] ${signal} received; shutting down...`);
  server.close(() => {
    closeRepoCaches();
    log('[api] shutdown complete.');
    process.exit(0);
  });
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
