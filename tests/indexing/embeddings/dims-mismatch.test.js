#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { applyTestEnv } from '../../helpers/test-env.js';
import { runNode as runNodeSync } from '../../helpers/run-node.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';
import { rmDirRecursive } from '../../helpers/temp.js';


const root = process.cwd();
const fixtureRoot = path.join(root, 'tests', 'fixtures', 'sample');
const tempRoot = resolveTestCachePath(root, 'embeddings-dims-mismatch');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');

await rmDirRecursive(tempRoot, { retries: 8, delayMs: 150 });
await fsPromises.mkdir(tempRoot, { recursive: true });
await fsPromises.cp(fixtureRoot, repoRoot, { recursive: true });

const env = applyTestEnv({
  cacheRoot,
  embeddings: 'stub'
});

const runNode = (label, args, cwd = repoRoot) => runNodeSync(args, label, cwd, env, { stdio: 'pipe' });

const findCacheIndexPaths = async (rootDir) => {
  const matches = [];
  const walk = async (dir) => {
    let items;
    try {
      items = await fsPromises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const item of items) {
      const fullPath = path.join(dir, item.name);
      if (item.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (item.isFile() && item.name === 'cache.index.json') {
        matches.push(fullPath);
      }
    }
  };
  await walk(rootDir);
  return matches.sort((a, b) => a.localeCompare(b));
};

runNode('build_index failed', [
  path.join(root, 'build_index.js'),
  '--stub-embeddings',
  '--scm-provider',
  'none',
  '--repo',
  repoRoot
]);

runNode('build-embeddings dims=8 failed', [
  path.join(root, 'tools', 'build/embeddings.js'),
  '--stub-embeddings',
  '--mode',
  'code',
  '--dims',
  '8',
  '--repo',
  repoRoot
]);

runNode('build-embeddings dims=12 failed', [
  path.join(root, 'tools', 'build/embeddings.js'),
  '--stub-embeddings',
  '--mode',
  'code',
  '--dims',
  '12',
  '--repo',
  repoRoot
]);

const cacheIndexes = await findCacheIndexPaths(cacheRoot);
if (cacheIndexes.length > 0) {
  console.error('embeddings dims mismatch test failed: expected no cache indexes in stub fast-path mode');
  console.error(cacheIndexes.join('\n'));
  process.exit(1);
}

console.log('embeddings dims mismatch tests passed');
