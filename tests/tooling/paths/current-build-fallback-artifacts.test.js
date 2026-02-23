#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getCurrentBuildInfo, getRepoCacheRoot, resolveIndexRoot } from '../../../tools/shared/dict-utils.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'current-build-fallback-artifacts');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');
const userConfig = { cache: { root: cacheRoot } };

const normalizePath = (value) => {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
};
const swapCase = (value) => String(value).replace(/[A-Za-z]/g, (ch) => (
  ch === ch.toLowerCase() ? ch.toUpperCase() : ch.toLowerCase()
));

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(repoRoot, { recursive: true });

const repoCacheRoot = getRepoCacheRoot(repoRoot, userConfig);
const buildsRoot = path.join(repoCacheRoot, 'builds');
const validBuildId = '20260211T000000Z_valid';
const missingBuildId = '20260211T010000Z_missing';
const validRoot = path.join(buildsRoot, validBuildId);
const missingRoot = path.join(buildsRoot, missingBuildId);

await fs.mkdir(path.join(validRoot, 'index-code'), { recursive: true });
await fs.writeFile(path.join(validRoot, 'index-code', 'chunk_meta.jsonl.gz'), '', 'utf8');

await fs.mkdir(path.join(missingRoot, 'index-code'), { recursive: true });
await fs.writeFile(
  path.join(buildsRoot, 'current.json'),
  JSON.stringify({
    buildId: missingBuildId,
    buildRoot: missingRoot
  }, null, 2),
  'utf8'
);

const currentInfo = getCurrentBuildInfo(repoRoot, userConfig, { mode: 'code' });
assert.ok(currentInfo, 'expected current build info');
assert.equal(
  normalizePath(currentInfo.activeRoot),
  normalizePath(validRoot),
  'expected fallback to choose latest build root with real artifacts'
);

const resolvedIndexRoot = resolveIndexRoot(repoRoot, userConfig, { mode: 'code' });
assert.equal(
  normalizePath(resolvedIndexRoot),
  normalizePath(validRoot),
  'expected resolveIndexRoot to skip roots with only empty index directories'
);

if (process.platform === 'win32') {
  await fs.writeFile(
    path.join(buildsRoot, 'current.json'),
    JSON.stringify({
      buildId: validBuildId,
      buildRoot: swapCase(validRoot)
    }, null, 2),
    'utf8'
  );
  const mixedCaseCurrent = getCurrentBuildInfo(repoRoot, userConfig, { mode: 'code' });
  assert.ok(mixedCaseCurrent, 'expected mixed-case buildRoot pointer to resolve');
  assert.equal(
    normalizePath(mixedCaseCurrent.activeRoot),
    normalizePath(validRoot),
    'expected mixed-case buildRoot to remain in repo cache scope'
  );
  const mixedCaseIndexRoot = resolveIndexRoot(repoRoot, userConfig, { mode: 'code' });
  assert.equal(
    normalizePath(mixedCaseIndexRoot),
    normalizePath(validRoot),
    'expected resolveIndexRoot to accept mixed-case cache-scoped buildRoot'
  );
}

console.log('current build fallback artifacts test passed');
