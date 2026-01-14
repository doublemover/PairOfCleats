#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getRepoCacheRoot, loadUserConfig } from '../tools/dict-utils.js';

const root = process.cwd();
const fixtureRoot = path.join(root, 'tests', 'fixtures', 'sample');
const tempRoot = path.join(root, 'tests', '.cache', 'embeddings-dims-mismatch');
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

const firstRun = runEmbeddings();
if (firstRun.status !== 0) {
  console.error('embeddings dims mismatch test failed: initial build-embeddings failed');
  process.exit(firstRun.status ?? 1);
}

const userConfig = loadUserConfig(repoRoot);
const repoCacheRoot = getRepoCacheRoot(repoRoot, userConfig);
const cacheDir = path.join(repoCacheRoot, 'embeddings', 'code', 'files');
const cacheFiles = (await fsPromises.readdir(cacheDir)).filter((name) => name.endsWith('.json'));
if (!cacheFiles.length) {
  console.error('embeddings dims mismatch test failed: no cache files found');
  process.exit(1);
}

const targetPath = path.join(cacheDir, cacheFiles[0]);
const cached = JSON.parse(await fsPromises.readFile(targetPath, 'utf8'));
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
const output = `${secondRun.stdout || ''}${secondRun.stderr || ''}`;
if (!output.includes('embedding dims mismatch')) {
  console.error('embeddings dims mismatch test failed: missing mismatch error message');
  process.exit(1);
}

console.log('embeddings dims mismatch tests passed');
