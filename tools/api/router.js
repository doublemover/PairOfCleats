import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  getCurrentBuildInfo,
  getIndexDir,
  getRepoId,
  loadUserConfig,
  resolveRepoRoot
} from '../dict-utils.js';
import { resolveRepoRoot } from '../dict-utils.js';
import { search, status } from '../../src/integrations/core/index.js';
import { createSqliteDbCache } from '../../src/retrieval/sqlite-cache.js';
import { createSearchValidator, normalizeMetaFilters } from './validation.js';
import { sendError, sendFile, sendJson, sendText } from './response.js';
import { ERROR_CODES, createError } from '../../src/shared/error-codes.js';
import { createSseResponder } from './sse.js';
import { buildCodeMap, buildMapCacheKey, buildNodeList } from '../../src/map/build-map.js';
import { renderDot } from '../../src/map/dot-writer.js';
import { renderSvgHtml } from '../../src/map/html-writer.js';
import { renderIsometricHtml } from '../../src/map/isometric-viewer.js';

const toolRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const isomapAssetsRoot = path.join(toolRoot, 'assets', 'isomap');
const isomapClientRoot = path.join(toolRoot, 'src', 'map', 'isometric', 'client');
const threeRoot = path.join(toolRoot, 'node_modules', 'three');
const threeBuildRoot = path.join(threeRoot, 'build');
const threeExamplesRoot = path.join(threeRoot, 'examples');

const contentTypeFor = (filePath) => {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.js') return 'application/javascript; charset=utf-8';
  if (ext === '.css') return 'text/css; charset=utf-8';
  if (ext === '.json') return 'application/json; charset=utf-8';
  if (ext === '.map') return 'application/json; charset=utf-8';
  if (ext === '.svg') return 'image/svg+xml; charset=utf-8';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.png') return 'image/png';
  if (ext === '.hdr') return 'application/octet-stream';
  return 'application/octet-stream';
};

const safeJoin = (baseDir, requestPath) => {
  const normalizedBase = path.resolve(baseDir);
  const targetPath = path.resolve(normalizedBase, requestPath);
  const relative = path.relative(normalizedBase, targetPath);
  if (!relative) return targetPath;
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return targetPath;
};

const parseBool = (raw) => {
  if (raw == null) return null;
  const value = String(raw).trim().toLowerCase();
  if (!value) return true;
  if (value === '1' || value === 'true' || value === 'yes' || value === 'on') return true;
  if (value === '0' || value === 'false' || value === 'no' || value === 'off') return false;
  return null;
};

const parseNumber = (raw) => {
  if (raw == null) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
};

const existsArtifact = (filePath) => (
  fs.existsSync(filePath)
  || fs.existsSync(`${filePath}.gz`)
  || fs.existsSync(`${filePath}.bak`)
  || fs.existsSync(`${filePath}.gz.bak`)
);

const hasMapIndexArtifacts = (indexDir) => {
  if (!indexDir) return false;
  try {
    if (!fs.existsSync(indexDir)) return false;
    if (!fs.statSync(indexDir).isDirectory()) return false;
  } catch {
    return false;
  }

  const candidates = [
    path.join(indexDir, 'repo_map.json'),
    path.join(indexDir, 'file_relations.json'),
    path.join(indexDir, 'graph_relations.json'),
    path.join(indexDir, 'chunk_meta.json'),
    path.join(indexDir, 'chunk_meta.jsonl'),
    path.join(indexDir, 'chunk_meta.meta.json')
  ];

  if (fs.existsSync(path.join(indexDir, 'chunk_meta.parts'))) return true;
  return candidates.some((candidate) => existsArtifact(candidate));
};

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
      mapCache: new Map(),
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

  const resolveMapFormat = (raw) => {
    const format = String(raw || 'json').trim().toLowerCase();
    if (format === 'iso') return 'html-iso';
    if (format === 'html-iso' || format === 'html' || format === 'svg' || format === 'dot' || format === 'json') {
      return format;
    }
    return 'json';
  };

  const parseMapOptions = (params) => {
    const scope = String(params.get('scope') || 'repo').trim().toLowerCase() || 'repo';
    const mode = String(params.get('mode') || 'code').trim().toLowerCase() || 'code';
    const focus = String(params.get('focus') || '').trim();
    const include = params.get('include') ? String(params.get('include')) : null;
    const collapse = String(params.get('collapse') || 'none').trim().toLowerCase() || 'none';
    const onlyExported = parseBool(params.get('onlyExported') ?? params.get('only-exported')) === true;
    const maxFiles = parseNumber(params.get('maxFiles') ?? params.get('max-files'));
    const maxMembersPerFile = parseNumber(params.get('maxMembersPerFile') ?? params.get('max-members-per-file'));
    const maxEdges = parseNumber(params.get('maxEdges') ?? params.get('max-edges'));
    const topKByDegree = parseBool(params.get('topKByDegree') ?? params.get('top-k-by-degree')) === true;
    const openUriTemplate = params.get('openUriTemplate') ?? params.get('open-uri-template');
    const threeUrl = params.get('threeUrl') ?? params.get('three-url');

    const wasdSensitivity = parseNumber(params.get('wasdSensitivity') ?? params.get('wasd-sensitivity'));
    const wasdAcceleration = parseNumber(params.get('wasdAcceleration') ?? params.get('wasd-acceleration'));
    const wasdMaxSpeed = parseNumber(params.get('wasdMaxSpeed') ?? params.get('wasd-max-speed'));
    const wasdDrag = parseNumber(params.get('wasdDrag') ?? params.get('wasd-drag'));
    const zoomSensitivity = parseNumber(params.get('zoomSensitivity') ?? params.get('zoom-sensitivity'));

    const controls = {
      wasd: {
        ...(wasdSensitivity != null ? { sensitivity: wasdSensitivity } : {}),
        ...(wasdAcceleration != null ? { acceleration: wasdAcceleration } : {}),
        ...(wasdMaxSpeed != null ? { maxSpeed: wasdMaxSpeed } : {}),
        ...(wasdDrag != null ? { drag: wasdDrag } : {})
      },
      ...(zoomSensitivity != null ? { zoomSensitivity } : {})
    };

    return {
      mode,
      scope,
      focus,
      include,
      onlyExported,
      collapse,
      ...(maxFiles != null ? { maxFiles } : {}),
      ...(maxMembersPerFile != null ? { maxMembersPerFile } : {}),
      ...(maxEdges != null ? { maxEdges } : {}),
      ...(topKByDegree ? { topKByDegree } : {}),
      viewer: {
        ...(openUriTemplate ? { openUriTemplate: String(openUriTemplate) } : {}),
        controls
      },
      _meta: {
        ...(threeUrl ? { threeUrl: String(threeUrl) } : {})
      }
    };
  };

  const resolveMapArtifacts = ({ repoPath, params }) => {
    const refresh = parseBool(params.get('refresh')) === true;
    const options = parseMapOptions(params);
    const mode = options.mode || 'code';
    const userConfig = loadUserConfig(repoPath);
    const indexRoot = params.get('indexRoot') ?? params.get('index-root');
    const indexDir = getIndexDir(repoPath, mode, userConfig, {
      ...(indexRoot ? { indexRoot: path.resolve(String(indexRoot)) } : {})
    });

    if (!hasMapIndexArtifacts(indexDir)) {
      throw createError(
        ERROR_CODES.NO_INDEX,
        `Index not found for map endpoint. Run \"pairofcleats index build\" first. (indexDir: ${indexDir})`,
        { indexDir }
      );
    }

    const buildInfo = getCurrentBuildInfo(repoPath, userConfig, { mode });
    const cacheKey = buildMapCacheKey({ buildId: buildInfo?.buildId || null, options });

    const caches = getRepoCaches(repoPath);
    const existing = caches.mapCache.get(cacheKey);
    if (existing && !refresh) {
      return {
        cacheKey,
        options,
        indexDir,
        buildId: buildInfo?.buildId || null,
        mapModel: existing.mapModel,
        nodeList: existing.nodeList
      };
    }

    const mapModel = buildCodeMap({ repoRoot: repoPath, indexDir, options });
    mapModel.root = mapModel.root || { path: repoPath, id: null };
    mapModel.root.path = repoPath;
    mapModel.root.id = mapModel.root.id || getRepoId(repoPath);
    const nodeList = buildNodeList(mapModel);
    caches.mapCache.set(cacheKey, {
      mapModel,
      nodeList,
      rendered: new Map(),
      createdAt: Date.now()
    });

    return { cacheKey, options, indexDir, buildId: buildInfo?.buildId || null, mapModel, nodeList };
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

    const pathname = decodeURIComponent(requestUrl.pathname || '/');

    if (req.method === 'GET') {
      if (pathname.startsWith('/three/examples/')) {
        const relativePath = pathname.replace('/three/examples/', '');
        const targetPath = safeJoin(threeExamplesRoot, relativePath);
        if (!targetPath || !fs.existsSync(targetPath)) {
          sendText(res, 404, 'three.js example asset not found.');
          return;
        }
        sendFile(res, targetPath, {
          contentType: contentTypeFor(targetPath),
          headers: { 'Cache-Control': 'public, max-age=3600' }
        });
        return;
      }

      if (pathname.startsWith('/three/')) {
        const relativePath = pathname.replace('/three/', '');
        const targetPath = safeJoin(threeBuildRoot, relativePath);
        if (!targetPath || !fs.existsSync(targetPath)) {
          sendText(res, 404, 'three.js asset not found.');
          return;
        }
        sendFile(res, targetPath, {
          contentType: contentTypeFor(targetPath),
          headers: { 'Cache-Control': 'public, max-age=3600' }
        });
        return;
      }

      if (pathname.startsWith('/assets/isomap/')) {
        const relativePath = pathname.replace('/assets/isomap/', '');
        const targetPath = safeJoin(isomapAssetsRoot, relativePath);
        if (!targetPath || !fs.existsSync(targetPath)) {
          sendText(res, 404, 'isomap asset not found.');
          return;
        }
        sendFile(res, targetPath, {
          contentType: contentTypeFor(targetPath),
          headers: { 'Cache-Control': 'public, max-age=3600' }
        });
        return;
      }

      if (pathname.startsWith('/isomap/')) {
        const relativePath = pathname.replace('/isomap/', '');
        const targetPath = safeJoin(isomapClientRoot, relativePath);
        if (!targetPath || !fs.existsSync(targetPath)) {
          sendText(res, 404, 'isomap client asset not found.');
          return;
        }
        sendFile(res, targetPath, {
          contentType: contentTypeFor(targetPath),
          headers: { 'Cache-Control': 'public, max-age=3600' }
        });
        return;
      }
    }

    if (pathname === '/health' && req.method === 'GET') {
      sendJson(res, 200, { ok: true, uptimeMs: Math.round(process.uptime() * 1000) });
      return;
    }

    if (pathname === '/metrics' && req.method === 'GET') {
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

    if (pathname === '/map' && req.method === 'GET') {
      let repoPath = '';
      try {
        repoPath = resolveRepo(requestUrl.searchParams.get('repoPath') ?? requestUrl.searchParams.get('repo'));
      } catch (err) {
        sendError(res, 400, ERROR_CODES.INVALID_REQUEST, err?.message || 'Invalid repo path.');
        return;
      }

      const requestedFormat = resolveMapFormat(requestUrl.searchParams.get('format'));
      let artifacts;
      try {
        artifacts = resolveMapArtifacts({ repoPath, params: requestUrl.searchParams });
      } catch (err) {
        if (isNoIndexError(err)) {
          sendError(res, 409, ERROR_CODES.NO_INDEX, err?.message || 'Index not found.', {
            error: err?.message || String(err)
          });
          return;
        }
        sendError(res, 500, ERROR_CODES.INTERNAL, 'Failed to build map.', {
          error: err?.message || String(err)
        });
        return;
      }

      const headers = {
        'X-PairofCleats-Map-CacheKey': artifacts.cacheKey,
        'X-PairofCleats-Repo': repoPath
      };

      const renderSvg = (dot) => {
        try {
          const result = spawnSync('dot', ['-Tsvg'], { input: dot, encoding: 'utf8' });
          if (result.status !== 0) {
            const message = result.stderr || result.stdout || 'Graphviz dot failed.';
            return { ok: false, message: message.trim() };
          }
          return { ok: true, svg: result.stdout };
        } catch (err) {
          return { ok: false, message: err?.message || String(err) };
        }
      };

      const getCached = (key) => {
        const entry = getRepoCaches(repoPath).mapCache.get(artifacts.cacheKey);
        return entry?.rendered?.get(key) || null;
      };
      const setCached = (key, value) => {
        const entry = getRepoCaches(repoPath).mapCache.get(artifacts.cacheKey);
        if (!entry) return;
        entry.rendered = entry.rendered || new Map();
        entry.rendered.set(key, value);
      };

      let actualFormat = requestedFormat;
      if (requestedFormat === 'json') {
        const body = JSON.stringify(artifacts.mapModel);
        sendText(res, 200, body, {
          ...headers,
          'X-PairofCleats-Map-Format': actualFormat,
          'Content-Type': 'application/json; charset=utf-8'
        });
        return;
      }

      if (requestedFormat === 'dot') {
        const cached = getCached('dot');
        const dot = cached || renderDot(artifacts.mapModel);
        if (!cached) setCached('dot', dot);
        sendText(res, 200, dot, {
          ...headers,
          'X-PairofCleats-Map-Format': actualFormat,
          'Content-Type': 'text/vnd.graphviz; charset=utf-8'
        });
        return;
      }

      if (requestedFormat === 'svg' || requestedFormat === 'html') {
        const cachedDot = getCached('dot');
        const dot = cachedDot || renderDot(artifacts.mapModel);
        if (!cachedDot) setCached('dot', dot);
        const svgResult = renderSvg(dot);
        if (!svgResult.ok || !svgResult.svg) {
          actualFormat = 'dot';
          headers['X-PairofCleats-Map-Warning'] = svgResult.message || 'Graphviz unavailable.';
          sendText(res, 200, dot, {
            ...headers,
            'X-PairofCleats-Map-Format': actualFormat,
            'Content-Type': 'text/vnd.graphviz; charset=utf-8'
          });
          return;
        }
        const svg = svgResult.svg;
        setCached('svg', svg);
        if (requestedFormat === 'svg') {
          sendText(res, 200, svg, {
            ...headers,
            'X-PairofCleats-Map-Format': actualFormat,
            'Content-Type': 'image/svg+xml; charset=utf-8'
          });
          return;
        }
        const cachedHtml = getCached('html');
        const html = cachedHtml || renderSvgHtml({ svg, mapModel: artifacts.mapModel, title: 'Code Map' });
        if (!cachedHtml) setCached('html', html);
        sendText(res, 200, html, {
          ...headers,
          'X-PairofCleats-Map-Format': actualFormat,
          'Content-Type': 'text/html; charset=utf-8'
        });
        return;
      }

      if (requestedFormat === 'html-iso') {
        const cachedIso = getCached('html-iso');
        const threeUrl = artifacts.options?._meta?.threeUrl || '/three/three.module.js';
        const openUriTemplate = artifacts.options?.viewer?.openUriTemplate
          || artifacts.mapModel.viewer?.openUriTemplate
          || '';
        const htmlIso = cachedIso || renderIsometricHtml({
          mapModel: artifacts.mapModel,
          threeUrl,
          openUriTemplate,
          viewerConfig: artifacts.mapModel.viewer || {}
        });
        if (!cachedIso) setCached('html-iso', htmlIso);
        sendText(res, 200, htmlIso, {
          ...headers,
          'X-PairofCleats-Map-Format': actualFormat,
          'Content-Type': 'text/html; charset=utf-8'
        });
        return;
      }

      const body = JSON.stringify(artifacts.mapModel);
      sendText(res, 200, body, {
        ...headers,
        'X-PairofCleats-Map-Format': actualFormat,
        'Content-Type': 'application/json; charset=utf-8'
      });
      return;
    }

    if (pathname === '/map/nodes' && req.method === 'GET') {
      let repoPath = '';
      try {
        repoPath = resolveRepo(requestUrl.searchParams.get('repoPath') ?? requestUrl.searchParams.get('repo'));
      } catch (err) {
        sendError(res, 400, ERROR_CODES.INVALID_REQUEST, err?.message || 'Invalid repo path.');
        return;
      }

      let artifacts;
      try {
        artifacts = resolveMapArtifacts({ repoPath, params: requestUrl.searchParams });
      } catch (err) {
        if (isNoIndexError(err)) {
          sendError(res, 409, ERROR_CODES.NO_INDEX, err?.message || 'Index not found.', {
            error: err?.message || String(err)
          });
          return;
        }
        sendError(res, 500, ERROR_CODES.INTERNAL, 'Failed to build map nodes.', {
          error: err?.message || String(err)
        });
        return;
      }

      const filterRaw = requestUrl.searchParams.get('filter');
      const filter = filterRaw ? String(filterRaw).toLowerCase() : '';
      const limit = parseNumber(requestUrl.searchParams.get('limit'));
      const nodesPayload = {
        generatedAt: artifacts.nodeList?.generatedAt || null,
        root: artifacts.nodeList?.root || repoPath,
        nodes: Array.isArray(artifacts.nodeList?.nodes) ? artifacts.nodeList.nodes : []
      };

      let filtered = nodesPayload.nodes;
      if (filter) {
        filtered = filtered.filter((node) => {
          const id = String(node?.id || '').toLowerCase();
          const label = String(node?.label || '').toLowerCase();
          const file = String(node?.file || '').toLowerCase();
          return id.includes(filter) || label.includes(filter) || file.includes(filter);
        });
      }
      if (limit != null && limit > 0) {
        filtered = filtered.slice(0, limit);
      }
      const body = JSON.stringify({ ...nodesPayload, nodes: filtered });
      sendText(res, 200, body, {
        'Content-Type': 'application/json; charset=utf-8',
        'X-PairofCleats-Repo': repoPath,
        'X-PairofCleats-Map-CacheKey': artifacts.cacheKey
      });
      return;
    }

    if (pathname === '/status/stream' && req.method === 'GET') {
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

    if (pathname === '/status' && req.method === 'GET') {
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

    if (pathname === '/search/stream' && req.method === 'POST') {
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

    if (pathname === '/search' && req.method === 'POST') {
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
