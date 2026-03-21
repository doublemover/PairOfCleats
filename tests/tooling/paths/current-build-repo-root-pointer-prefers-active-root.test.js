#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  getCurrentBuildInfo,
  getRepoCacheRoot,
  resolveCurrentBuildModeRoot,
  resolveIndexRoot
} from '../../../tools/shared/dict-utils.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'current-build-repo-root-pointer-prefers-active-root');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');
const userConfig = { cache: { root: cacheRoot } };

const normalizePath = (value) => {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
};

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(repoRoot, { recursive: true });

const repoCacheRoot = getRepoCacheRoot(repoRoot, userConfig);
const buildsRoot = path.join(repoCacheRoot, 'builds');
const buildId = '20260321T000000Z_active';
const activeRoot = path.join(buildsRoot, buildId);

await fs.mkdir(path.join(activeRoot, 'index-code'), { recursive: true });
await fs.writeFile(path.join(activeRoot, 'index-code', 'chunk_meta.jsonl.gz'), '', 'utf8');
await fs.writeFile(
  path.join(buildsRoot, 'current.json'),
  JSON.stringify({
    buildId,
    buildRoot: '.',
    buildRootsByMode: {
      code: '.'
    }
  }, null, 2),
  'utf8'
);

const currentInfo = getCurrentBuildInfo(repoRoot, userConfig, { mode: 'code' });
assert.ok(currentInfo, 'expected current build info to resolve');
assert.equal(
  normalizePath(currentInfo.activeRoot),
  normalizePath(activeRoot),
  'expected activeRoot to recover the generation-local build root'
);

const resolvedIndexRoot = resolveIndexRoot(repoRoot, userConfig, { mode: 'code' });
assert.equal(
  normalizePath(resolvedIndexRoot),
  normalizePath(activeRoot),
  'expected resolveIndexRoot to prefer activeRoot over repo-root pointers'
);

const modeResolution = resolveCurrentBuildModeRoot(repoRoot, userConfig, {
  mode: 'code',
  requireArtifacts: true,
  disallowRepoRootFallback: true
});
assert.equal(modeResolution.ok, true, 'expected structured mode resolution to succeed');
assert.equal(modeResolution.source, 'active-root', 'expected mode resolution to attribute selection to activeRoot');
assert.equal(
  normalizePath(modeResolution.root),
  normalizePath(activeRoot),
  'expected structured mode resolution to return the generation-local active root'
);

console.log('current build repo-root pointer prefers active-root test passed');
