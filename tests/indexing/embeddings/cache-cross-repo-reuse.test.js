#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { applyTestEnv } from '../../helpers/test-env.js';
import { runNode as runNodeSync } from '../../helpers/run-node.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';
import { rmDirRecursive } from '../../helpers/temp.js';


const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'embeddings-cache-cross-repo');
const repoA = path.join(tempRoot, 'repo-a');
const repoB = path.join(tempRoot, 'repo-b');
const cacheRoot = path.join(tempRoot, 'cache');

await rmDirRecursive(tempRoot, { retries: 8, delayMs: 150 });
await fsPromises.mkdir(path.join(repoA, 'src'), { recursive: true });
await fsPromises.mkdir(path.join(repoB, 'src'), { recursive: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });

const fileContents = 'export const alpha = () => 1;\n';
await fsPromises.writeFile(path.join(repoA, 'src', 'alpha.js'), fileContents);
await fsPromises.writeFile(path.join(repoB, 'src', 'alpha.js'), fileContents);

const env = applyTestEnv({
  cacheRoot,
  embeddings: 'stub',
  testConfig: {
    indexing: {
      scm: { provider: 'none' },
      embeddings: {
        hnsw: { enabled: false },
        lancedb: { enabled: false }
      }
    }
  }
});

const runNode = (cwd, label, args) => runNodeSync(args, label, cwd, env, { stdio: 'pipe' });

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
  return matches;
};

runNode(repoA, 'build_index A', [path.join(root, 'build_index.js'), '--stub-embeddings', '--repo', repoA]);
runNode(repoA, 'build_embeddings A', [path.join(root, 'tools', 'build', 'embeddings.js'), '--stub-embeddings', '--mode', 'code', '--repo', repoA]);

runNode(repoB, 'build_index B', [path.join(root, 'build_index.js'), '--stub-embeddings', '--repo', repoB]);
runNode(repoB, 'build_embeddings B', [path.join(root, 'tools', 'build', 'embeddings.js'), '--stub-embeddings', '--mode', 'code', '--repo', repoB]);

const indexPaths = await findCacheIndexPaths(cacheRoot);
if (indexPaths.length > 0) {
  console.error('Expected stub fast-path to skip persistent cache writes across repos');
  console.error(`Found cache indexes: ${indexPaths.join(', ')}`);
  process.exit(1);
}

console.log('stub fast-path cross-repo cache disable test passed');
