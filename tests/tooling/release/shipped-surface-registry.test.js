#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadShippedSurfaces, getReleaseCheckSurfaceSteps } from '../../../tools/release/surfaces.js';
import { prepareTestCacheDir } from '../../helpers/test-cache.js';

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
    for (const artifact of step.artifacts) {
      assert.equal(path.isAbsolute(artifact), false, `expected release-check artifact to be repo-relative for ${surface.id}:${step.id}`);
      const artifactPath = path.resolve(root, artifact);
      assert.equal(
        path.relative(root, artifactPath).startsWith('..'),
        false,
        `expected release-check artifact to stay under repo root for ${surface.id}:${step.id}: ${artifact}`
      );
    }
  }
  for (const sourcePath of surface.build.sourcePaths) {
    assert.equal(path.isAbsolute(sourcePath), false, `expected build source path to be repo-relative for ${surface.id}: ${sourcePath}`);
    assert.ok(
      fs.existsSync(path.join(root, sourcePath)),
      `expected build source path for ${surface.id}: ${sourcePath}`
    );
  }
  for (const outputPath of surface.build.outputs) {
    assert.equal(path.isAbsolute(outputPath), false, `expected build output path to be repo-relative for ${surface.id}: ${outputPath}`);
    const resolvedOutputPath = path.resolve(root, outputPath);
    assert.equal(
      path.relative(root, resolvedOutputPath).startsWith('..'),
      false,
      `expected build output path to stay under repo root for ${surface.id}: ${outputPath}`
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

const { dir: fixtureDir } = await prepareTestCacheDir('release-shipped-surface-registry');

const writeRegistry = (registryRoot, overrides = {}) => {
  const registryDir = path.join(registryRoot, 'docs', 'tooling');
  fs.mkdirSync(registryDir, { recursive: true });
  const surface = {
    id: 'bad',
    name: 'Bad Surface',
    owner: 'Release',
    supportLevel: 'supported',
    packagingBoundary: 'test package',
    publishBoundary: 'test publish',
    versionSource: 'package.json',
    runtimeTargets: [],
    platforms: [],
    build: {
      kind: 'test',
      sourcePaths: ['package.json'],
      outputs: ['dist/bad'],
      ...(overrides.build || {})
    },
    install: {
      kind: 'test',
      summary: 'test install'
    },
    smoke: {
      summary: 'test smoke'
    },
    releaseCheck: {
      enabled: true,
      steps: [
        {
          id: 'bad.step',
          phase: 'install',
          label: 'Bad step',
          command: ['node', '--version'],
          artifacts: ['dist/bad/artifact.json'],
          ...(overrides.step || {})
        }
      ]
    }
  };
  fs.writeFileSync(
    path.join(registryDir, 'shipped-surfaces.json'),
    `${JSON.stringify({ schemaVersion: '1.0.0', surfaces: [surface] }, null, 2)}\n`
  );
};

const escapingArtifactRoot = path.join(fixtureDir, 'escaping-artifact');
writeRegistry(escapingArtifactRoot, { step: { artifacts: ['../outside-artifact.json'] } });
assert.throws(
  () => loadShippedSurfaces(escapingArtifactRoot),
  /bad:bad\.step artifact must stay within repo root/,
  'expected release-check artifact registry entries to stay under the repo root'
);

const escapingBuildRoot = path.join(fixtureDir, 'escaping-build-source');
writeRegistry(escapingBuildRoot, { build: { sourcePaths: ['../outside-source.js'] } });
assert.throws(
  () => loadShippedSurfaces(escapingBuildRoot),
  /bad build source path must stay within repo root/,
  'expected build source registry entries to stay under the repo root'
);

const absoluteOutputRoot = path.join(fixtureDir, 'absolute-build-output');
writeRegistry(absoluteOutputRoot, { build: { outputs: [path.resolve(root, 'dist', 'bad')] } });
assert.throws(
  () => loadShippedSurfaces(absoluteOutputRoot),
  /bad build output path must be repo-relative/,
  'expected build output registry entries to be repo-relative'
);

console.log('shipped surface registry test passed');
