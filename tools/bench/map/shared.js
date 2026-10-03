import http from 'node:http';
import path from 'node:path';

import { createCli } from '../../../src/shared/cli.js';
import { getIndexDir, resolveRepoConfig, resolveToolRoot } from '../../shared/dict-utils.js';
import { decodePathnameSafe, safeJoinUnderBase } from '../../analysis/map-iso-safe-join.js';
import { serveMapIsoStaticFileOr404 } from '../../analysis/map-iso-static.js';
import {
  MAP_BENCH_BUILD_OPTIONS,
  resolveLimit
} from '../../shared/map-build-options.js';

export { MAP_BENCH_BUILD_OPTIONS, resolveLimit };

export const createMapBenchCli = ({ scriptName, options = {} }) => createCli({
  scriptName,
  options: {
    ...MAP_BENCH_BUILD_OPTIONS,
    ...options
  }
}).parse();

export const resolveRuns = (value, fallback = 3) => (
  Number.isFinite(Number(value)) ? Math.max(1, Number(value)) : fallback
);

export const resolveMapBenchInputs = (argv) => {
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

  return {
    repoRoot,
    mode,
    indexDir,
    buildOptions
  };
};

export const resolveMapViewerPathUnderBase = (baseDir, requestPath, pathApi = path) => (
  safeJoinUnderBase(baseDir, requestPath, pathApi)
);

export const decodeMapViewerPathname = (rawPathname) => decodePathnameSafe(rawPathname);

export const startMapViewerStaticServer = async ({ outPath, port = 0 }) => {
  const toolRoot = resolveToolRoot();
  const threeRoot = path.join(toolRoot, 'node_modules', 'three');
  const threeBuildRoot = path.join(threeRoot, 'build');
  const threeExamplesRoot = path.join(threeRoot, 'examples');
  const isomapAssetsRoot = path.join(toolRoot, 'assets', 'isomap');
  const isomapClientRoot = path.join(toolRoot, 'src', 'map', 'isometric', 'client');
  const htmlName = path.basename(outPath);

  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    const pathname = decodeMapViewerPathname(url.pathname || '/');
    if (pathname == null) {
      res.writeHead(400);
      res.end('Malformed request path');
      return;
    }
    if (pathname === '/' || pathname === `/${htmlName}`) {
      serveMapIsoStaticFileOr404(res, outPath, 'bench html not found');
      return;
    }
    if (pathname.startsWith('/three/examples/')) {
      const relativePath = pathname.replace('/three/examples/', '');
      const targetPath = resolveMapViewerPathUnderBase(threeExamplesRoot, relativePath);
      if (!targetPath) {
        res.writeHead(404);
        res.end('three.js example asset not found');
        return;
      }
      serveMapIsoStaticFileOr404(res, targetPath, 'three.js example asset not found');
      return;
    }
    if (pathname.startsWith('/three/')) {
      const relativePath = pathname.replace('/three/', '');
      const targetPath = resolveMapViewerPathUnderBase(threeBuildRoot, relativePath);
      if (!targetPath) {
        res.writeHead(404);
        res.end('three.js asset not found');
        return;
      }
      serveMapIsoStaticFileOr404(res, targetPath, 'three.js asset not found');
      return;
    }
    if (pathname.startsWith('/assets/isomap/')) {
      const relativePath = pathname.replace('/assets/isomap/', '');
      const targetPath = resolveMapViewerPathUnderBase(isomapAssetsRoot, relativePath);
      if (!targetPath) {
        res.writeHead(404);
        res.end('isomap asset not found');
        return;
      }
      serveMapIsoStaticFileOr404(res, targetPath, 'isomap asset not found');
      return;
    }
    if (pathname.startsWith('/isomap/')) {
      const relativePath = pathname.replace('/isomap/', '');
      const targetPath = resolveMapViewerPathUnderBase(isomapClientRoot, relativePath);
      if (!targetPath) {
        res.writeHead(404);
        res.end('isomap client asset not found');
        return;
      }
      serveMapIsoStaticFileOr404(res, targetPath, 'isomap client asset not found');
      return;
    }
    res.writeHead(404);
    res.end('Not found');
  });

  await new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(Number.isFinite(Number(port)) ? Number(port) : 0, '127.0.0.1');
  });

  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : Number(port) || 0;

  return {
    server,
    url: `http://127.0.0.1:${actualPort}/${htmlName}`
  };
};

