#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { applyTestEnv } from '../helpers/test-env.js';
import { getIndexDir, resolveRepoConfig } from '../../tools/shared/dict-utils.js';
import { buildCodeMap } from '../../src/map/build-map.js';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'map-build-determinism');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(repoRoot, { recursive: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });
await fsPromises.mkdir(path.join(repoRoot, 'src'), { recursive: true });

await fsPromises.writeFile(
  path.join(repoRoot, 'src', 'one.js'),
  'export function one() { return 1; }\n'
);
await fsPromises.writeFile(
  path.join(repoRoot, 'src', 'two.js'),
  'import { one } from "./one.js";\nexport function two() { return one(); }\n'
);

const env = applyTestEnv({
  cacheRoot,
  embeddings: 'stub',
  testConfig: {
    indexing: {
      scm: { provider: 'none' }
    }
  }
});

const buildResult = spawnSync(
  process.execPath,
  [path.join(root, 'build_index.js'), '--stub-embeddings', '--repo', repoRoot],
  { cwd: repoRoot, env, stdio: 'inherit' }
);

if (buildResult.status !== 0) {
  console.error('Failed: build index for map determinism test');
  process.exit(buildResult.status ?? 1);
}

const { userConfig } = resolveRepoConfig(repoRoot);
const indexDir = getIndexDir(repoRoot, 'code', userConfig, {});

const strip = (payload) => {
  const clone = JSON.parse(JSON.stringify(payload));
  clone.generatedAt = null;
  if (clone.buildMetrics) clone.buildMetrics = null;
  return clone;
};

const first = strip(await buildCodeMap({ repoRoot, indexDir, options: { mode: 'code' } }));
const second = strip(await buildCodeMap({ repoRoot, indexDir, options: { mode: 'code' } }));

assert.equal(JSON.stringify(first), JSON.stringify(second));

console.log('map build determinism test passed');
