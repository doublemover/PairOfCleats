#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getRepoCacheRoot, loadUserConfig } from '../tools/dict-utils.js';

const root = process.cwd();
const fixtureRoot = path.join(root, 'tests', 'fixtures', 'sample');
const tempRoot = path.join(root, 'tests', '.cache', 'embeddings-cache-identity');
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
  console.error('embeddings cache identity test failed: build_index failed');
  process.exit(buildIndex.status ?? 1);
}

const runEmbeddings = (dims) => {
  const result = spawnSync(
    process.execPath,
    [
      path.join(root, 'tools', 'build-embeddings.js'),
      '--stub-embeddings',
      '--mode',
      'code',
      '--dims',
      String(dims),
      '--repo',
      repoRoot
    ],
    { cwd: repoRoot, env, stdio: 'inherit' }
  );
  if (result.status !== 0) {
    console.error(`embeddings cache identity test failed: build-embeddings dims=${dims} failed`);
    process.exit(result.status ?? 1);
  }
};

runEmbeddings(8);

const userConfig = loadUserConfig(repoRoot);
const repoCacheRoot = getRepoCacheRoot(repoRoot, userConfig);
const cacheDir = path.join(repoCacheRoot, 'embeddings', 'code', 'files');
const firstFiles = (await fsPromises.readdir(cacheDir))
  .filter((name) => name.endsWith('.json'));
if (!firstFiles.length) {
  console.error('embeddings cache identity test failed: missing cache files');
  process.exit(1);
}

const firstCache = JSON.parse(
  await fsPromises.readFile(path.join(cacheDir, firstFiles[0]), 'utf8')
);
const meta = firstCache?.cacheMeta?.identity;
if (!meta) {
  console.error('embeddings cache identity test failed: missing cache metadata');
  process.exit(1);
}
if (meta.dims !== 8 || meta.scale !== 2 / 255 || meta.stub !== true) {
  console.error('embeddings cache identity test failed: cache identity did not include expected dims/scale/stub');
  process.exit(1);
}
if (!meta.modelId || typeof meta.modelId !== 'string') {
  console.error('embeddings cache identity test failed: cache identity missing modelId');
  process.exit(1);
}
if (!meta.provider || typeof meta.provider !== 'string') {
  console.error('embeddings cache identity test failed: cache identity missing provider');
  process.exit(1);
}

runEmbeddings(12);
const secondFiles = (await fsPromises.readdir(cacheDir))
  .filter((name) => name.endsWith('.json'));
const firstSet = new Set(firstFiles);
const hasNew = secondFiles.some((name) => !firstSet.has(name));
if (!hasNew) {
  console.error('embeddings cache identity test failed: expected new cache entries after dims change');
  process.exit(1);
}

console.log('embeddings cache identity tests passed');
