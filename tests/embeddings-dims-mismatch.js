#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getCombinedOutput } from './helpers/stdio.js';
import { getRepoCacheRoot, loadUserConfig } from '../tools/dict-utils.js';

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
  [path.join(root, 'build_index.js'), '--stub-embeddings', '--repo', repoRoot],
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
  const files = (await fsPromises.readdir(cacheDir))
    .filter((name) => name.endsWith('.json'))
    .sort();
  const entries = [];
  for (const name of files) {
    try {
      const cache = JSON.parse(await fsPromises.readFile(path.join(cacheDir, name), 'utf8'));
      entries.push({ name, cache });
    } catch {}
  }
  return entries;
};

const findCacheEntry = (entries, predicate) => (
  entries.find((entry) => predicate(entry?.cache?.cacheMeta?.identity || null))
);

const firstRun = runEmbeddings();
if (firstRun.status !== 0) {
  console.error('embeddings dims mismatch test failed: initial build-embeddings failed');
  process.exit(firstRun.status ?? 1);
}

const userConfig = loadUserConfig(repoRoot);
const repoCacheRoot = getRepoCacheRoot(repoRoot, userConfig);
const cacheDir = path.join(repoCacheRoot, 'embeddings', 'code', 'files');
const cacheEntries = await loadCacheEntries(cacheDir);
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
const targetPath = path.join(cacheDir, targetEntry.name);
const cached = targetEntry.cache;
const bumpVector = (vec) => {
  if (Array.isArray(vec)) vec.push(0);
};
bumpVector(cached?.mergedVectors?.[0]);
bumpVector(cached?.codeVectors?.[0]);
bumpVector(cached?.docVectors?.[0]);
await fsPromises.writeFile(targetPath, JSON.stringify(cached));

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

