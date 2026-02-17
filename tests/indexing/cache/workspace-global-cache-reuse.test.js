#!/usr/bin/env node
import { applyTestEnv } from '../../helpers/test-env.js';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describeCacheLayers } from '../../../src/shared/cache.js';
import {
  getDictConfig,
  getModelsDir,
  getRepoCacheRoot,
  getToolingDir,
  loadUserConfig
} from '../../../tools/shared/dict-utils.js';

applyTestEnv();

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pairofcleats-workspace-global-cache-'));
const cacheRoot = path.join(tempRoot, 'cache');
const repoA = path.join(tempRoot, 'repo-a');
const repoB = path.join(tempRoot, 'repo-b');

const writeRepoConfig = async (repoRoot) => {
  await fs.mkdir(repoRoot, { recursive: true });
  await fs.writeFile(path.join(repoRoot, '.pairofcleats.json'), JSON.stringify({
    cache: { root: cacheRoot }
  }, null, 2), 'utf8');
};

await writeRepoConfig(repoA);
await writeRepoConfig(repoB);

const cfgA = loadUserConfig(repoA);
const cfgB = loadUserConfig(repoB);

const repoCacheA = getRepoCacheRoot(repoA, cfgA);
const repoCacheB = getRepoCacheRoot(repoB, cfgB);
assert.notEqual(repoCacheA, repoCacheB, 'repo-scoped caches should be unique per repo');

const modelsA = getModelsDir(repoA, cfgA);
const modelsB = getModelsDir(repoB, cfgB);
assert.equal(modelsA, modelsB, 'models cache should be shared across repos');

const toolingA = getToolingDir(repoA, cfgA);
const toolingB = getToolingDir(repoB, cfgB);
assert.equal(toolingA, toolingB, 'tooling cache should be shared across repos');

const dictA = getDictConfig(repoA, cfgA).dir;
const dictB = getDictConfig(repoB, cfgB).dir;
assert.equal(dictA, dictB, 'dictionary cache should be shared across repos');

const layers = describeCacheLayers({
  cacheRoot,
  repoCacheRoot: repoCacheA,
  federationCacheRoot: path.join(cacheRoot, 'federation')
});
assert.ok(Array.isArray(layers.global.surfaces) && layers.global.surfaces.length > 0);
assert.ok(Array.isArray(layers.repo.surfaces) && layers.repo.surfaces.length > 0);
assert.ok(Array.isArray(layers.workspace.surfaces) && layers.workspace.surfaces.length > 0);
assert.equal(layers.global.root, path.resolve(cacheRoot));
assert.equal(layers.workspace.root, path.resolve(path.join(cacheRoot, 'federation')));

console.log('workspace global cache reuse test passed');
