#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';

import { createCli } from '../../../src/shared/cli.js';
import { buildCodeMap } from '../../../src/map/build-map.js';
import { renderIsometricHtml } from '../../../src/map/isometric-viewer.js';
import { resolveMapBenchInputs, startMapViewerStaticServer } from './shared.js';

const argv = createCli({
  scriptName: 'bench-map-viewer-fps',
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
    'display-edges': { type: 'number', default: 12000 },
    'draw-files': { type: 'number', default: 800 },
    'draw-members': { type: 'number', default: 20000 },
    'draw-edges': { type: 'number', default: 20000 },
    'draw-labels': { type: 'number', default: 4000 }
  }
}).parse();

const { repoRoot, indexDir, buildOptions } = resolveMapBenchInputs(argv);
const mapModel = await buildCodeMap({ repoRoot, indexDir, options: buildOptions });

const viewerConfig = {
  performance: {
    hud: { enabled: true },
    displayLimits: {
      maxFiles: Math.max(1, Number(argv['display-files']) || 300),
      maxMembersPerFile: Math.max(1, Number(argv['display-members']) || 120),
      maxEdges: Math.max(1, Number(argv['display-edges']) || 12000)
    },
    drawCaps: {
      files: Math.max(1, Number(argv['draw-files']) || 800),
      members: Math.max(1, Number(argv['draw-members']) || 20000),
      edges: Math.max(1, Number(argv['draw-edges']) || 20000),
      labels: Math.max(1, Number(argv['draw-labels']) || 4000)
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
  : path.join(repoRoot, '.pairofcleats', 'maps', 'bench-fps.html');
await fsPromises.mkdir(path.dirname(outPath), { recursive: true });
await fsPromises.writeFile(outPath, html);

const { url } = await startMapViewerStaticServer({ outPath, port: argv.port });
console.error('Map viewer FPS benchmark ready.');
console.error(`- Open: ${url}`);
console.error('- Let the scene settle for 10s, then record the perf HUD stats.');
