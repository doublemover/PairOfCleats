#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import path from 'node:path';

import { applyTestEnv } from '../../helpers/test-env.js';
import { runNode as runNodeSync } from '../../helpers/run-node.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';

const root = process.cwd();
const findCacheIndexPaths = async (rootDir) => {
  const matches = [];
  const walk = async (dir) => {
    let entries = [];
    try {
      entries = await fsPromises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (entry.isFile() && entry.name === 'cache.index.json') {
        matches.push(fullPath);
      }
    }
  };
  await walk(rootDir);
  return matches.sort((a, b) => a.localeCompare(b));
};

const createStubEnv = (cacheRoot, extraTestConfig = {}) => applyTestEnv({
  cacheRoot,
  embeddings: 'stub',
  testConfig: {
    indexing: {
      scm: { provider: 'none' },
      typeInference: false,
      typeInferenceCrossFile: false,
      riskAnalysis: false,
      riskAnalysisCrossFile: false,
      embeddings: {
        hnsw: { enabled: false },
        lancedb: { enabled: false }
      }
    },
    tooling: {
      autoEnableOnDetect: false,
      lsp: { enabled: false }
    },
    ...extraTestConfig
  }
});

const runNode = (cwd, env, label, args) => runNodeSync(args, label, cwd, env, { stdio: 'pipe' });

const cases = [
  {
    name: 'cross repo reuse disabled',
    run: async () => {
      const { dir: tempRoot } = await prepareIsolatedTestCacheDir('embeddings-stub-fastpath-cross-repo', {
        root,
        clean: true
      });
      const repoA = path.join(tempRoot, 'repo-a');
      const repoB = path.join(tempRoot, 'repo-b');
      const cacheRoot = path.join(tempRoot, 'cache');
      await fsPromises.mkdir(path.join(repoA, 'src'), { recursive: true });
      await fsPromises.mkdir(path.join(repoB, 'src'), { recursive: true });
      await fsPromises.mkdir(cacheRoot, { recursive: true });
      const fileContents = 'export const alpha = () => 1;\n';
      await fsPromises.writeFile(path.join(repoA, 'src', 'alpha.js'), fileContents);
      await fsPromises.writeFile(path.join(repoB, 'src', 'alpha.js'), fileContents);

      const env = createStubEnv(cacheRoot);
      runNode(repoA, env, 'build_index A', [path.join(root, 'build_index.js'), '--stub-embeddings', '--repo', repoA]);
      runNode(repoA, env, 'build_embeddings A', [path.join(root, 'tools', 'build', 'embeddings.js'), '--stub-embeddings', '--mode', 'code', '--repo', repoA]);
      runNode(repoB, env, 'build_index B', [path.join(root, 'build_index.js'), '--stub-embeddings', '--repo', repoB]);
      runNode(repoB, env, 'build_embeddings B', [path.join(root, 'tools', 'build', 'embeddings.js'), '--stub-embeddings', '--mode', 'code', '--repo', repoB]);

      assert.deepEqual(await findCacheIndexPaths(cacheRoot), []);
    }
  }
];

for (const testCase of cases) {
  await testCase.run();
}

console.log(`stub fast-path cache contract matrix passed (${cases.length} cases)`);
