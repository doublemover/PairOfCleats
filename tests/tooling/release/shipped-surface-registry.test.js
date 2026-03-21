#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadShippedSurfaces, getReleaseCheckSurfaceSteps } from '../../../tools/release/surfaces.js';

const root = process.cwd();
const registry = loadShippedSurfaces(root);

assert.equal(registry.schemaVersion, '1.0.0');
assert.ok(fs.existsSync(registry.registryPath), 'expected shipped surface registry file');

const surfaceIds = registry.surfaces.map((surface) => surface.id);
assert.deepEqual(
  surfaceIds,
  ['cli', 'api', 'mcp', 'indexer-service', 'vscode', 'sublime', 'tui']
);

for (const surface of registry.surfaces) {
  assert.ok(surface.name, `expected surface name for ${surface.id}`);
  assert.ok(surface.owner, `expected owner for ${surface.id}`);
  assert.ok(surface.packagingBoundary, `expected packaging boundary for ${surface.id}`);
  assert.ok(surface.publishBoundary, `expected publish boundary for ${surface.id}`);
  assert.ok(surface.versionSource, `expected version source for ${surface.id}`);
  assert.ok(surface.install.summary, `expected install summary for ${surface.id}`);
  assert.ok(surface.smoke.summary, `expected smoke summary for ${surface.id}`);
  for (const step of surface.releaseCheck.steps) {
    assert.ok(['build', 'install', 'boot', 'smoke'].includes(step.phase), `expected valid phase for ${surface.id}:${step.id}`);
  }
  for (const sourcePath of surface.build.sourcePaths) {
    assert.ok(
      fs.existsSync(path.join(root, sourcePath)),
      `expected build source path for ${surface.id}: ${sourcePath}`
    );
  }
}

const stepIds = getReleaseCheckSurfaceSteps(root).map((step) => step.id);
assert.deepEqual(
  stepIds,
  [
    'smoke.version',
    'smoke.fixture-index-build',
    'smoke.fixture-index-validate-strict',
    'smoke.fixture-search',
    'api.boot.server',
    'api.smoke.workflow',
    'mcp.boot.initialize',
    'mcp.smoke.workflow',
    'smoke.service-mode',
    'smoke.editor-vscode',
    'vscode.install.unpack',
    'smoke.editor-sublime',
    'sublime.install.unpack',
    'smoke.tui-build',
    'smoke.tui-install',
    'tui.boot.wrapper'
  ]
);

console.log('shipped surface registry test passed');
