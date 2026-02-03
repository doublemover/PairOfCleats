#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { applyTestEnv } from '../../helpers/test-env.js';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'embeddings-cache-append');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');
const srcDir = path.join(repoRoot, 'src');
const srcPath = path.join(srcDir, 'alpha.js');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(srcDir, { recursive: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });
await fsPromises.writeFile(srcPath, 'export const alpha = () => 1;\n');

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
  if (!paths.length) {
    console.error('Expected cache index to be created');
    process.exit(1);
  }
  const indexPath = paths[0];
  const cacheDir = path.dirname(indexPath);
  const raw = await fsPromises.readFile(indexPath, 'utf8');
  return { indexPath, cacheDir, index: JSON.parse(raw) };
};

runNode('build_index', [path.join(root, 'build_index.js'), '--stub-embeddings', '--repo', repoRoot]);
runNode('build_embeddings', [path.join(root, 'tools', 'build-embeddings.js'), '--stub-embeddings', '--mode', 'code', '--repo', repoRoot]);

const first = await loadCacheIndex(cacheRoot);
const firstKeys = Object.keys(first.index.entries || {});
if (!firstKeys.length) {
  console.error('Expected cache index entries after first build');
  process.exit(1);
}
const firstEntry = first.index.entries[firstKeys[0]];
if (!firstEntry?.shard) {
  console.error('Expected cache index entries to point at a shard');
  process.exit(1);
}
const shardPath = path.join(first.cacheDir, 'shards', firstEntry.shard);
if (!fs.existsSync(shardPath)) {
  console.error('Expected cache shard file to exist');
  process.exit(1);
}
const before = await fsPromises.stat(shardPath);

await fsPromises.appendFile(srcPath, 'export const beta = () => 2;\n');
runNode('build_index changed', [path.join(root, 'build_index.js'), '--stub-embeddings', '--repo', repoRoot]);
runNode('build_embeddings changed', [path.join(root, 'tools', 'build-embeddings.js'), '--stub-embeddings', '--mode', 'code', '--repo', repoRoot]);

const second = await loadCacheIndex(cacheRoot);
const secondKeys = Object.keys(second.index.entries || {});
if (secondKeys.length <= firstKeys.length) {
  console.error('Expected cache index to append a new entry after file change');
  process.exit(1);
}
const after = await fsPromises.stat(shardPath);
if (after.size <= before.size) {
  console.error('Expected cache shard to grow after appending entry');
  process.exit(1);
}

console.log('embeddings cache index append-only test passed');
