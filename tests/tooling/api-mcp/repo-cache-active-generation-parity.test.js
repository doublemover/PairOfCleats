#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { loadUserConfig, getRepoCacheRoot, toRealPathSync } from '../../../tools/shared/dict-utils.js';
import { createRepoCacheManager } from '../../../src/shared/repo-cache-config.js';
import { createRepoCacheManager as createApiRepoCacheManager } from '../../../tools/api/router/cache.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pairofcleats-repo-cache-generation-parity-'));
const fixedTick = new Date('2026-03-23T00:00:00.000Z');

const writeBuild = async (buildsRoot, buildId) => {
  const buildRoot = path.join(buildsRoot, buildId);
  await fs.mkdir(path.join(buildRoot, 'index-code'), { recursive: true });
  await fs.writeFile(
    path.join(buildRoot, 'index-code', 'chunk_meta.json'),
    JSON.stringify([{ chunkUid: `${buildId}-chunk`, file: `${buildId}.js` }], null, 2),
    'utf8'
  );
  return buildRoot;
};

try {
  const repoRoot = path.join(tempRoot, 'repo');
  await fs.mkdir(repoRoot, { recursive: true });
  await fs.writeFile(path.join(repoRoot, 'package.json'), JSON.stringify({ name: 'repo-cache-generation-parity' }), 'utf8');

  const userConfig = loadUserConfig(repoRoot);
  const repoCacheRoot = getRepoCacheRoot(repoRoot, userConfig);
  const buildsRoot = path.join(repoCacheRoot, 'builds');
  await fs.mkdir(buildsRoot, { recursive: true });

  const buildRootA = await writeBuild(buildsRoot, 'build-a');
  const buildRootB = await writeBuild(buildsRoot, 'build-b');

  const writePointer = async (buildRoot) => {
    const currentJsonPath = path.join(buildsRoot, 'current.json');
    await fs.writeFile(currentJsonPath, JSON.stringify({
      buildId: 'build-a',
      buildRoot: path.relative(repoCacheRoot, buildRoot).replace(/\\/g, '/')
    }, null, 2), 'utf8');
    await fs.utimes(currentJsonPath, fixedTick, fixedTick);
  };

  await writePointer(buildRootA);

  const sharedManager = createRepoCacheManager({ defaultRepo: repoRoot, namespace: 'parity-generation-shared' });
  const apiManager = createApiRepoCacheManager({ defaultRepo: repoRoot });
  const mcpManager = createRepoCacheManager({ defaultRepo: repoRoot, namespace: 'parity-generation-mcp' });

  const sharedEntry = sharedManager.getRepoCaches(repoRoot);
  const apiEntry = apiManager.getRepoCaches(repoRoot);
  const mcpEntry = mcpManager.getRepoCaches(repoRoot);

  await sharedManager.refreshBuildPointer(sharedEntry);
  await apiManager.refreshBuildPointer(apiEntry);
  await mcpManager.refreshBuildPointer(mcpEntry);

  sharedEntry.indexCache.set('shared', { ok: true });
  sharedEntry.sqliteCache.set('shared', { ok: true });
  apiEntry.indexCache.set('api', { ok: true });
  apiEntry.sqliteCache.set('api', { ok: true });
  mcpEntry.indexCache.set('mcp', { ok: true });
  mcpEntry.sqliteCache.set('mcp', { ok: true });

  await writePointer(buildRootB);

  await sharedManager.refreshBuildPointer(sharedEntry);
  await apiManager.refreshBuildPointer(apiEntry);
  await mcpManager.refreshBuildPointer(mcpEntry);

  assert.equal(sharedEntry.activeBuildRoot, toRealPathSync(buildRootB));
  assert.equal(apiEntry.activeBuildRoot, toRealPathSync(buildRootB));
  assert.equal(mcpEntry.activeBuildRoot, toRealPathSync(buildRootB));

  assert.equal(sharedEntry.indexCache.size(), 0, 'shared retrieval cache should clear on active-generation change');
  assert.equal(sharedEntry.sqliteCache.size(), 0, 'shared sqlite cache should clear on active-generation change');
  assert.equal(apiEntry.indexCache.size(), 0, 'api cache should clear on active-generation change');
  assert.equal(apiEntry.sqliteCache.size(), 0, 'api sqlite cache should clear on active-generation change');
  assert.equal(mcpEntry.indexCache.size(), 0, 'mcp cache should clear on active-generation change');
  assert.equal(mcpEntry.sqliteCache.size(), 0, 'mcp sqlite cache should clear on active-generation change');

  sharedManager.closeRepoCaches();
  apiManager.closeRepoCaches();
  mcpManager.closeRepoCaches();
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}

console.log('repo cache active generation parity test passed');
