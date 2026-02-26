#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { applyTestEnv } from '../../helpers/test-env.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'embeddings-cache-partial-reuse');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');
const srcDir = path.join(repoRoot, 'src');
const changedSrcPath = path.join(srcDir, 'alpha.js');
const stableSrcPath = path.join(srcDir, 'stable.js');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(srcDir, { recursive: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });
await fsPromises.writeFile(changedSrcPath, 'export const alpha = () => 1;\nexport const beta = () => 2;\n');
await fsPromises.writeFile(stableSrcPath, 'export const stable = () => 42;\n');

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

const runNode = (label, args) => {
  const result = spawnSync(process.execPath, args, { cwd: repoRoot, env, stdio: 'inherit' });
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
  if (!paths.length) return null;
  const indexPath = paths[0];
  const cacheDir = path.dirname(indexPath);
  const raw = await fsPromises.readFile(indexPath, 'utf8');
  return { indexPath, cacheDir, index: JSON.parse(raw) };
};

runNode('build_index', [path.join(root, 'build_index.js'), '--stub-embeddings', '--repo', repoRoot]);
runNode('build_embeddings', [path.join(root, 'tools', 'build', 'embeddings.js'), '--stub-embeddings', '--mode', 'code', '--repo', repoRoot]);

const first = await loadCacheIndex(cacheRoot);
if (first) {
  console.error('Expected stub fast-path to skip cache index writes on initial build');
  process.exit(1);
}

await fsPromises.appendFile(changedSrcPath, 'export const gamma = () => 3;\n');
runNode('build_index changed', [path.join(root, 'build_index.js'), '--stub-embeddings', '--repo', repoRoot]);
runNode('build_embeddings changed', [path.join(root, 'tools', 'build', 'embeddings.js'), '--stub-embeddings', '--mode', 'code', '--repo', repoRoot]);

const second = await loadCacheIndex(cacheRoot);
if (second) {
  console.error('Expected stub fast-path to skip cache index writes after file changes');
  process.exit(1);
}

console.log('stub fast-path partial cache reuse disable test passed');
