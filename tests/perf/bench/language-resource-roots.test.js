#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { resolveBenchmarkResourceRoots, applyBenchmarkResourceRoots } from '../../../tools/bench/language/resource-roots.js';
import { getDefaultCacheRoot } from '../../../src/shared/cache-roots.js';
import { getDictConfig, getExtensionsDir, getModelsDir, getToolingDir } from '../../../tools/shared/dict-utils.js';
import { parseBenchLanguageArgs } from '../../../tools/bench/language/cli.js';
import { withTemporaryEnv } from '../../helpers/test-env.js';
import { applyRepoConfigAuthority } from '../../../src/shared/config-authority.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const tempRoot = resolveTestCachePath(process.cwd(), 'bench-language-resource-roots');
fs.rmSync(tempRoot, { recursive: true, force: true });
fs.mkdirSync(tempRoot, { recursive: true });
const shared = path.join(tempRoot, 'shared-assets');
const runA = path.join(tempRoot, 'run-a');
const runB = path.join(tempRoot, 'run-b');
const env = { PAIROFCLEATS_HOME: shared, PAIROFCLEATS_CACHE_ROOT: runA, NODE_OPTIONS: '--max-old-space-size=512' };
const rootsA = resolveBenchmarkResourceRoots({ root: tempRoot, env, userConfig: {}, cacheRoot: runA });
const rootsB = resolveBenchmarkResourceRoots({ root: tempRoot, env: { ...env, PAIROFCLEATS_CACHE_ROOT: runB }, userConfig: {}, cacheRoot: runB });
assert.deepEqual(rootsA, rootsB, 'run-cache changes cannot move prerequisite assets');
const applied = applyBenchmarkResourceRoots({ ...env, PAIROFCLEATS_CACHE_ROOT: runB }, rootsA);
assert.equal(applied.PAIROFCLEATS_CACHE_ROOT, runB);
assert.equal(applied.NODE_OPTIONS, env.NODE_OPTIONS, 'resource selection preserves launch runtime settings');
await withTemporaryEnv(applied, async () => {
  assert.equal(getToolingDir(tempRoot, {}), rootsA.toolingRoot);
  assert.equal(getDictConfig(tempRoot, {}).dir, rootsA.dictionaryRoot);
  assert.equal(getModelsDir(tempRoot, {}), rootsA.modelsRoot);
  assert.equal(getExtensionsDir(tempRoot, {}), rootsA.extensionsRoot);
});
const defaultRoots = resolveBenchmarkResourceRoots({ root: tempRoot, env: { PAIROFCLEATS_CACHE_ROOT: runA }, userConfig: {} });
assert.equal(defaultRoots.homeRoot, path.resolve(getDefaultCacheRoot()), 'an isolated cache override is not a shared-resource home');
const explicit = resolveBenchmarkResourceRoots({ root: tempRoot, resourceRoot: shared, env: {
  PAIROFCLEATS_HOME: path.join(tempRoot, 'old-home'), PAIROFCLEATS_MODELS_DIR: path.join(tempRoot, 'chosen-models')
}, userConfig: { tooling: { dir: path.join(tempRoot, 'chosen-tools') } }, cacheRoot: runA });
assert.equal(explicit.homeRoot, shared);
assert.equal(explicit.modelsRoot, path.join(tempRoot, 'chosen-models'), 'per-asset selection remains explicit');
assert.equal(explicit.toolingRoot, path.join(tempRoot, 'chosen-tools'));
await withTemporaryEnv(applyBenchmarkResourceRoots({}, explicit), async () => {
  assert.equal(getToolingDir(tempRoot, {}), explicit.toolingRoot, 'a custom managed root reaches the actual runtime resolver');
});
await withTemporaryEnv({ PAIROFCLEATS_TRUSTED_REPOS: '[]' }, async () => {
  const unsafe = { tooling: { dir: path.join(tempRoot, 'repo-tools'),
    gopls: { env: { PAIROFCLEATS_TOOLING_DIR: path.join(tempRoot, 'repo-tools') } } } };
  const safe = applyRepoConfigAuthority(unsafe, tempRoot);
  assert.equal(safe.tooling.dir, undefined);
  assert.equal(safe.tooling.gopls.env, undefined, 'repository config cannot grant the new launch-selected root');
});
assert.throws(() => resolveBenchmarkResourceRoots({ root: tempRoot, resourceRoot: runA, cacheRoot: runA, env: {}, userConfig: {} }), /outside the per-run cache/);
if (process.platform !== 'win32') {
  fs.mkdirSync(runA);
  const alias = path.join(tempRoot, 'outside-alias');
  fs.symlinkSync(runA, alias, 'dir');
  assert.throws(() => resolveBenchmarkResourceRoots({ root: tempRoot, resourceRoot: path.join(alias, 'not-created'), cacheRoot: runA,
    env: {}, userConfig: {} }), /outside the per-run cache/, 'missing descendants of a symlink resolve to their physical cache owner');
}
assert.equal(parseBenchLanguageArgs(['--resource-root', shared]).resourceRoot, shared);
assert.equal(fs.existsSync(shared), false, 'root resolution does not install, create, or purge assets');
console.log('Benchmark prerequisite roots stay stable across isolated run caches and preserve explicit selections.');
