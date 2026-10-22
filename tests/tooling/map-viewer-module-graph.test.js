#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { renderIsometricHtml } from '../../src/map/isometric-viewer.js';
import { resolveToolRoot } from '../../tools/shared/dict-utils.js';
import { resolveMapViewerAsset } from '../../tools/analysis/map-viewer-assets.js';
import { startMapViewerStaticServer } from '../../tools/bench/map/shared.js';
import { verifyMapViewerModuleGraph } from '../../tools/bench/map/module-graph.js';
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-viewer-closure-'));
let listener;
try {
  const outPath = path.join(root, 'viewer.html');
  await fs.writeFile(outPath, renderIsometricHtml({ mapModel: { files: [], edges: [] }, threeUrl: '/three/three.module.js' }));
  listener = await startMapViewerStaticServer({ outPath });
  const toolRoot = resolveToolRoot();
  const graph = await verifyMapViewerModuleGraph({ url: listener.url, toolRoot });
  for (const route of ['/shared/config.js', '/shared/iterables.js', '/workspace/inspect.js']) {
    assert.ok(graph.modules.some(row => new URL(row.url).pathname === route));
    assert.ok(resolveMapViewerAsset(toolRoot, route));
  }
  assert.equal(resolveMapViewerAsset(toolRoot, '/src/shared/env/runtime.js'), null);
  assert.equal(resolveMapViewerAsset(toolRoot, '/isomap/../../package.json'), null);
  await assert.rejects(verifyMapViewerModuleGraph({ url: listener.url, toolRoot,
    fetchImpl: (url, options) => new URL(url).pathname === '/shared/config.js'
      ? Promise.resolve(new Response('removed', { status: 404 })) : fetch(url, options) }), /unavailable|MIME/);
  assert.equal((await fetch(new URL('/three/', listener.url))).status, 404);
} finally { await listener?.close(); await fs.rm(root, { recursive: true, force: true }); }
