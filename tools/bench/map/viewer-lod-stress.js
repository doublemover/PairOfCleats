#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';

import { createCli } from '../../../src/shared/cli.js';
import { buildCodeMap } from '../../../src/map/build-map.js';
import { renderIsometricHtml } from '../../../src/map/isometric-viewer.js';
import { resolveMapBenchInputs, startMapViewerStaticServer } from './shared.js';

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

const { repoRoot, indexDir, buildOptions } = resolveMapBenchInputs(argv);
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

const { url } = await startMapViewerStaticServer({ outPath, port: argv.port });
console.error('Map viewer LOD stress benchmark ready.');
console.error(`- Open: ${url}`);
console.error('- Sweep zoom in/out and confirm LOD tier changes + draw counts in the HUD.');
