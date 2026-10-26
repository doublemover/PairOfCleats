import http from 'node:http';
import path from 'node:path';

import { createCli } from '../../../src/shared/cli.js';
import { getIndexDir, resolveRepoConfig, resolveToolRoot } from '../../shared/dict-utils.js';
import { decodePathnameSafe, safeJoinUnderBase } from '../../analysis/map-iso-safe-join.js';
import { resolveMapViewerAsset } from '../../analysis/map-viewer-assets.js';
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

export const resolveRuns = (value, fallback = 3) => {
  const runs = value == null ? fallback : Number(value);
  if (!Number.isSafeInteger(runs) || runs < 1) throw new RangeError('Map benchmark runs must be a positive safe integer.');
  return runs;
};

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
    const targetPath = resolveMapViewerAsset(toolRoot, pathname);
    if (targetPath) {
      serveMapIsoStaticFileOr404(res, targetPath, 'viewer asset not found');
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
    close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
    readiness: 'listener-ready',
    url: `http://127.0.0.1:${actualPort}/${htmlName}`
  };
};

