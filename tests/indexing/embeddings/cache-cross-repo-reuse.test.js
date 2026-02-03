#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { applyTestEnv } from '../../helpers/test-env.js';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'embeddings-cache-cross-repo');
const repoA = path.join(tempRoot, 'repo-a');
const repoB = path.join(tempRoot, 'repo-b');
const cacheRoot = path.join(tempRoot, 'cache');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
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

const runNode = (cwd, label, args) => {
  const result = spawnSync(process.execPath, args, { cwd, env, stdio: 'inherit' });
  if (result.status !== 0) {
    const exitLabel = result.status ?? 'unknown';
    console.error(`Failed: ${label} (exit ${exitLabel})`);
    process.exit(result.status ?? 1);
  }
};

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

const loadCacheIndex = async (rootDir) => {
  const paths = await findCacheIndexPaths(rootDir);
  if (!paths.length) {
    console.error('Expected cache index to be created');
    process.exit(1);
  }
  const indexPath = paths[0];
  const raw = await fsPromises.readFile(indexPath, 'utf8');
  return JSON.parse(raw);
};

runNode(repoA, 'build_index A', [path.join(root, 'build_index.js'), '--stub-embeddings', '--repo', repoA]);
runNode(repoA, 'build_embeddings A', [path.join(root, 'tools', 'build-embeddings.js'), '--stub-embeddings', '--mode', 'code', '--repo', repoA]);

const firstIndex = await loadCacheIndex(cacheRoot);
const firstKeys = new Set(Object.keys(firstIndex.entries || {}));
if (!firstKeys.size) {
  console.error('Expected cache entries after first repo build');
  process.exit(1);
}

runNode(repoB, 'build_index B', [path.join(root, 'build_index.js'), '--stub-embeddings', '--repo', repoB]);
runNode(repoB, 'build_embeddings B', [path.join(root, 'tools', 'build-embeddings.js'), '--stub-embeddings', '--mode', 'code', '--repo', repoB]);

const secondIndex = await loadCacheIndex(cacheRoot);
const secondKeys = new Set(Object.keys(secondIndex.entries || {}));
const hasNew = Array.from(secondKeys).some((key) => !firstKeys.has(key));
if (hasNew) {
  console.error('Expected global cache to reuse entries across repos');
  process.exit(1);
}

console.log('embeddings cache cross-repo reuse test passed');
