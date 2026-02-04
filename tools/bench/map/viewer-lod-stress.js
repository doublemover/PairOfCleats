#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { createCli } from '../../src/shared/cli.js';
import { buildCodeMap } from '../../src/map/build-map.js';
import { renderIsometricHtml } from '../../src/map/isometric-viewer.js';
import { getIndexDir, resolveRepoConfig, resolveToolRoot } from '../shared/dict-utils.js';

const argv = createCli({
  scriptName: 'bench-map-viewer-lod',
  options: {
    repo: { type: 'string', describe: 'Repo root.' },
    mode: { type: 'string', default: 'code' },
    'index-root': { type: 'string' },
    scope: { type: 'string', default: 'repo' },
    focus: { type: 'string' },
    include: { type: 'string' },
    'only-exported': { type: 'boolean', default: false },
    collapse: { type: 'string', default: 'none' },
    'max-files': { type: 'number' },
    'max-members-per-file': { type: 'number' },
    'max-edges': { type: 'number' },
    'top-k-by-degree': { type: 'boolean', default: false },
    port: { type: 'number', default: 0 },
    out: { type: 'string' },
    'display-files': { type: 'number', default: 300 },
    'display-members': { type: 'number', default: 120 },
    'display-edges': { type: 'number', default: 16000 },
    'draw-files': { type: 'number', default: 600 },
    'draw-members': { type: 'number', default: 16000 },
    'draw-edges': { type: 'number', default: 12000 },
    'draw-labels': { type: 'number', default: 2500 },
    'lod-zoom-high': { type: 'number', default: 14 },
    'lod-zoom-low': { type: 'number', default: 5 },
    'lod-edge-high': { type: 'number', default: 8000 },
    'lod-edge-low': { type: 'number', default: 2000 },
    'frame-budget': { type: 'number', default: 16 }
  }
}).parse();

const resolveLimit = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
};

const { repoRoot, userConfig } = resolveRepoConfig(argv.repo);
const mode = String(argv.mode || 'code').toLowerCase();
const indexDir = getIndexDir(repoRoot, mode, userConfig, {
  indexRoot: argv['index-root'] ? path.resolve(argv['index-root']) : null
});

const buildOptions = {
  mode,
  scope: argv.scope,
  focus: argv.focus || null,
  include: argv.include,
  onlyExported: argv['only-exported'] === true,
  collapse: argv.collapse,
  maxFiles: resolveLimit(argv['max-files']),
  maxMembersPerFile: resolveLimit(argv['max-members-per-file']),
  maxEdges: resolveLimit(argv['max-edges']),
  topKByDegree: argv['top-k-by-degree'] === true
};

const mapModel = await buildCodeMap({ repoRoot, indexDir, options: buildOptions });

const viewerConfig = {
  performance: {
    hud: { enabled: true },
    frameBudgetMs: Math.max(8, Number(argv['frame-budget']) || 16),
    displayLimits: {
      maxFiles: Math.max(1, Number(argv['display-files']) || 300),
      maxMembersPerFile: Math.max(1, Number(argv['display-members']) || 120),
      maxEdges: Math.max(1, Number(argv['display-edges']) || 16000)
    },
    drawCaps: {
      files: Math.max(1, Number(argv['draw-files']) || 600),
      members: Math.max(1, Number(argv['draw-members']) || 16000),
      edges: Math.max(1, Number(argv['draw-edges']) || 12000),
      labels: Math.max(1, Number(argv['draw-labels']) || 2500)
    },
    lod: {
      zoomHigh: Math.max(1, Number(argv['lod-zoom-high']) || 14),
      zoomLow: Math.max(1, Number(argv['lod-zoom-low']) || 5),
      edgeCountHigh: Math.max(1, Number(argv['lod-edge-high']) || 8000),
      edgeCountLow: Math.max(1, Number(argv['lod-edge-low']) || 2000)
    }
  }
};

const html = renderIsometricHtml({
  mapModel,
  threeUrl: '/three/three.module.js',
  viewerConfig
});

const outPath = argv.out
  ? path.resolve(argv.out)
  : path.join(repoRoot, '.pairofcleats', 'maps', 'bench-lod.html');

await fsPromises.mkdir(path.dirname(outPath), { recursive: true });
await fsPromises.writeFile(outPath, html);

const toolRoot = resolveToolRoot();
const threeRoot = path.join(toolRoot, 'node_modules', 'three');
const threeBuildRoot = path.join(threeRoot, 'build');
const threeExamplesRoot = path.join(threeRoot, 'examples');
const isomapAssetsRoot = path.join(toolRoot, 'assets', 'isomap');
const isomapClientRoot = path.join(toolRoot, 'src', 'map', 'isometric', 'client');
const htmlName = path.basename(outPath);

const contentTypeFor = (filePath) => {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.js') return 'application/javascript; charset=utf-8';
  if (ext === '.json') return 'application/json; charset=utf-8';
  if (ext === '.map') return 'application/json; charset=utf-8';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.png') return 'image/png';
  if (ext === '.hdr') return 'application/octet-stream';
  return 'application/octet-stream';
};

const safeJoin = (baseDir, requestPath) => {
  const safePath = path.normalize(path.join(baseDir, requestPath));
  if (!safePath.startsWith(baseDir)) return null;
  return safePath;
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://localhost');
  const pathname = decodeURIComponent(url.pathname || '/');
  if (pathname === '/' || pathname === `/${htmlName}`) {
    if (!fs.existsSync(outPath)) {
      res.writeHead(404);
      res.end('bench html not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentTypeFor(outPath) });
    fs.createReadStream(outPath).pipe(res);
    return;
  }
  if (pathname.startsWith('/three/examples/')) {
    const relativePath = pathname.replace('/three/examples/', '');
    const targetPath = safeJoin(threeExamplesRoot, relativePath);
    if (!targetPath || !fs.existsSync(targetPath)) {
      res.writeHead(404);
      res.end('three.js example asset not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentTypeFor(targetPath) });
    fs.createReadStream(targetPath).pipe(res);
    return;
  }
  if (pathname.startsWith('/three/')) {
    const relativePath = pathname.replace('/three/', '');
    const targetPath = safeJoin(threeBuildRoot, relativePath);
    if (!targetPath || !fs.existsSync(targetPath)) {
      res.writeHead(404);
      res.end('three.js asset not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentTypeFor(targetPath) });
    fs.createReadStream(targetPath).pipe(res);
    return;
  }
  if (pathname.startsWith('/assets/isomap/')) {
    const relativePath = pathname.replace('/assets/isomap/', '');
    const targetPath = safeJoin(isomapAssetsRoot, relativePath);
    if (!targetPath || !fs.existsSync(targetPath)) {
      res.writeHead(404);
      res.end('isomap asset not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentTypeFor(targetPath) });
    fs.createReadStream(targetPath).pipe(res);
    return;
  }
  if (pathname.startsWith('/isomap/')) {
    const relativePath = pathname.replace('/isomap/', '');
    const targetPath = safeJoin(isomapClientRoot, relativePath);
    if (!targetPath || !fs.existsSync(targetPath)) {
      res.writeHead(404);
      res.end('isomap client asset not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentTypeFor(targetPath) });
    fs.createReadStream(targetPath).pipe(res);
    return;
  }
  res.writeHead(404);
  res.end('Not found');
});

const port = Number.isFinite(Number(argv.port)) ? Number(argv.port) : 0;
server.listen(port, '127.0.0.1', () => {
  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;
  const url = `http://127.0.0.1:${actualPort}/${htmlName}`;
  console.error('Map viewer LOD stress benchmark ready.');
  console.error(`- Open: ${url}`);
  console.error('- Sweep zoom in/out and confirm LOD tier changes + draw counts in the HUD.');
});
