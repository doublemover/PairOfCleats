#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getRepoCacheRoot, resolveIndexRoot } from '../../../tools/shared/dict-utils.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

if (process.platform !== 'win32') {
  console.log('repo current build case-insensitive test skipped (win32 only)');
  process.exit(0);
}

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'repo-current-case-insensitive');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache-root');
const previousCacheRoot = process.env.PAIROFCLEATS_CACHE_ROOT;

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(repoRoot, { recursive: true });
await fs.writeFile(path.join(repoRoot, '.pairofcleats.json'), '{}\n', 'utf8');
process.env.PAIROFCLEATS_CACHE_ROOT = cacheRoot;

try {
  const repoCacheRoot = getRepoCacheRoot(repoRoot);
  const buildRoot = path.join(repoCacheRoot, 'builds', 'build-001');
  const modeDir = path.join(buildRoot, 'index-code');
  await fs.mkdir(modeDir, { recursive: true });
  await fs.writeFile(path.join(modeDir, 'chunk_meta.json'), '{"rows":1}\n', 'utf8');

  const currentPath = path.join(repoCacheRoot, 'builds', 'current.json');
  const upperBuildRoot = buildRoot.toUpperCase();
  await fs.writeFile(
    currentPath,
    `${JSON.stringify({ buildId: 'build-001', buildRoot: upperBuildRoot }, null, 2)}\n`,
    'utf8'
  );

  const resolved = resolveIndexRoot(repoRoot, null, { mode: 'code' });
  assert.equal(
    path.resolve(resolved).toLowerCase(),
    path.resolve(buildRoot).toLowerCase(),
    'expected resolveIndexRoot to accept current.json buildRoot with case differences on win32'
  );

  console.log('repo current build case-insensitive path test passed');
} finally {
  if (previousCacheRoot == null) {
    delete process.env.PAIROFCLEATS_CACHE_ROOT;
  } else {
    process.env.PAIROFCLEATS_CACHE_ROOT = previousCacheRoot;
  }
}
