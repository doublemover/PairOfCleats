#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getCombinedOutput } from '../../helpers/stdio.js';
import { readCacheEntryFile, writeCacheEntry } from '../../../tools/build-embeddings/cache.js';

const root = process.cwd();
const fixtureRoot = path.join(root, 'tests', 'fixtures', 'sample');
const tempRoot = path.join(root, '.testCache', 'embeddings-dims-mismatch');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(tempRoot, { recursive: true });
await fsPromises.cp(fixtureRoot, repoRoot, { recursive: true });

const env = {
  ...process.env,
  PAIROFCLEATS_CACHE_ROOT: cacheRoot,
  PAIROFCLEATS_EMBEDDINGS: 'stub'
};
process.env.PAIROFCLEATS_CACHE_ROOT = cacheRoot;
process.env.PAIROFCLEATS_EMBEDDINGS = 'stub';

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
    path.join(root, 'tools', 'build-embeddings.js'),
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

const loadCacheEntries = async (cacheDir) => {
  const entries = [];
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
      if (!item.isFile()) continue;
      if (item.name === 'cache.meta.json') continue;
      if (!item.name.endsWith('.json') && !item.name.endsWith('.zst')) continue;
      try {
        const cache = await readCacheEntryFile(fullPath);
        entries.push({ name: item.name, path: fullPath, cache });
      } catch {}
    }
  };
  await walk(cacheDir);
  return entries.sort((a, b) => a.path.localeCompare(b.path));
};

const findCacheEntry = (entries, predicate) => (
  entries.find((entry) => predicate(entry?.cache?.cacheMeta?.identity || null))
);

const firstRun = runEmbeddings();
if (firstRun.status !== 0) {
  console.error('embeddings dims mismatch test failed: initial build-embeddings failed');
  process.exit(firstRun.status ?? 1);
}

const cacheRootDir = path.join(cacheRoot, 'embeddings');
const cacheEntries = await loadCacheEntries(cacheRootDir);
if (!cacheEntries.length) {
  console.error('embeddings dims mismatch test failed: no cache files found');
  process.exit(1);
}

const targetEntry = findCacheEntry(cacheEntries, (identity) => (
  identity?.dims === 8 && identity?.stub === true
));
if (!targetEntry) {
  console.error('embeddings dims mismatch test failed: no cache entry for dims=8 stub=true');
  process.exit(1);
}
const targetPath = targetEntry.path;
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
const cacheDir = path.dirname(targetPath);
const baseName = path.basename(targetPath);
const cacheKey = baseName.replace(/\\.embcache\\.zst$/i, '').replace(/\\.json$/i, '');
await writeCacheEntry(cacheDir, cacheKey, cached);

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

