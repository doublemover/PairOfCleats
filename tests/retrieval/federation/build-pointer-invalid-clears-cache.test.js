#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadUserConfig, getRepoCacheRoot } from '../../../tools/shared/dict-utils.js';
import { createRepoCacheManager } from '../../../tools/shared/repo-cache-config.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pairofcleats-pointer-cache-clear-'));
const cacheRoot = path.join(tempRoot, 'cache');
const repoRoot = path.join(tempRoot, 'repo');

await fs.mkdir(repoRoot, { recursive: true });
await fs.writeFile(path.join(repoRoot, '.pairofcleats.json'), JSON.stringify({
  cache: { root: cacheRoot }
}, null, 2), 'utf8');

const userConfig = loadUserConfig(repoRoot);
const repoCacheRoot = getRepoCacheRoot(repoRoot, userConfig);
const currentPath = path.join(repoCacheRoot, 'builds', 'current.json');
await fs.mkdir(path.dirname(currentPath), { recursive: true });
await fs.writeFile(currentPath, '{invalid-json', 'utf8');

const manager = createRepoCacheManager({ defaultRepo: repoRoot });
const entry = manager.getRepoCaches(repoRoot);
entry.buildId = 'build-1';
entry.indexCache.set('sentinel', { value: 1 });
assert.equal(entry.indexCache.size(), 1, 'expected warm cache entry before pointer corruption');

await manager.refreshBuildPointer(entry);

assert.equal(entry.buildId, null, 'invalid pointer should clear cached build id');
assert.equal(entry.indexCache.size(), 0, 'invalid pointer should clear index cache state');

manager.closeRepoCaches();

console.log('build pointer invalid clears cache test passed');
