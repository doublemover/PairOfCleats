#!/usr/bin/env node
import { guardBootstrapEntry } from '../../../src/shared/bootstrap-readiness.js';
await guardBootstrapEntry(import.meta.url);
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { resolveToolRoot } from '../../shared/dict-utils.js';
import { verifyMapViewerModuleGraph } from './module-graph.js';

const { buildCodeMap } = await import('../../../src/map/build-map.js');
const { renderIsometricHtml } = await import('../../../src/map/isometric-viewer.js');
const { createMapBenchCli, resolveMapBenchInputs, startMapViewerStaticServer } = await import('./shared.js');

const argv = createMapBenchCli({
  scriptName: 'bench-map-viewer-lod',
  options: {
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
});

const { repoRoot, indexDir, buildOptions } = resolveMapBenchInputs(argv);
const preparationStarted = performance.now();
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

const preparationMs = performance.now() - preparationStarted;
const listener = await startMapViewerStaticServer({ outPath, port: argv.port });
const { url } = listener;
const graphStarted = performance.now();
let graph;
try { graph = await verifyMapViewerModuleGraph({ url, toolRoot: resolveToolRoot() }); }
catch (error) { await listener.close(); throw error; }
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => {
  try { await listener.close(); } catch (error) { console.error(error.message); process.exitCode = 1; }
});
console.error(JSON.stringify({ kind: 'map-benchmark-readiness', schemaVersion: 1, scenario: 'lod', url,
  stages: { preparation: { state: 'completed', elapsedMs: preparationMs },
    listener: { state: listener.readiness, elapsedMs: listener.timings.listenerReadyMs },
    moduleGraph: { state: graph.status, elapsedMs: performance.now() - graphStarted, modules: graph.modules.length, bytes: graph.totalBytes },
    viewer: { state: 'not-run' } }, fps: 'not-measured' }));
console.error('Map viewer LOD stress: listener-ready and module-graph-ready. Rendered viewer/FPS qualification has not run.');
console.error(`- Open: ${url}`);
console.error('- Sweep zoom in/out and confirm LOD tier changes + draw counts in the HUD.');
