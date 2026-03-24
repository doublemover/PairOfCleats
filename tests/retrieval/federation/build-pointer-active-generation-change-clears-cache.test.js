#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadUserConfig, getRepoCacheRoot, toRealPathSync } from '../../../tools/shared/dict-utils.js';
import { createRepoCacheManager } from '../../../tools/shared/repo-cache-config.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pairofcleats-pointer-generation-clear-'));
const cacheRoot = path.join(tempRoot, 'cache');
const repoRoot = path.join(tempRoot, 'repo');

const writeBuild = async (buildsRoot, buildId) => {
  const buildRoot = path.join(buildsRoot, buildId);
  await fs.mkdir(path.join(buildRoot, 'index-code'), { recursive: true });
  await fs.writeFile(path.join(buildRoot, 'index-code', 'chunk_meta.json'), '[]', 'utf8');
  return buildRoot;
};

await fs.mkdir(repoRoot, { recursive: true });
await fs.writeFile(path.join(repoRoot, '.pairofcleats.json'), JSON.stringify({
  cache: { root: cacheRoot }
}, null, 2), 'utf8');

const userConfig = loadUserConfig(repoRoot);
const repoCacheRoot = getRepoCacheRoot(repoRoot, userConfig);
const buildsRoot = path.join(repoCacheRoot, 'builds');
const currentPath = path.join(buildsRoot, 'current.json');
const fixedTick = new Date('2026-03-23T00:00:00.000Z');

const buildRootA = await writeBuild(buildsRoot, 'build-a');
const buildRootB = await writeBuild(buildsRoot, 'build-b');
await fs.writeFile(currentPath, JSON.stringify({
  buildId: 'build-a',
  buildRoot: 'builds/build-a'
}, null, 2), 'utf8');
await fs.utimes(currentPath, fixedTick, fixedTick);

const manager = createRepoCacheManager({ defaultRepo: repoRoot });
const entry = manager.getRepoCaches(repoRoot);
await manager.refreshBuildPointer(entry);

entry.indexCache.set('sentinel', { value: 1 });
entry.sqliteCache.set(path.join(buildRootA, 'index.sqlite'), { close() {} });

assert.equal(entry.indexCache.size(), 1, 'expected warm index cache entry before generation change');
assert.equal(entry.sqliteCache.size(), 1, 'expected warm sqlite cache entry before generation change');
assert.equal(entry.buildId, 'build-a', 'expected initial build id');
assert.equal(entry.activeBuildRoot, toRealPathSync(buildRootA), 'expected initial active generation root');

await fs.writeFile(currentPath, JSON.stringify({
  buildId: 'build-a',
  buildRoot: 'builds/build-b'
}, null, 2), 'utf8');
await fs.utimes(currentPath, fixedTick, fixedTick);

await manager.refreshBuildPointer(entry);

assert.equal(entry.buildId, 'build-a', 'same build id should remain visible after pointer refresh');
assert.equal(entry.activeBuildRoot, toRealPathSync(buildRootB), 'expected active generation root to refresh from current.json');
assert.equal(entry.indexCache.size(), 0, 'active generation change should clear stale index cache state');
assert.equal(entry.sqliteCache.size(), 0, 'active generation change should clear stale sqlite cache state');

manager.closeRepoCaches();

console.log('build pointer active generation change clears cache test passed');
