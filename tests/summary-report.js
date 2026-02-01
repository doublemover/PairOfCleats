#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'summary-report');
const cacheRoot = path.join(tempRoot, 'cache');
const fixtureRoot = path.join(root, 'tests', 'fixtures', 'sample');
const repoRoot = path.join(tempRoot, 'repo');
const markerPath = path.join(tempRoot, 'build-complete.json');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });
await fsPromises.cp(fixtureRoot, repoRoot, { recursive: true });

const modelId = 'Xenova/all-MiniLM-L12-v2';
const modelSlug = (value) => {
  const safe = value.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '');
  const hash = crypto.createHash('sha1').update(value).digest('hex').slice(0, 8);
  return `${safe || 'model'}-${hash}`;
};
const modelCacheRoot = path.join(cacheRoot, 'model-compare', modelSlug(modelId));

const baseEnv = {
  ...process.env,
  PAIROFCLEATS_TESTING: '1',
  PAIROFCLEATS_EMBEDDINGS: 'stub'
};

const runBuild = (label, envOverrides, args) => {
  const result = spawnSync(
    process.execPath,
    args,
    { env: { ...baseEnv, ...envOverrides }, encoding: 'utf8', cwd: repoRoot }
  );
  if (result.status !== 0) {
    console.error(`summary report build failed: ${label}`);
    if (result.stderr) console.error(result.stderr.trim());
    process.exit(result.status ?? 1);
  }
};

const repoEnv = {
  PAIROFCLEATS_CACHE_ROOT: cacheRoot
};
runBuild('build index (repo cache)', repoEnv, [
  path.join(root, 'build_index.js'),
  '--stub-embeddings',
  '--repo',
  repoRoot
]);
runBuild('build sqlite (repo cache)', repoEnv, [
  path.join(root, 'tools', 'build-sqlite-index.js'),
  '--repo',
  repoRoot
]);

const modelEnv = {
  PAIROFCLEATS_CACHE_ROOT: modelCacheRoot,
  PAIROFCLEATS_MODEL: modelId
};
runBuild('build index (model cache)', modelEnv, [
  path.join(root, 'build_index.js'),
  '--stub-embeddings',
  '--repo',
  repoRoot
]);
runBuild('build sqlite (model cache)', modelEnv, [
  path.join(root, 'tools', 'build-sqlite-index.js'),
  '--repo',
  repoRoot
]);

await fsPromises.writeFile(
  markerPath,
  JSON.stringify({ completedAt: new Date().toISOString() }, null, 2)
);

console.log('summary report build test passed');

