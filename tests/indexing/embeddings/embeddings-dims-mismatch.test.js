#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getCombinedOutput } from '../../helpers/stdio.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import {
  readCacheEntry,
  upsertCacheIndexEntry,
  writeCacheEntry,
  writeCacheIndex
} from '../../../tools/build/embeddings/cache.js';

const root = process.cwd();
const fixtureRoot = path.join(root, 'tests', 'fixtures', 'sample');
const tempRoot = path.join(root, '.testCache', 'embeddings-dims-mismatch');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(tempRoot, { recursive: true });
await fsPromises.cp(fixtureRoot, repoRoot, { recursive: true });

const env = applyTestEnv({
  cacheRoot,
  embeddings: 'stub'
});

const buildIndex = spawnSync(
  process.execPath,
  [path.join(root, 'build_index.js'), '--stub-embeddings', '--scm-provider', 'none', '--repo', repoRoot],
  { cwd: repoRoot, env, stdio: 'inherit' }
);
if (buildIndex.status !== 0) {
  console.error('embeddings dims mismatch test failed: build_index failed');
  process.exit(buildIndex.status ?? 1);
}

const runEmbeddings = () => spawnSync(
  process.execPath,
  [
    path.join(root, 'tools', 'build/embeddings.js'),
    '--stub-embeddings',
    '--mode',
    'code',
    '--dims',
    '8',
    '--repo',
    repoRoot
  ],
  { cwd: repoRoot, env, encoding: 'utf8' }
);

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

const loadCacheEntry = async (cacheRootDir, dims) => {
  const indexPaths = await findCacheIndexPaths(cacheRootDir);
  if (!indexPaths.length) return null;
  const expectedSegment = `${path.sep}${dims}d${path.sep}code${path.sep}files${path.sep}cache.index.json`;
  const indexPath = indexPaths.find((entry) => entry.includes(expectedSegment)) || indexPaths[0];
  let index;
  try {
    index = JSON.parse(await fsPromises.readFile(indexPath, 'utf8'));
  } catch {
    return null;
  }
  const cacheDir = path.dirname(indexPath);
  const keys = Object.keys(index.entries || {});
  if (!keys.length) return null;
  const cacheKey = keys[0];
  const result = await readCacheEntry(cacheDir, cacheKey, index);
  if (!result?.entry) return null;
  return { cacheDir, cacheKey, cache: result.entry, indexPath, index };
};

const firstRun = runEmbeddings();
if (firstRun.status !== 0) {
  console.error('embeddings dims mismatch test failed: initial build-embeddings failed');
  process.exit(firstRun.status ?? 1);
}

const cacheRootDir = cacheRoot;
const targetEntry = await loadCacheEntry(cacheRootDir, 8);
if (!targetEntry?.cache) {
  console.error('embeddings dims mismatch test failed: no cache entries found');
  process.exit(1);
}
const cached = targetEntry.cache;
const bumpVector = (vec) => {
  if (!vec) return vec;
  if (Array.isArray(vec)) {
    vec.push(0);
    return vec;
  }
  if (ArrayBuffer.isView(vec)) {
    const out = new Uint8Array(vec.length + 1);
    out.set(vec, 0);
    out[vec.length] = 0;
    return out;
  }
  return vec;
};
if (Array.isArray(cached?.mergedVectors)) {
  cached.mergedVectors[0] = bumpVector(cached.mergedVectors[0]);
}
if (Array.isArray(cached?.codeVectors)) {
  cached.codeVectors[0] = bumpVector(cached.codeVectors[0]);
}
if (Array.isArray(cached?.docVectors)) {
  cached.docVectors[0] = bumpVector(cached.docVectors[0]);
}
const cacheDir = targetEntry.cacheDir;
const cacheKey = targetEntry.cacheKey;
const index = targetEntry.index;
delete index.entries[cacheKey];
const shardEntry = await writeCacheEntry(cacheDir, cacheKey, cached, { index });
upsertCacheIndexEntry(index, cacheKey, cached, shardEntry);
await writeCacheIndex(cacheDir, index);

const secondRun = runEmbeddings();
if (secondRun.status === 0) {
  console.error('embeddings dims mismatch test failed: expected dims mismatch error');
  process.exit(1);
}
const output = getCombinedOutput(secondRun);
if (!output.includes('embedding dims mismatch')) {
  console.error('embeddings dims mismatch test failed: missing mismatch error message');
  process.exit(1);
}

console.log('embeddings dims mismatch tests passed');

