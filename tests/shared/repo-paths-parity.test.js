#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  getCurrentBuildInfo as getCurrentBuildInfoShared,
  getIndexDir as getIndexDirShared,
  getRepoCacheRoot as getRepoCacheRootShared,
  getRepoId as getRepoIdShared,
  getRepoRoot as getRepoRootShared,
  resolveCurrentBuildModeRoot as resolveCurrentBuildModeRootShared,
  resolveIndexRoot as resolveIndexRootShared,
  resolveRepoRoot as resolveRepoRootShared
} from '../../src/shared/repo-paths.js';
import {
  getCurrentBuildInfo,
  getIndexDir,
  getRepoCacheRoot,
  getRepoId,
  getRepoRoot,
  loadUserConfig,
  resolveCurrentBuildModeRoot,
  resolveIndexRoot,
  resolveRepoRoot
} from '../../tools/shared/dict-utils.js';

const normalizePath = (value) => {
  if (!value) return value;
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
};

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pairofcleats-repo-paths-'));
const repoRoot = path.join(tempRoot, 'repo');
const nestedRoot = path.join(repoRoot, 'src', 'nested');
const cacheRoot = path.join(tempRoot, 'cache');

await fs.mkdir(nestedRoot, { recursive: true });
await fs.writeFile(
  path.join(repoRoot, '.pairofcleats.json'),
  JSON.stringify({ cache: { root: cacheRoot } }, null, 2),
  'utf8'
);

const userConfig = loadUserConfig(repoRoot);
const injectedOptions = {
  loadUserConfig: () => userConfig,
  getCacheRoot: () => cacheRoot
};

assert.equal(
  normalizePath(resolveRepoRootShared(nestedRoot)),
  normalizePath(resolveRepoRoot(nestedRoot)),
  'shared resolveRepoRoot should match tooling wrapper'
);
assert.equal(
  normalizePath(getRepoRootShared(null, nestedRoot)),
  normalizePath(getRepoRoot(null, nestedRoot)),
  'shared getRepoRoot should match tooling wrapper for implicit root resolution'
);
assert.equal(
  normalizePath(getRepoRootShared(repoRoot)),
  normalizePath(getRepoRoot(repoRoot)),
  'shared getRepoRoot should preserve explicit repo roots'
);
assert.equal(
  getRepoIdShared(repoRoot),
  getRepoId(repoRoot),
  'shared getRepoId should match tooling wrapper'
);

const repoCacheRootShared = getRepoCacheRootShared(repoRoot, userConfig);
const repoCacheRootWrapped = getRepoCacheRoot(repoRoot, userConfig);
const repoCacheRootInjected = getRepoCacheRootShared(repoRoot, null, injectedOptions);

assert.equal(
  normalizePath(repoCacheRootShared),
  normalizePath(repoCacheRootWrapped),
  'shared getRepoCacheRoot should match tooling wrapper'
);
assert.equal(
  normalizePath(repoCacheRootInjected),
  normalizePath(repoCacheRootWrapped),
  'shared getRepoCacheRoot should support injected config/cache defaults'
);

const buildsRoot = path.join(repoCacheRootShared, 'builds');
const buildId = '20260326T000000Z_repo_paths';
const buildRoot = path.join(buildsRoot, buildId);
await fs.mkdir(path.join(buildRoot, 'index-code'), { recursive: true });
await fs.writeFile(path.join(buildRoot, 'index-code', 'chunk_meta.jsonl.gz'), '', 'utf8');
await fs.writeFile(
  path.join(buildsRoot, 'current.json'),
  JSON.stringify({
    buildId,
    buildRoot,
    buildRoots: {
      code: buildRoot
    }
  }, null, 2),
  'utf8'
);

const currentShared = getCurrentBuildInfoShared(repoRoot, userConfig);
const currentWrapped = getCurrentBuildInfo(repoRoot, userConfig);
assert.ok(currentShared, 'shared current build info should resolve');
assert.ok(currentWrapped, 'tooling current build info should resolve');
assert.deepEqual(
  {
    buildId: currentShared.buildId,
    buildRoot: normalizePath(currentShared.buildRoot),
    activeRoot: normalizePath(currentShared.activeRoot),
    codeRoot: normalizePath(currentShared.buildRoots?.code)
  },
  {
    buildId: currentWrapped.buildId,
    buildRoot: normalizePath(currentWrapped.buildRoot),
    activeRoot: normalizePath(currentWrapped.activeRoot),
    codeRoot: normalizePath(currentWrapped.buildRoots?.code)
  },
  'shared current build info should match tooling wrapper'
);

const modeResolutionShared = resolveCurrentBuildModeRootShared(repoRoot, userConfig, { mode: 'code' });
const modeResolutionWrapped = resolveCurrentBuildModeRoot(repoRoot, userConfig, { mode: 'code' });
assert.deepEqual(
  {
    ok: modeResolutionShared.ok,
    root: normalizePath(modeResolutionShared.root),
    source: modeResolutionShared.source,
    errorCode: modeResolutionShared.errorCode
  },
  {
    ok: modeResolutionWrapped.ok,
    root: normalizePath(modeResolutionWrapped.root),
    source: modeResolutionWrapped.source,
    errorCode: modeResolutionWrapped.errorCode
  },
  'shared mode root resolution should match tooling wrapper'
);

assert.equal(
  normalizePath(resolveIndexRootShared(repoRoot, userConfig, { mode: 'code' })),
  normalizePath(resolveIndexRoot(repoRoot, userConfig, { mode: 'code' })),
  'shared resolveIndexRoot should match tooling wrapper'
);
assert.equal(
  normalizePath(getIndexDirShared(repoRoot, 'code', userConfig)),
  normalizePath(getIndexDir(repoRoot, 'code', userConfig)),
  'shared getIndexDir should match tooling wrapper'
);

console.log('shared repo-path parity test passed');
