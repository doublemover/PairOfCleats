#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { applyTestEnv } from '../../helpers/test-env.js';
import { readCacheEntry } from '../../../tools/build/embeddings/cache.js';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'embeddings-cache-partial-reuse');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');
const srcDir = path.join(repoRoot, 'src');
const srcPath = path.join(srcDir, 'alpha.js');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(srcDir, { recursive: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });
await fsPromises.writeFile(srcPath, 'export const alpha = () => 1;\nexport const beta = () => 2;\n');

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
runNode('build_embeddings', [path.join(root, 'tools', 'build', 'embeddings.js'), '--stub-embeddings', '--mode', 'code', '--repo', repoRoot]);

const first = await loadCacheIndex(cacheRoot);
const firstKeys = Object.keys(first.index.entries || {});
if (!firstKeys.length) {
  console.error('Expected cache entries after initial build');
  process.exit(1);
}
const priorKey = firstKeys[0];
const priorEntry = first.index.entries[priorKey];
const priorHits = Number.isFinite(Number(priorEntry?.hits)) ? Number(priorEntry.hits) : 0;
const priorCache = await readCacheEntry(first.cacheDir, priorKey, first.index);
if (!Array.isArray(priorCache?.entry?.chunkHashes)) {
  console.error('Expected cache entry to include chunk hashes');
  process.exit(1);
}

await fsPromises.appendFile(srcPath, 'export const gamma = () => 3;\n');
runNode('build_index changed', [path.join(root, 'build_index.js'), '--stub-embeddings', '--repo', repoRoot]);
runNode('build_embeddings changed', [path.join(root, 'tools', 'build', 'embeddings.js'), '--stub-embeddings', '--mode', 'code', '--repo', repoRoot]);

const second = await loadCacheIndex(cacheRoot);
const secondKeys = Object.keys(second.index.entries || {});
if (secondKeys.length <= firstKeys.length) {
  console.error('Expected a new cache entry after file change');
  process.exit(1);
}
const updatedEntry = second.index.entries[priorKey];
if (!updatedEntry) {
  console.error('Expected prior cache entry to remain in index');
  process.exit(1);
}
const updatedHits = Number.isFinite(Number(updatedEntry.hits)) ? Number(updatedEntry.hits) : 0;
if (updatedHits <= priorHits) {
  console.error('Expected partial reuse to record a cache access for the prior entry');
  process.exit(1);
}

console.log('embeddings cache partial reuse test passed');
