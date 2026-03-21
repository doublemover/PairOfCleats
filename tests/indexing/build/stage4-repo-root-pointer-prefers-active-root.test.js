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
const tempRoot = resolveTestCachePath(root, 'stage4-repo-root-pointer-prefers-active-root');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(path.join(repoRoot, 'src'), { recursive: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });
await fsPromises.writeFile(path.join(repoRoot, 'src', 'alpha.js'), 'export const alpha = 1;\n');

applyTestEnv({
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

const userConfig = loadUserConfig(repoRoot);
const repoCacheRoot = getRepoCacheRoot(repoRoot, userConfig);
const currentPath = path.join(repoCacheRoot, 'builds', 'current.json');

await runBuild({ mode: 'code', stage: 'stage2', 'stub-embeddings': true }, 'stage2 build');
const currentBefore = JSON.parse(await fsPromises.readFile(currentPath, 'utf8'));
const expectedBuildRoot = currentBefore.buildRoot;
const expectedAbsoluteBuildRoot = path.join(repoCacheRoot, expectedBuildRoot);

currentBefore.buildRoot = '.';
currentBefore.buildRootsByMode = {
  ...(currentBefore.buildRootsByMode || {}),
  code: '.'
};
await fsPromises.writeFile(currentPath, `${JSON.stringify(currentBefore, null, 2)}\n`, 'utf8');

await runBuild(
  {
    mode: 'code',
    stage: 'stage4',
    'stub-embeddings': true
  },
  'stage4 repo-root pointer recovery'
);

const currentAfter = JSON.parse(await fsPromises.readFile(currentPath, 'utf8'));
assert.equal(
  currentAfter.buildRoot,
  expectedBuildRoot,
  'expected stage4 promotion to restore the generation-local build root pointer'
);
assert.notEqual(
  currentAfter.buildRootsByMode?.code,
  '.',
  'expected stage4 promotion to replace repo-root mode pointers'
);
assert.equal(
  fsSync.existsSync(path.join(expectedAbsoluteBuildRoot, 'index-sqlite', 'index-code.db')),
  true,
  'expected stage4 sqlite build to write into the recovered active build root'
);

console.log('stage4 repo-root pointer prefers active-root test passed');
