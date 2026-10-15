#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsSync from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { getRepoCacheRoot, loadUserConfig } from '../../../tools/shared/dict-utils.js';
import { buildIndex } from '../../../src/integrations/core/index.js';
import { applyTestEnv } from '../../helpers/test-env.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'stage4-explicit-index-root-no-promotion');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(path.join(repoRoot, 'src'), { recursive: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });
await fsPromises.writeFile(path.join(repoRoot, 'src', 'alpha.js'), 'export const alpha = 1;\n');

const env = applyTestEnv({
  cacheRoot,
  embeddings: 'stub',
  testConfig: {
    indexing: {
      embeddings: { enabled: false }
    }
  }
});

const runBuild = async (options, label) => {
  try {
    await buildIndex(repoRoot, options);
  } catch (err) {
    console.error(`Failed: ${label}`);
    console.error(err?.stack || err?.message || String(err));
    process.exit(1);
  }
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const userConfig = loadUserConfig(repoRoot);
const repoCacheRoot = getRepoCacheRoot(repoRoot, userConfig);
const currentPath = path.join(repoCacheRoot, 'builds', 'current.json');

await runBuild({ mode: 'code', stage: 'stage2', 'stub-embeddings': true }, 'stage2 build A');
const currentA = JSON.parse(await fsPromises.readFile(currentPath, 'utf8'));

await fsPromises.writeFile(path.join(repoRoot, 'src', 'alpha.js'), 'export const alpha = 2;\n');
await sleep(1100);
await runBuild({ mode: 'code', stage: 'stage2', 'stub-embeddings': true }, 'stage2 build B');
const currentB = JSON.parse(await fsPromises.readFile(currentPath, 'utf8'));
assert.notEqual(currentA.buildRoot, currentB.buildRoot, 'expected second stage2 build to produce a new build root');

const oldBuildRoot = path.join(repoCacheRoot, currentA.buildRoot);
const currentBeforeStage4Raw = await fsPromises.readFile(currentPath, 'utf8');
const beforeReceipt = JSON.parse(await fsPromises.readFile(path.join(oldBuildRoot, 'build_state.json'), 'utf8'));
assert.equal(beforeReceipt.runtime.attempts.at(-1).lifecycle, 'succeeded');

await runBuild(
  {
    mode: 'code',
    stage: 'stage4',
    'index-root': oldBuildRoot,
    'stub-embeddings': true
  },
  'explicit stage4 on old index root'
);

const afterReceipt = JSON.parse(await fsPromises.readFile(path.join(oldBuildRoot, 'build_state.json'), 'utf8'));
assert.equal(afterReceipt.buildId, beforeReceipt.buildId);
assert.equal(afterReceipt.createdAt, beforeReceipt.createdAt);
assert.deepEqual(afterReceipt.modes, beforeReceipt.modes);
assert.deepEqual(afterReceipt.phases.stage2, beforeReceipt.phases.stage2);
assert.deepEqual(afterReceipt.phases.validation, beforeReceipt.phases.validation);
assert.deepEqual(afterReceipt.stageCheckpoints, beforeReceipt.stageCheckpoints);
assert.deepEqual(afterReceipt.validation, beforeReceipt.validation);
assert.equal(afterReceipt.runtime.attempts.length, beforeReceipt.runtime.attempts.length + 1);
assert.equal(afterReceipt.runtime.attempts.at(-1).stage, 'stage4');
assert.equal(afterReceipt.runtime.attempts.at(-1).lifecycle, 'succeeded');
assert.equal(afterReceipt.runtime.attempts.at(-1).embeddings.observation.state, 'not-started');

const currentAfterStage4Raw = await fsPromises.readFile(currentPath, 'utf8');
assert.equal(
  currentAfterStage4Raw,
  currentBeforeStage4Raw,
  'expected explicit stage4 --index-root run to leave builds/current.json unchanged'
);
assert.equal(
  JSON.parse(currentAfterStage4Raw).buildRoot,
  currentB.buildRoot,
  'expected current build root to remain the latest promoted stage2 build'
);
assert.equal(
  fsSync.existsSync(path.join(oldBuildRoot, 'index-sqlite')),
  true,
  'expected stage4 explicit root run to still write sqlite artifacts'
);

console.log('stage4 explicit index-root no-promotion contract test passed');
