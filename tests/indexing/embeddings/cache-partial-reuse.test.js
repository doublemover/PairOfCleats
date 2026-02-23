#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { applyTestEnv } from '../../helpers/test-env.js';
import { readCacheEntry } from '../../../tools/build/embeddings/cache.js';

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
const firstEntries = Object.entries(first.index.entries || {});
const changedEntryPair = firstEntries.find(([, entry]) => String(entry?.file || '').endsWith('src/alpha.js'));
if (!changedEntryPair) {
  console.error('Expected changed file cache entry after initial build');
  process.exit(1);
}
const [changedKeyFirst] = changedEntryPair;
const stableEntryPair = firstEntries.find(([, entry]) => String(entry?.file || '').endsWith('src/stable.js'));
if (!stableEntryPair) {
  console.error('Expected stable file cache entry after initial build');
  process.exit(1);
}
const [priorKey, priorEntry] = stableEntryPair;
const priorHits = Number.isFinite(Number(priorEntry?.hits)) ? Number(priorEntry.hits) : 0;
const priorCache = await readCacheEntry(first.cacheDir, priorKey, first.index);
if (!Array.isArray(priorCache?.entry?.chunkHashes)) {
  console.error('Expected cache entry to include chunk hashes');
  process.exit(1);
}

await fsPromises.appendFile(changedSrcPath, 'export const gamma = () => 3;\n');
runNode('build_index changed', [path.join(root, 'build_index.js'), '--stub-embeddings', '--repo', repoRoot]);
runNode('build_embeddings changed', [path.join(root, 'tools', 'build', 'embeddings.js'), '--stub-embeddings', '--mode', 'code', '--repo', repoRoot]);

const second = await loadCacheIndex(cacheRoot);
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
const changedKeysAfter = Object.entries(second.index.entries || {})
  .filter(([, entry]) => String(entry?.file || '').endsWith('src/alpha.js'))
  .map(([key]) => key);
if (!changedKeysAfter.some((key) => key !== changedKeyFirst)) {
  console.error('Expected changed file to produce a new cache key');
  process.exit(1);
}
const changedKeySecond = changedKeysAfter.find((key) => key !== changedKeyFirst);
if (!changedKeySecond) {
  console.error('Expected to resolve a new cache key for changed file');
  process.exit(1);
}

if (!second.index.files || typeof second.index.files !== 'object') {
  console.error('Expected cache index files map to exist after changed build');
  process.exit(1);
}
second.index.files['src/alpha.js'] = changedKeyFirst;
await fsPromises.writeFile(second.indexPath, JSON.stringify(second.index, null, 2), 'utf8');

runNode('build_embeddings remap stale file key', [
  path.join(root, 'tools', 'build', 'embeddings.js'),
  '--stub-embeddings',
  '--mode',
  'code',
  '--repo',
  repoRoot
]);

const third = await loadCacheIndex(cacheRoot);
const remappedKey = third.index.files?.['src/alpha.js'];
if (remappedKey !== changedKeySecond) {
  console.error(`Expected cache file map to repoint to latest key (expected ${changedKeySecond}, got ${remappedKey || 'missing'})`);
  process.exit(1);
}

console.log('embeddings cache partial reuse test passed');
