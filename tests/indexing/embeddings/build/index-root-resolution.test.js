#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { applyTestEnv } from '../../../helpers/test-env.js';
import { resolveTestCachePath } from '../../../helpers/test-cache.js';
import {
  createEmbeddingsIndexRootResolver,
  normalizeEmbeddingsPath
} from '../../../../tools/build/embeddings/runner/index-root-resolution.js';

applyTestEnv();

const root = process.cwd();
const mode = 'code';
const tempRoot = resolveTestCachePath(root, 'embeddings-index-root-resolution');
const repoCacheRoot = path.join(tempRoot, 'repo-cache');
const buildsRoot = path.join(repoCacheRoot, 'builds');
const buildOld = path.join(buildsRoot, 'build-old');
const buildNew = path.join(buildsRoot, 'build-new');
const explicitRoot = path.join(tempRoot, 'explicit-root');

const writeModeArtifacts = async (buildRoot, modeName) => {
  const modeIndexDir = path.join(buildRoot, `index-${modeName}`);
  await fs.mkdir(path.join(modeIndexDir, 'pieces'), { recursive: true });
  await fs.writeFile(path.join(modeIndexDir, 'pieces', 'manifest.json'), '{}');
};

await fs.rm(tempRoot, { recursive: true, force: true });
await writeModeArtifacts(buildOld, mode);
await new Promise((resolve) => setTimeout(resolve, 20));
await writeModeArtifacts(buildNew, mode);
await fs.mkdir(explicitRoot, { recursive: true });

const fallbackLogs = [];
const autoFallbackResolver = createEmbeddingsIndexRootResolver({
  argv: {},
  rawArgv: [],
  root,
  userConfig: {},
  indexRoot: buildsRoot,
  modes: [mode],
  repoCacheRootResolved: repoCacheRoot,
  log: (line) => fallbackLogs.push(line),
  getCurrentBuildInfoImpl: () => null
});

assert.equal(autoFallbackResolver.explicitIndexRoot, false);
assert.equal(
  normalizeEmbeddingsPath(autoFallbackResolver.activeIndexRoot),
  normalizeEmbeddingsPath(buildNew),
  'expected latest build fallback to pick most recent build root with artifacts'
);
assert.equal(autoFallbackResolver.resolveModeIndexRoot(mode), buildNew);
assert.equal(autoFallbackResolver.hasModeArtifacts(buildNew, mode), true);
assert.ok(
  fallbackLogs.some((line) => line.includes('index root lacked mode artifacts; using latest build root')),
  'expected latest-build fallback log'
);

const currentBuildLogs = [];
const currentBuildResolver = createEmbeddingsIndexRootResolver({
  argv: {},
  rawArgv: [],
  root,
  userConfig: {},
  indexRoot: repoCacheRoot,
  modes: [mode],
  repoCacheRootResolved: repoCacheRoot,
  log: (line) => currentBuildLogs.push(line),
  getCurrentBuildInfoImpl: () => ({
    buildRoot: buildOld,
    activeRoot: buildOld
  })
});

assert.equal(
  normalizeEmbeddingsPath(currentBuildResolver.activeIndexRoot),
  normalizeEmbeddingsPath(buildOld),
  'expected current build root promotion to win before latest-build fallback'
);
assert.ok(
  currentBuildLogs.some((line) => line.includes('using active build root from current.json')),
  'expected current-build promotion log'
);

const explicitResolver = createEmbeddingsIndexRootResolver({
  argv: { 'index-root': explicitRoot },
  rawArgv: ['--index-root', explicitRoot],
  root,
  userConfig: {},
  indexRoot: explicitRoot,
  modes: [mode],
  repoCacheRootResolved: repoCacheRoot,
  getCurrentBuildInfoImpl: () => ({
    buildRoot: buildNew,
    activeRoot: buildNew
  })
});

assert.equal(explicitResolver.explicitIndexRoot, true);
assert.equal(
  normalizeEmbeddingsPath(explicitResolver.activeIndexRoot),
  normalizeEmbeddingsPath(explicitRoot),
  'expected explicit index root to remain pinned'
);
assert.equal(explicitResolver.resolveModeIndexRoot(mode), path.resolve(explicitRoot));
assert.equal(explicitResolver.hasModeArtifacts(explicitRoot, mode), false);

console.log('index root resolution helper test passed');
